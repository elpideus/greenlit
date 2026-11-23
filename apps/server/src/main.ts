import { serve } from '@hono/node-server'
import { loadConfig } from './core/config.ts'
import { createKernel } from './core/kernel.ts'

const config = loadConfig()
const { kernel, app, injectWebSocket } = await createKernel(config)
const { log } = kernel

await kernel.jobs.start()
for (const fn of kernel.startHandlers) await fn()

if (config.role !== 'worker') {
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    log.info(
      `Greenlit ${config.version} listening on http://${info.address}:${info.port}  (public: ${config.publicUrl})`,
    )
  })
  injectWebSocket(server)
}

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'shutting down')
  for (const fn of kernel.stopHandlers.reverse()) {
    try {
      await fn()
    } catch (err) {
      log.error({ err }, 'stop handler failed')
    }
  }
  await kernel.jobs.stop()
  await kernel.sql.end({ timeout: 5 })
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
