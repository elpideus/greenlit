import type { WSContext } from 'hono/ws'
import type { Actor } from './actor.ts'
import type { Logger } from './logger.ts'

export interface RealtimeClient {
  id: string
  actor: Actor
  topics: Set<string>
  ws: WSContext
}

type Guard = (actor: Actor, topic: string) => boolean | Promise<boolean>
type MessageHandler = (
  client: RealtimeClient,
  msg: { topic: string; event: string; data: unknown },
) => void | Promise<void>

/**
 * One WebSocket per browser tab. Clients subscribe to topics ("media:<id>", "composition:<id>", "tasks"...)
 * and get `{ topic, event, data }` messages. Modules add guards for their topic prefixes and handlers for
 * messages clients send (the editor uses this to report what is on screen).
 */
export class RealtimeHub {
  private clients = new Map<string, RealtimeClient>()
  private guards = new Map<string, Guard>()
  private handlers = new Map<string, MessageHandler>()
  private disconnectHandlers = new Set<(client: RealtimeClient) => void>()

  private log: Logger
  constructor(log: Logger) {
    this.log = log
  }

  guard(prefix: string, fn: Guard) {
    this.guards.set(prefix, fn)
  }

  onMessage(prefix: string, fn: MessageHandler) {
    this.handlers.set(prefix, fn)
  }

  onDisconnect(fn: (client: RealtimeClient) => void) {
    this.disconnectHandlers.add(fn)
  }

  connect(ws: WSContext, actor: Actor): RealtimeClient {
    const client: RealtimeClient = { id: crypto.randomUUID(), actor, topics: new Set(), ws }
    this.clients.set(client.id, client)
    if (actor.kind === 'user') client.topics.add(`user:${actor.user.id}`)
    client.topics.add('global')
    this.sendTo(client, 'hello', 'connected', { clientId: client.id })
    return client
  }

  disconnect(client: RealtimeClient) {
    this.clients.delete(client.id)
    for (const fn of this.disconnectHandlers) fn(client)
  }

  async receive(client: RealtimeClient, raw: string) {
    let msg: { op?: string; topics?: string[]; topic?: string; event?: string; data?: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.op === 'ping') return this.sendTo(client, 'hello', 'pong', null)
    if (msg.op === 'sub' && Array.isArray(msg.topics)) {
      for (const topic of msg.topics.slice(0, 200)) {
        if (typeof topic === 'string' && (await this.allowed(client.actor, topic))) client.topics.add(topic)
      }
      return
    }
    if (msg.op === 'unsub' && Array.isArray(msg.topics)) {
      for (const t of msg.topics) if (!t.startsWith('user:') && t !== 'global') client.topics.delete(t)
      return
    }
    if (msg.op === 'send' && msg.topic && msg.event) {
      const prefix = msg.topic.split(':')[0]!
      const handler = this.handlers.get(prefix)
      if (handler && client.topics.has(msg.topic)) {
        try {
          await handler(client, { topic: msg.topic, event: msg.event, data: msg.data })
        } catch (err) {
          this.log.warn({ err, topic: msg.topic }, 'realtime handler failed')
        }
      }
    }
  }

  private async allowed(actor: Actor, topic: string) {
    if (topic.startsWith('user:')) return actor.kind === 'user' && topic === `user:${actor.user.id}`
    const guard = this.guards.get(topic.split(':')[0]!)
    if (!guard) return true
    try {
      return await guard(actor, topic)
    } catch {
      return false
    }
  }

  publish(
    topic: string,
    event: string,
    data: unknown,
    opts: { except?: string; filter?: (a: Actor) => boolean } = {},
  ) {
    const payload = JSON.stringify({ topic, event, data })
    for (const c of this.clients.values()) {
      if (c.id === opts.except || !c.topics.has(topic)) continue
      if (opts.filter && !opts.filter(c.actor)) continue
      try {
        c.ws.send(payload)
      } catch {
        /* closed socket; cleaned up on close */
      }
    }
  }

  sendTo(client: RealtimeClient, topic: string, event: string, data: unknown) {
    try {
      client.ws.send(JSON.stringify({ topic, event, data }))
    } catch {
      /* ignore */
    }
  }

  subscribers(topic: string): RealtimeClient[] {
    return [...this.clients.values()].filter((c) => c.topics.has(topic))
  }
}
