import { applyOps, type Clip, type Composition, type Op, type OutputFormat } from '@greenlit/composition'
import { create } from 'zustand'
import { errorMessage } from '@/lib/api'
import { realtime } from '@/lib/realtime'
import { toast } from '@/ui'
import { type CompositionView, compositionApi } from './api'
import { diffOps } from './diff'

/**
 * The editor's state and its live sync with the server.
 *
 * Documents: `server` is the last document the server confirmed (with its revision). Local edits are applied at once
 * to `doc` and queued as ops; one batch is in flight at a time. Ops broadcast by the server (ours, other editors',
 * Claude's through MCP) advance `server`; `doc` is then rebuilt as server + our unconfirmed ops (a rebase). A gap in
 * revisions, a reconnect or a failed send triggers a catch-up from `/ops?since=`.
 *
 * `draft` is a transient document used while dragging (60 fps, nothing sent); the release commits one op.
 *
 * Ownership: the store belongs to one editor session (`session`). A page that unmounts only resets the store if it
 * still owns it, so a newer editor that already loaded is never wiped by an older one's cleanup.
 */

export interface Presence {
  clientId: string
  user: { id: string; displayName: string } | null
  time: number
  playing: boolean
  selection: string[]
  formatId: string
  at: number
}

export interface RemoteActivity {
  source: string
  author: { id: string; displayName: string } | null
  at: number
  clipIds: string[]
}

interface UndoEntry {
  label: string
  before: Composition
  after: Composition
}

export interface EditorState {
  session: string | null
  id: string | null
  meta: Omit<CompositionView, 'document'> | null
  server: { doc: Composition; revision: number } | null
  doc: Composition | null
  draft: Composition | null
  inflight: Op[] | null
  pending: Op[]
  status: 'loading' | 'ready' | 'saving' | 'offline' | 'error'
  error: string | null
  readOnly: boolean

  time: number
  playing: boolean
  rate: number
  formatId: string
  selection: string[]
  pxPerSec: number
  guides: string | null
  showSafe: boolean
  presence: Presence[]
  remote: RemoteActivity | null
  undo: UndoEntry[]
  redo: UndoEntry[]
  clipboard: { clip: Clip; trackKind: string }[]
  leftTab: 'media' | 'layers'
  rightTab: string
}

const clientId = crypto.randomUUID()

const initial: EditorState = {
  session: null,
  id: null,
  meta: null,
  server: null,
  doc: null,
  draft: null,
  inflight: null,
  pending: [],
  status: 'loading',
  error: null,
  readOnly: false,
  time: 0,
  playing: false,
  rate: 1,
  formatId: 'main',
  selection: [],
  pxPerSec: 60,
  guides: null,
  showSafe: false,
  presence: [],
  remote: null,
  undo: [],
  redo: [],
  clipboard: [],
  leftTab: 'media',
  rightTab: 'inspector',
}

export const useEditor = create<EditorState>(() => ({ ...initial }))
const get = useEditor.getState
const set = useEditor.setState

/** The document as drawn right now (a drag preview wins). */
export const useDoc = () => useEditor((s) => s.draft ?? s.doc)

export function currentFormat(s: Pick<EditorState, 'doc' | 'draft' | 'formatId'>): OutputFormat {
  const doc = s.draft ?? s.doc
  return (
    doc?.formats.find((f) => f.id === s.formatId) ??
    doc?.formats[0] ?? { id: 'main', name: '16:9', width: 1920, height: 1080 }
  )
}

/** Whether edits to transforms go into a per-format override (any format but the design one). */
export function editingOverride(s: Pick<EditorState, 'doc' | 'formatId'>) {
  return !!s.doc && s.doc.formats[0]?.id !== s.formatId
}

// ── session lifecycle ────────────────────────────────────────────────────────────────

let unsubscribe: (() => void) | null = null
let catchingUp = false

export async function openEditor(id: string, readOnly: boolean): Promise<string> {
  const session = crypto.randomUUID()
  unsubscribe?.()
  set({ ...initial, session, id, status: 'loading', readOnly })
  const off = realtime.on(`composition:${id}`, (msg) => {
    if (get().session !== session) return
    if (msg.event === 'ops') onRemoteOps(msg.data as RemoteOps)
    else if (msg.event === 'presence')
      set({ presence: (msg.data as Presence[]).filter((p) => p.clientId !== realtime.clientId) })
    else if (msg.event === 'meta')
      set((s) => ({ meta: s.meta ? { ...s.meta, ...(msg.data as { name: string }) } : s.meta }))
    else if (msg.event === 'command') onCommand(msg.data as Command)
    else if (msg.event === 'rendered') onRendered?.(msg.data as { mediaId: string })
  })
  unsubscribe = off
  try {
    const view = await compositionApi.get(id)
    if (get().session !== session) return session
    const { document, ...meta } = view
    set({
      meta,
      server: { doc: document, revision: view.revision },
      doc: document,
      formatId: document.formats[0]?.id ?? 'main',
      status: 'ready',
      pxPerSec: fitZoom(document.duration),
    })
  } catch (err) {
    if (get().session === session) set({ status: 'error', error: errorMessage(err) })
  }
  return session
}

/** Ends a session — only the one that owns the store resets it. */
export function closeEditor(session: string) {
  if (get().session !== session) return
  unsubscribe?.()
  unsubscribe = null
  set({ ...initial })
}

function fitZoom(duration: number) {
  const width = Math.max(600, (typeof window === 'undefined' ? 1400 : window.innerWidth) - 420)
  return Math.max(8, Math.min(240, width / Math.max(1, duration)))
}

// ── local edits ──────────────────────────────────────────────────────────────────────

/**
 * Applies ops locally at once and sends them. Returns false (and says why) when the edit is not valid.
 * `undoable: false` for edits that should not land on the undo stack (selection-only, catch-up…).
 */
export function dispatch(ops: Op[], opts: { label?: string; undoable?: boolean } = {}): boolean {
  const s = get()
  if (!s.doc || s.readOnly || !ops.length) return false
  let next: Composition
  try {
    next = applyOps(s.doc, ops)
  } catch (err) {
    toast.error(err, 'That edit could not be made')
    set({ draft: null })
    return false
  }
  const undo =
    opts.undoable === false
      ? s.undo
      : [...s.undo, { label: opts.label ?? 'Edit', before: s.doc, after: next }].slice(-200)
  set({
    doc: next,
    draft: null,
    pending: [...s.pending, ...ops],
    undo,
    redo: opts.undoable === false ? s.redo : [],
  })
  void flush()
  return true
}

/** A transient preview while dragging: drawn, not sent. */
export function preview(ops: Op[] | null) {
  const s = get()
  if (!s.doc) return
  if (!ops) return set({ draft: null })
  try {
    set({ draft: applyOps(s.doc, ops) })
  } catch {
    /* keep the last valid preview */
  }
}

export function undo() {
  const s = get()
  const entry = s.undo.at(-1)
  if (!entry || !s.doc) return
  const ops = diffOps(entry.after, entry.before)
  set({ undo: s.undo.slice(0, -1), redo: [...s.redo, entry] })
  applyLenient(ops)
  toast.dismiss()
}

export function redo() {
  const s = get()
  const entry = s.redo.at(-1)
  if (!entry || !s.doc) return
  const ops = diffOps(entry.before, entry.after)
  set({ redo: s.redo.slice(0, -1), undo: [...s.undo, entry] })
  applyLenient(ops)
}

/** Applies what still applies (another editor may have removed a clip meanwhile). */
function applyLenient(ops: Op[]) {
  const s = get()
  if (!s.doc) return
  let doc = s.doc
  const ok: Op[] = []
  for (const op of ops) {
    try {
      doc = applyOps(doc, [op])
      ok.push(op)
    } catch {
      /* skipped */
    }
  }
  if (!ok.length) return
  set({ doc, pending: [...get().pending, ...ok] })
  void flush()
}

// ── sending ──────────────────────────────────────────────────────────────────────────

async function flush() {
  const s = get()
  if (!s.id || s.inflight || !s.pending.length || !s.server) return
  const batch = s.pending
  const session = s.session
  set({ inflight: batch, pending: [], status: 'saving' })
  try {
    const { revision } = await compositionApi.apply(s.id, batch, s.server.revision, clientId)
    if (get().session !== session) return
    // The broadcast normally arrives first; if the socket is down, catch up.
    setTimeout(() => {
      const now = get()
      if (now.session === session && now.server && now.server.revision < revision) void catchUp()
    }, 1500)
  } catch (err) {
    if (get().session !== session) return
    toast.error(err, 'Your last change was not saved')
    set({ inflight: null })
    await refetch()
  }
}

interface RemoteOps {
  revision: number
  ops: Op[]
  clientId: string | null
  author: { id: string; displayName: string } | null
  source: string
}

function onRemoteOps(m: RemoteOps) {
  const s = get()
  if (!s.server) return
  if (m.revision <= s.server.revision) return
  if (m.revision !== s.server.revision + 1) {
    void catchUp()
    return
  }
  applyServer([m])
}

function applyServer(list: RemoteOps[]) {
  let s = get()
  if (!s.server) return
  let doc = s.server.doc
  let revision = s.server.revision
  let inflight = s.inflight
  let remote = s.remote
  for (const m of list) {
    if (m.revision <= revision) continue
    try {
      doc = applyOps(doc, m.ops)
    } catch {
      void refetch()
      return
    }
    revision = m.revision
    if (m.clientId === clientId) inflight = null
    else {
      const ids = m.ops.flatMap((o) => ('id' in o && typeof o.id === 'string' ? [o.id] : []))
      remote = { source: m.source, author: m.author, at: Date.now(), clipIds: ids }
    }
  }
  s = get()
  let local = doc
  const mine = [...(inflight ?? []), ...s.pending]
  if (mine.length) {
    try {
      local = applyOps(doc, mine)
    } catch {
      // Our unsent edit no longer fits what changed on the server: keep the server's version.
      toast.info('Someone else changed this at the same time — showing their version')
      set({ pending: [] })
      inflight = null
      local = doc
    }
  }
  set({
    server: { doc, revision },
    doc: local,
    inflight,
    remote,
    status: inflight || get().pending.length ? 'saving' : 'ready',
    selection: s.selection.filter((id) => local.tracks.some((t) => t.clips.some((c) => c.id === id))),
  })
  void flush()
}

export async function catchUp() {
  const s = get()
  if (!s.id || !s.server || catchingUp) return
  catchingUp = true
  try {
    const list = await compositionApi.since(s.id, s.server.revision)
    applyServer(list.map((o) => ({ ...o, author: null, source: o.clientId === clientId ? 'web' : 'sync' })))
  } catch {
    set({ status: 'offline' })
  } finally {
    catchingUp = false
  }
}

async function refetch() {
  const s = get()
  if (!s.id) return
  try {
    const view = await compositionApi.get(s.id)
    set({
      server: { doc: view.document, revision: view.revision },
      doc: view.document,
      pending: [],
      inflight: null,
      status: 'ready',
    })
  } catch (err) {
    set({ status: 'error', error: errorMessage(err) })
  }
}

// ── commands from Claude (editor_control) ────────────────────────────────────────────

interface Command {
  action: 'seek' | 'play' | 'pause' | 'select' | 'format'
  time?: number
  clipIds?: string[]
  formatId?: string
}

function onCommand(c: Command) {
  if (c.action === 'seek' && typeof c.time === 'number') set({ time: Math.max(0, c.time), playing: false })
  if (c.action === 'play') set({ playing: true, rate: 1 })
  if (c.action === 'pause') set({ playing: false })
  if (c.action === 'select' && c.clipIds) set({ selection: c.clipIds })
  if (c.action === 'format' && c.formatId) set({ formatId: c.formatId })
}

let onRendered: ((d: { mediaId: string }) => void) | null = null
export function setOnRendered(fn: typeof onRendered) {
  onRendered = fn
}

// ── presence ─────────────────────────────────────────────────────────────────────────

let presenceTimer: ReturnType<typeof setTimeout> | null = null
export function sendPresence() {
  if (presenceTimer) return
  presenceTimer = setTimeout(() => {
    presenceTimer = null
    const s = get()
    if (!s.id) return
    realtime.send(`composition:${s.id}`, 'view', {
      time: s.time,
      playing: s.playing,
      selection: s.selection,
      formatId: s.formatId,
    })
  }, 400)
}

export const editorClientId = clientId
