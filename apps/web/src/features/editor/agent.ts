import { type Composition, describe, type Op } from '@greenlit/composition'
import { compositionApi } from './api'
import { currentFormat, dispatch, useEditor } from './store'

/**
 * Programmatic access for AI agents driving the browser (and for scripts in the devtools console):
 *
 *   window.greenlit.editor.getDocument()            // the composition JSON as drawn
 *   window.greenlit.editor.describe()               // a readable outline of tracks and clips
 *   window.greenlit.editor.getState()               // { id, time, playing, formatId, selection, revision }
 *   window.greenlit.editor.apply([{ op: 'update_clip', id, patch }])   // same ops as the API / MCP; undoable
 *   window.greenlit.editor.seek(2.5); .play(); .pause()
 *   window.greenlit.editor.select(['clipId'])
 *   window.greenlit.editor.setFormat('vertical')
 *   await window.greenlit.editor.frame(2.5)         // a JPEG (object URL) drawn exactly as the export will be
 *
 * Agents working through MCP don't need this: their ops land on the server and every open editor updates live.
 */
export interface EditorAgentApi {
  getDocument: () => Composition | null
  describe: () => string
  getState: () => {
    id: string | null
    time: number
    playing: boolean
    formatId: string
    selection: string[]
    revision: number | null
  }
  apply: (ops: Op[]) => boolean
  seek: (t: number) => void
  play: () => void
  pause: () => void
  select: (ids: string[]) => void
  setFormat: (id: string) => void
  frame: (t?: number, formatId?: string) => Promise<string>
}

declare global {
  interface Window {
    greenlit?: { editor?: EditorAgentApi }
  }
}

const get = useEditor.getState
const set = useEditor.setState

export function installAgentApi(): () => void {
  const apiObj: EditorAgentApi = {
    getDocument: () => structuredClone(get().draft ?? get().doc),
    describe: () => {
      const d = get().doc
      return d ? describe(d) : 'No edit is open'
    },
    getState: () => {
      const s = get()
      return {
        id: s.id,
        time: s.time,
        playing: s.playing,
        formatId: s.formatId,
        selection: s.selection,
        revision: s.server?.revision ?? null,
      }
    },
    apply: (ops) => dispatch(ops, { label: 'Agent edit' }),
    seek: (t) => set({ time: Math.max(0, t), playing: false }),
    play: () => set({ playing: true, rate: 1 }),
    pause: () => set({ playing: false }),
    select: (ids) => set({ selection: ids }),
    setFormat: (id) => set({ formatId: id }),
    frame: async (t, formatId) => {
      const s = get()
      if (!s.id) throw new Error('No edit is open')
      const res = await fetch(compositionApi.frameUrl(s.id, t ?? s.time, formatId ?? currentFormat(s).id), {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`frame ${res.status}`)
      return URL.createObjectURL(await res.blob())
    },
  }
  window.greenlit = { ...(window.greenlit ?? {}), editor: apiObj }
  return () => {
    if (window.greenlit?.editor === apiObj) delete window.greenlit.editor
  }
}
