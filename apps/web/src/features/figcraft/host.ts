/**
 * Greenlit as FigCraft's host. The FigCraft browser build runs unmodified in a same-origin iframe
 * (`/api/figcraft/app/<version>/?host=parent&control`), so two channels reach it:
 *
 * - host messages (`{type: "figcraft:<kind>", ...}` over postMessage): `ready`, `open {name, bytes}`, `save {name,
 *   saveAs, bytes}` for every file it would download, `dirty {dirty}`, `failed {error}`;
 * - its command API, `iframe.contentWindow.figcraft` (`execute`, `request`, `docInspect`, `uiInspect`), the same
 *   commands as figcraft-cli and its MCP server.
 */

export type HostMessage =
  | { kind: 'ready'; version?: string; appVersion?: string }
  | { kind: 'save'; name: string; saveAs: boolean; bytes: ArrayBuffer }
  | { kind: 'dirty'; dirty: boolean }
  | { kind: 'failed'; error: string }

interface FigcraftApi {
  execute: (command: string, params?: unknown) => Promise<unknown>
  request: (method: string, params?: unknown) => Promise<unknown>
  docInspect: (params?: unknown) => Promise<{ id: number; dirty: boolean; name: string }>
}

/** Reads a message from FigCraft's frame, or null when it isn't one. */
export function readMessage(e: MessageEvent, frame: HTMLIFrameElement | null): HostMessage | null {
  if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return null
  const d = e.data as Record<string, unknown> | null
  if (!d || typeof d.type !== 'string' || !d.type.startsWith('figcraft:')) return null
  const kind = d.type.slice('figcraft:'.length)
  if (kind === 'ready') return { kind, appVersion: d.appVersion as string | undefined }
  if (kind === 'dirty') return { kind, dirty: !!d.dirty }
  if (kind === 'failed') return { kind, error: String(d.error ?? 'FigCraft could not start') }
  if (kind === 'save' && typeof d.name === 'string') {
    const raw = d.bytes
    const bytes =
      raw instanceof ArrayBuffer
        ? raw
        : ArrayBuffer.isView(raw)
          ? (raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
          : null
    if (!bytes) return null
    return { kind, name: d.name, saveAs: !!d.saveAs, bytes }
  }
  return null
}

export class FigcraftHost {
  readonly frame: HTMLIFrameElement
  /** The id FigCraft gave the document Greenlit opened (its other tabs are other documents). */
  docId: number | null = null

  constructor(frame: HTMLIFrameElement) {
    this.frame = frame
  }

  private get api(): FigcraftApi {
    const api = (this.frame.contentWindow as (Window & { figcraft?: FigcraftApi }) | null)?.figcraft
    if (!api) throw new Error('FigCraft is not running')
    return api
  }

  private post(kind: string, fields: Record<string, unknown>, transfer: Transferable[] = []) {
    this.frame.contentWindow?.postMessage({ type: `figcraft:${kind}`, ...fields }, location.origin, transfer)
  }

  execute<T = unknown>(command: string, params?: unknown) {
    return this.api.execute(command, params) as Promise<T>
  }

  /** Opens the file as File › Open would, then learns which document it became. */
  async open(name: string, bytes: ArrayBuffer) {
    const before = await this.current()
    this.post('open', { name, bytes }, [bytes])
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      await wait(120)
      const now = await this.current()
      if (now && now.id !== before?.id) {
        this.docId = now.id
        return now.id
      }
    }
    throw new Error('FigCraft did not open the file')
  }

  /** The document in front: its id, name and whether it has unsaved changes (null on the home screen). */
  async current() {
    try {
      return await this.api.docInspect({ depth: 0, fields: [] })
    } catch {
      return null
    }
  }

  /** Is the document in front the one Greenlit opened? */
  async isOurs() {
    const now = await this.current()
    return !!now && now.id === this.docId
  }

  /**
   * View: FigCraft's panels and toolbars hidden and the hand tool, so dragging pans instead of moving layers.
   * Edit: everything back, with the move tool.
   */
  async setViewing(on: boolean) {
    await this.execute('view.toggleUi', { on })
    await this.execute('tool.set', { tool: on ? 'hand' : 'move' })
  }

  setDark() {
    return this.execute('view.themeDark')
  }

  /** File › Save: FigCraft hands the file over with a `save` message. */
  save() {
    return this.api.request('ui.menu.invoke', { id: 'file.save' })
  }

  /** Adds a font file to this session (do it before opening: loading a font re-measures text, which counts as a change). */
  loadFont(bytes: ArrayBuffer) {
    return this.execute<{ families: string[] }>('text.loadFont', { data: toBase64(bytes) })
  }

  async missingFonts() {
    const r = await this.execute<{ families: { family: string }[] }>('text.missingFonts')
    return r.families.map((f) => f.family)
  }

  /** Shows one frame: its page, then zooms to it. */
  async showFrame(pageId: number, frameId: number) {
    await this.execute('page.select', { id: pageId })
    await this.execute('select.set', { ids: [frameId] })
    await this.execute('view.zoomSelection')
    await this.execute('select.none')
  }

  zoomFit() {
    return this.execute('view.zoomFit')
  }
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function toBase64(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Files FigCraft hands over that are the document itself, not an export (`.figcraft`, `.json`). */
export function isDocumentFile(name: string) {
  const n = name.toLowerCase()
  return (n.endsWith('.figcraft') || n.endsWith('.json')) && !n.endsWith('.variables.json')
}

export function mimeOf(name: string) {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return (
    {
      figcraft: 'application/x-figcraft',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      json: 'application/json',
    }[ext] ?? 'application/octet-stream'
  )
}
