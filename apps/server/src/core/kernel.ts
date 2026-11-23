import { join } from 'node:path'
import { createNodeWebSocket } from '@hono/node-ws'
import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { type Config, SERVER_ROOT } from './config.ts'
import { createDb, runMigrations } from './db.ts'
import { EntityDirectory } from './entities.ts'
import { EventBus } from './events.ts'
import { HookRegistry } from './hooks.ts'
import { type AppEnv, createApi, errorHandler, requestId } from './http.ts'
import { JobQueue } from './jobs.ts'
import { createLogger } from './logger.ts'
import { McpRegistry } from './mcp.ts'
import { discoverModules, type Kernel, setupModules } from './module.ts'
import { PermissionRegistry } from './permissions.ts'
import { RealtimeHub } from './realtime.ts'
import { createServiceRegistry } from './services.ts'
import { SettingsStore } from './settings.ts'
import { serveWebApp } from './static.ts'
import { TaskService } from './tasks.ts'
import { VersioningService } from './versioning.ts'

export async function createKernel(
  config: Config,
): Promise<{ kernel: Kernel; app: Hono<AppEnv>; injectWebSocket: (server: unknown) => void }> {
  const log = createLogger(config.logLevel, !config.isProd)
  await runMigrations(config.databaseUrl, log)
  const { db, client } = createDb(config.databaseUrl, log)
  const realtime = new RealtimeHub(log.child({ part: 'realtime' }))
  const events = new EventBus(log)
  const tasks = new TaskService(db, realtime)
  const kernel: Kernel = {
    config,
    log,
    db,
    sql: client,
    api: createApi(),
    services: createServiceRegistry(),
    permissions: new PermissionRegistry(),
    events,
    hooks: new HookRegistry(),
    jobs: new JobQueue(config.databaseUrl, log.child({ part: 'jobs' }), tasks, config.role !== 'api'),
    tasks,
    mcp: new McpRegistry(log.child({ part: 'mcp' })),
    settings: new SettingsStore(db, events),
    realtime,
    versions: new VersioningService(db, realtime),
    entities: new EntityDirectory(),
    auth: { resolvers: [] },
    startHandlers: [],
    stopHandlers: [],
    modules: [],
  }

  const disabled = new Set(
    (process.env.GREENLIT_DISABLED_MODULES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const modules = await discoverModules(join(SERVER_ROOT, 'src/modules'), disabled, log)
  await setupModules(kernel, modules)
  await kernel.settings.load()
  log.info({ modules: modules.map((m) => m.id) }, 'modules loaded')

  const app = new Hono<AppEnv>()
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
  app.onError(errorHandler(log))
  app.use('*', requestId())
  app.use(
    '*',
    secureHeaders({
      crossOriginResourcePolicy: false,
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: undefined,
      xFrameOptions: 'SAMEORIGIN',
    }),
  )
  // Who is calling: each module-provided resolver gets a turn (session cookie, API token, share link...).
  app.use('/api/*', async (c, next) => {
    let actor = null
    for (const resolve of kernel.auth.resolvers) {
      actor = await resolve(c)
      if (actor) break
    }
    c.set('actor', actor)
    await next()
  })

  app.get(
    '/api/ws',
    upgradeWebSocket((c) => {
      const actor = c.get('actor')
      let client: ReturnType<RealtimeHub['connect']> | null = null
      return {
        onOpen(_evt, ws) {
          if (!actor) return ws.close(4401, 'unauthenticated')
          client = realtime.connect(ws, actor)
        },
        onMessage(evt) {
          if (client && typeof evt.data === 'string') void realtime.receive(client, evt.data)
        },
        onClose() {
          if (client) realtime.disconnect(client)
        },
      }
    }),
  )

  kernel.mcp.mount(kernel.api, config.version)
  kernel.api.openAPIRegistry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'gl_session',
  })
  kernel.api.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
  })
  kernel.api.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Greenlit API',
      version: config.version,
      description:
        'Everything the Greenlit web app does goes through this API. Authenticate with a session cookie or an API token (`Authorization: Bearer glt_…`, created in Settings → API & MCP).',
      license: { name: 'GPL-3.0-or-later', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
    },
    servers: [{ url: `${config.publicUrl}/api` }],
  })
  kernel.api.get('/docs', Scalar({ url: '/api/openapi.json', pageTitle: 'Greenlit API' }))
  app.route('/api', kernel.api)
  app.all('/api/*', (c) =>
    c.json({ error: { code: 'not_found', message: `No route ${c.req.method} ${c.req.path}` } }, 404),
  )

  if (!serveWebApp(app, config.webDist)) {
    app.get('/', (c) =>
      c.text(
        `Greenlit API is running. The web app is not built here — run \`pnpm dev\` or \`pnpm build\`.\n`,
      ),
    )
  }
  return { kernel, app, injectWebSocket: injectWebSocket as (server: unknown) => void }
}
