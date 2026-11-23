import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type Actor, assertCan } from './actor.ts'
import { HttpError } from './errors.ts'
import type { Access, Api } from './http.ts'
import type { Logger } from './logger.ts'

export interface McpImage {
  type: 'image'
  data: string
  mimeType: string
}
export interface McpText {
  type: 'text'
  text: string
}
/** Return this from a tool to send pictures (frames, contact sheets) or mixed content. */
export class McpContent {
  readonly content: (McpText | McpImage)[]
  constructor(content: (McpText | McpImage)[]) {
    this.content = content
  }
}

export interface McpToolDef<S extends z.ZodRawShape> {
  /** snake_case, prefixed by area: media_search, editor_apply... */
  name: string
  title?: string
  description: string
  input: S
  access: Access
  readOnly?: boolean
  destructive?: boolean
  handler: (input: z.infer<z.ZodObject<S>>, ctx: { actor: Actor; log: Logger }) => Promise<unknown>
}

export interface McpResourceDef {
  uri: string
  name: string
  description: string
  mimeType?: string
  read: () => Promise<string> | string
}

/**
 * Modules register MCP tools next to their API routes. The server speaks MCP over Streamable HTTP
 * at /api/mcp, authenticated with an API token (Authorization: Bearer glt_...).
 */
export class McpRegistry {
  private tools = new Map<string, McpToolDef<z.ZodRawShape>>()
  private resources = new Map<string, McpResourceDef>()
  private instructions: string[] = []

  private log: Logger
  constructor(log: Logger) {
    this.log = log
  }

  tool<S extends z.ZodRawShape>(def: McpToolDef<S>) {
    if (this.tools.has(def.name)) throw new Error(`MCP tool ${def.name} registered twice`)
    this.tools.set(def.name, def as unknown as McpToolDef<z.ZodRawShape>)
  }

  resource(def: McpResourceDef) {
    this.resources.set(def.uri, def)
  }

  /** A paragraph added to the server instructions every MCP client receives on connect. */
  instruct(text: string) {
    this.instructions.push(text.trim())
  }

  list() {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      access: t.access,
    }))
  }

  /** Call a tool directly (used by the REST bridge and tests). */
  async call(name: string, input: unknown, actor: Actor) {
    const def = this.tools.get(name)
    if (!def) throw new HttpError('not_found', `No tool named ${name}`)
    if (def.access !== 'public' && def.access !== 'signed-in') assertCan(actor, def.access)
    const parsed = z.object(def.input).parse(input ?? {})
    return def.handler(parsed, { actor, log: this.log })
  }

  private buildServer(actor: Actor, version: string) {
    const server = new McpServer(
      { name: 'greenlit', version },
      { instructions: this.instructions.join('\n\n'), capabilities: { logging: {} } },
    )
    for (const def of this.tools.values()) {
      if (def.access !== 'public' && def.access !== 'signed-in') {
        try {
          assertCan(actor, def.access)
        } catch {
          continue // tools you may not use are not listed
        }
      }
      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema: def.input,
          annotations: { readOnlyHint: def.readOnly ?? false, destructiveHint: def.destructive ?? false },
        },
        // biome-ignore lint/suspicious/noExplicitAny: SDK callback typing is generic over the schema
        (async (input: any) => {
          try {
            const result = await def.handler(input, { actor, log: this.log })
            if (result instanceof McpContent) return { content: result.content }
            const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            return { content: [{ type: 'text', text }] }
          } catch (err) {
            const message = err instanceof HttpError ? `${err.code}: ${err.message}` : (err as Error).message
            if (!(err instanceof HttpError)) this.log.error({ err, tool: def.name }, 'mcp tool failed')
            return { content: [{ type: 'text', text: message }], isError: true }
          }
          // biome-ignore lint/suspicious/noExplicitAny: see above
        }) as any,
      )
    }
    for (const r of this.resources.values()) {
      server.registerResource(
        r.name,
        r.uri,
        { description: r.description, mimeType: r.mimeType ?? 'text/markdown' },
        async () => ({
          contents: [{ uri: r.uri, mimeType: r.mimeType ?? 'text/markdown', text: await r.read() }],
        }),
      )
    }
    return server
  }

  mount(app: Api, version: string) {
    app.get('/mcp/tools', (c) => {
      const actor = c.get('actor')
      if (!actor) return c.json({ error: { code: 'unauthenticated', message: 'Sign in first' } }, 401)
      const visible = [...this.tools.values()].filter((d) => {
        if (d.access === 'public' || d.access === 'signed-in') return true
        try {
          assertCan(actor, d.access)
          return true
        } catch {
          return false
        }
      })
      return c.json(
        visible.map((d) => ({
          name: d.name,
          description: d.description,
          access: d.access,
          readOnly: !!d.readOnly,
          destructive: !!d.destructive,
        })),
      )
    })
    app.all('/mcp', async (c) => {
      const actor = c.get('actor')
      if (!actor) {
        return c.json(
          {
            error: {
              code: 'unauthenticated',
              message: 'Create an API token in Greenlit (Settings → API & MCP)',
            },
          },
          401,
        )
      }
      // Stateless: every request gets a fresh server bound to the caller's permissions.
      const server = this.buildServer(actor, version)
      const transport = new StreamableHTTPTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      await server.connect(transport)
      const res = await transport.handleRequest(c)
      return res ?? c.body(null, 202)
    })
  }
}
