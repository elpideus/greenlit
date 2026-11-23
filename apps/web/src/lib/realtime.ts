import { type QueryKey, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * One WebSocket per tab (`/api/ws`). Components subscribe to topics ("media:<id>", "library", "tasks"…) and get
 * `{ topic, event, data }` messages. Subscriptions are ref-counted and re-sent after a reconnect.
 */
export interface RealtimeMessage<T = unknown> {
  topic: string
  event: string
  data: T
}
type Handler = (msg: RealtimeMessage) => void

class Realtime {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private counts = new Map<string, number>()
  private retry = 0
  private ping: ReturnType<typeof setInterval> | null = null
  private wanted = false
  private listeners = new Set<() => void>()
  status: 'idle' | 'connecting' | 'open' | 'closed' = 'idle'
  clientId: string | null = null

  start() {
    this.wanted = true
    if (this.ws) return
    this.open()
  }

  stop() {
    this.wanted = false
    this.ws?.close()
    this.ws = null
  }

  private setStatus(s: Realtime['status']) {
    this.status = s
    for (const l of this.listeners) l()
  }

  subscribeStatus = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`)
    this.ws = ws
    this.setStatus('connecting')
    ws.onopen = () => {
      this.retry = 0
      this.setStatus('open')
      const topics = [...this.counts.keys()]
      if (topics.length) ws.send(JSON.stringify({ op: 'sub', topics }))
      // Cloudflare drops idle sockets after ~100 s.
      this.ping = setInterval(() => ws.readyState === 1 && ws.send('{"op":"ping"}'), 30_000)
    }
    ws.onmessage = (e) => {
      let msg: RealtimeMessage
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.topic === 'hello') {
        if (msg.event === 'connected') this.clientId = (msg.data as { clientId: string }).clientId
        return
      }
      for (const h of this.handlers.get(msg.topic) ?? []) h(msg)
      for (const h of this.handlers.get('*') ?? []) h(msg)
    }
    ws.onclose = (e) => {
      if (this.ping) clearInterval(this.ping)
      this.ws = null
      this.setStatus('closed')
      if (!this.wanted || e.code === 4401) return
      const delay = Math.min(15_000, 500 * 2 ** this.retry++) * (0.8 + Math.random() * 0.4)
      setTimeout(() => this.wanted && !this.ws && this.open(), delay)
    }
  }

  on(topic: string, handler: Handler) {
    let set = this.handlers.get(topic)
    if (!set) this.handlers.set(topic, (set = new Set()))
    set.add(handler)
    if (topic !== '*') {
      const n = (this.counts.get(topic) ?? 0) + 1
      this.counts.set(topic, n)
      if (n === 1 && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 'sub', topics: [topic] }))
    }
    return () => {
      set.delete(handler)
      if (topic === '*') return
      const left = (this.counts.get(topic) ?? 1) - 1
      if (left <= 0) {
        this.counts.delete(topic)
        if (this.ws?.readyState === 1 && !topic.startsWith('user:') && topic !== 'global')
          this.ws.send(JSON.stringify({ op: 'unsub', topics: [topic] }))
      } else this.counts.set(topic, left)
    }
  }

  /** Sends a message to a topic's server handler (e.g. editor presence). */
  send(topic: string, event: string, data: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 'send', topic, event, data }))
  }
}

export const realtime = new Realtime()

/** Calls `handler` for every message on `topic` (null = nothing). */
export function useTopic<T = unknown>(topic: string | null | undefined, handler: (msg: RealtimeMessage<T>) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!topic) return
    return realtime.on(topic, (m) => ref.current(m as RealtimeMessage<T>))
  }, [topic])
}

/** Refetches queries when something changes on a topic, optionally only for some events. */
export function useLiveQuery(topic: string | null | undefined, keys: QueryKey[], events?: string[]) {
  const qc = useQueryClient()
  const keysRef = useRef(keys)
  keysRef.current = keys
  useTopic(topic, (msg) => {
    if (events && !events.includes(msg.event)) return
    for (const key of keysRef.current) void qc.invalidateQueries({ queryKey: key })
  })
}

export function useRealtimeStatus() {
  return useSyncExternalStore(realtime.subscribeStatus, () => realtime.status)
}
