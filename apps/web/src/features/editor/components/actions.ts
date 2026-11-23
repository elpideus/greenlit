import { type Clip, type Composition, isActive, newId, type Op } from '@greenlit/composition'
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Scissors,
  SquareDashed,
  Trash2,
} from 'lucide-react'
import { i18next } from '@/lib/i18n'
import type { MenuEntry } from '@/ui'
import { findClip, freeStart, type NewKind, round, templateClip } from '../edits'
import { currentFormat, dispatch, useEditor } from '../store'

const get = useEditor.getState
const set = useEditor.setState
const t = (k: string, o?: Record<string, unknown>) =>
  (i18next.t as unknown as (key: string, opts?: object) => string)(`editor:${k}`, o)

function selected(doc: Composition) {
  const s = get().selection
  return doc.tracks.flatMap((tr) =>
    tr.clips.filter((c) => s.includes(c.id)).map((c) => ({ clip: c, track: tr })),
  )
}

/** Timeline and canvas actions, shared by menus, buttons, shortcuts and the agent API. */
export const clipActions = {
  split() {
    const s = get()
    if (!s.doc || s.readOnly) return
    const at = s.time
    let targets = selected(s.doc).filter(({ clip }) => isActive(clip, at))
    if (!targets.length)
      targets = s.doc.tracks.flatMap((tr) =>
        tr.locked ? [] : tr.clips.filter((c) => isActive(c, at)).map((clip) => ({ clip, track: tr })),
      )
    const ops: Op[] = targets
      .filter(({ clip }) => at - clip.start > 0.02 && clip.start + clip.duration - at > 0.02)
      .map(({ clip }) => ({ op: 'split_clip', id: clip.id, at: round(at), newId: newId() }))
    if (ops.length) dispatch(ops, { label: 'Split' })
  },

  remove(ids?: string[]) {
    const s = get()
    const list = ids ?? s.selection
    if (!s.doc || s.readOnly || !list.length) return
    if (
      dispatch(
        list.map((id) => ({ op: 'remove_clip', id })),
        { label: 'Delete' },
      )
    )
      set({ selection: [] })
  },

  duplicate() {
    const s = get()
    if (!s.doc || s.readOnly) return
    const ops: Op[] = []
    const ids: string[] = []
    for (const { clip, track } of selected(s.doc)) {
      const id = newId()
      const start =
        freeStart(track, clip.start + clip.duration, clip.duration, []) ?? clip.start + clip.duration
      ops.push({
        op: 'add_clip',
        trackId: track.id,
        clip: { ...structuredClone(clip), id, start } as unknown as Record<string, unknown>,
      })
      ids.push(id)
    }
    if (ops.length && dispatch(ops, { label: 'Duplicate' })) set({ selection: ids })
  },

  copy() {
    const s = get()
    if (!s.doc) return
    const items = selected(s.doc).map(({ clip, track }) => ({
      clip: structuredClone(clip),
      trackKind: track.kind,
    }))
    if (!items.length) return
    set({ clipboard: items })
    void navigator.clipboard
      ?.writeText(JSON.stringify({ greenlit: 'clips', clips: items.map((i) => i.clip) }))
      .catch(() => {})
  },

  cut() {
    clipActions.copy()
    clipActions.remove()
  },

  /** Pastes at the playhead, keeping the clips' relative timing, on the first track of each kind with room. */
  paste() {
    const s = get()
    if (!s.doc || s.readOnly || !s.clipboard.length) return
    const first = Math.min(...s.clipboard.map((c) => c.clip.start))
    const ops: Op[] = []
    const ids: string[] = []
    for (const { clip, trackKind } of s.clipboard) {
      const start = round(s.time + (clip.start - first))
      const track = s.doc.tracks.find(
        (tr) => tr.kind === trackKind && !tr.locked && freeStart(tr, start, clip.duration) === start,
      )
      const id = newId()
      ids.push(id)
      if (clip.assetId && !s.doc.assets[clip.assetId]) continue
      ops.push({
        op: 'add_clip',
        ...(track ? { trackId: track.id } : {}),
        clip: { ...structuredClone(clip), id, start } as unknown as Record<string, unknown>,
      })
    }
    if (ops.length && dispatch(ops, { label: 'Paste' })) set({ selection: ids })
  },

  selectAll() {
    const s = get()
    if (!s.doc) return
    set({ selection: s.doc.tracks.flatMap((tr) => tr.clips.map((c) => c.id)) })
  },

  toggle(id: string, key: 'hidden' | 'locked') {
    const s = get()
    const f = s.doc && findClip(s.doc, id)
    if (!f) return
    dispatch([{ op: 'update_clip', id, patch: { [key]: !f.clip[key] } }], {
      label: key === 'hidden' ? 'Hide' : 'Lock',
    })
  },

  /** Adds a text / shape / solid / code clip at the playhead, on top. */
  add(kind: NewKind) {
    const s = get()
    if (!s.doc || s.readOnly) return
    const format = s.doc.formats[0]!
    const clip = templateClip(kind, s.time, format)
    const top = [...s.doc.tracks].reverse().find((tr) => tr.kind === 'visual' && !tr.locked)
    const fits = top && freeStart(top, s.time, clip.duration as number) === round(s.time)
    const ops: Op[] = [{ op: 'add_clip', ...(fits && top ? { trackId: top.id } : {}), clip }]
    if (kind === 'solid') {
      const bottom = s.doc.tracks.find((tr) => tr.kind === 'visual')
      if (bottom && freeStart(bottom, s.time, 4) === round(s.time))
        ops[0] = { op: 'add_clip', trackId: bottom.id, clip }
    }
    if (dispatch(ops, { label: 'Add' })) set({ selection: [clip.id as string], rightTab: 'inspector' })
  },

  menu(clipId: string): MenuEntry[] {
    const s = get()
    if (!s.doc) return []
    if (!s.selection.includes(clipId)) set({ selection: [clipId] })
    const sel = get().selection
    const f = findClip(s.doc, clipId)
    if (!f) return []
    const many = sel.length > 1
    const ro = s.readOnly
    return [
      {
        label: t('timeline.split'),
        icon: Scissors,
        shortcut: 's',
        disabled: ro,
        onSelect: () => clipActions.split(),
      },
      {
        label: t('timeline.duplicate'),
        icon: CopyPlus,
        shortcut: 'mod+d',
        disabled: ro,
        onSelect: () => clipActions.duplicate(),
      },
      'separator',
      {
        label: t('timeline.cut'),
        icon: SquareDashed,
        shortcut: 'mod+x',
        disabled: ro,
        onSelect: () => clipActions.cut(),
      },
      { label: t('timeline.copy'), icon: Copy, shortcut: 'mod+c', onSelect: () => clipActions.copy() },
      s.clipboard.length > 0 && {
        label: t('timeline.paste'),
        icon: ClipboardPaste,
        shortcut: 'mod+v',
        disabled: ro,
        onSelect: () => clipActions.paste(),
      },
      'separator',
      !many && {
        label: f.clip.hidden ? t('timeline.show') : t('timeline.hide'),
        icon: f.clip.hidden ? Eye : EyeOff,
        disabled: ro,
        onSelect: () => clipActions.toggle(clipId, 'hidden'),
      },
      !many && {
        label: f.clip.locked ? t('timeline.unlock') : t('timeline.lock'),
        icon: f.clip.locked ? LockOpen : Lock,
        disabled: ro,
        onSelect: () => clipActions.toggle(clipId, 'locked'),
      },
      'separator',
      {
        label: many ? t('timeline.deleteMany', { count: sel.length }) : t('timeline.delete'),
        icon: Trash2,
        danger: true,
        shortcut: 'backspace',
        disabled: ro,
        onSelect: () => clipActions.remove(),
      },
    ]
  },
}

/** The clip under the playhead on the top-most visible track (canvas click selection). */
export function topClipAt(doc: Composition, time: number, formatId: string): Clip | null {
  for (const tr of [...doc.tracks].reverse()) {
    if (tr.kind !== 'visual' || tr.hidden) continue
    const c = tr.clips.find((x) => isActive(x, time) && !(x.formats?.[formatId]?.hidden ?? x.hidden))
    if (c) return c
  }
  return null
}

export { currentFormat }
