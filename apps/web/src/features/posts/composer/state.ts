import type { Account, Media, MediaFormat, Post } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { qk } from '@/lib/query'
import { type CheckResult, savePost } from '../api'
import { type Draft, type DraftTarget, draftFromPost, inputFromDraft } from '../model'

export type PostMediaItem = Post['media'][number]
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface Composer {
  post: Post
  draft: Draft
  accounts: Account[]
  media: PostMediaItem[]
  selected: string
  select: (key: string) => void
  update: (fn: (d: Draft) => Draft) => void
  updateTarget: (key: string, patch: Partial<DraftTarget>) => void
  addMedia: (items: Media[]) => void
  save: (opts?: { versionName?: string }) => Promise<void>
  saveState: SaveState
  editable: boolean
  checks: CheckResult[]
}

export const ComposerContext = createContext<Composer | null>(null)
export function useComposer() {
  const c = useContext(ComposerContext)
  if (!c) throw new Error('useComposer outside the composer')
  return c
}

const toPostFormat = (f: MediaFormat) => ({
  key: f.key,
  label: f.label,
  width: f.width,
  height: f.height,
  duration: f.duration,
  previewUrl: f.urls.preview ?? (f.kind === 'image' ? (f.urls.poster ?? f.urls.original) : f.urls.original),
  posterUrl: f.urls.poster,
})

export function toPostMedia(m: Media): PostMediaItem {
  return {
    mediaId: m.id,
    title: m.title,
    kind: m.kind,
    thumbnailUrl: m.thumbnailUrl,
    formats: m.formats.map(toPostFormat),
    versions: m.versions.map((v) => ({
      key: v.key,
      label: v.label,
      values: v.values,
      formats: v.formats.map(toPostFormat),
    })),
    versionGroups: m.versionGroups,
    audioTracks: m.audioTracks.map((a) => ({
      key: a.key,
      label: a.label,
      duration: a.duration,
      previewUrl: a.urls.preview ?? a.urls.original,
    })),
  }
}

/**
 * The composer keeps a working copy of the post and saves it shortly after each change (the server versions it).
 * Changes made elsewhere (another tab, Claude through MCP) replace the copy when nothing is waiting to be saved.
 */
export function useComposerState(
  post: Post,
  accounts: Account[],
  editable: boolean,
  checks: CheckResult[],
): Composer {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftFromPost(post))
  const [selected, setSelected] = useState('all')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [extra, setExtra] = useState<Map<string, PostMediaItem>>(new Map())
  const latest = useRef(draft)
  latest.current = draft
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<void> | null>(null)
  const seen = useRef(post.updatedAt)

  // A change from elsewhere while nothing is waiting here: take it.
  useEffect(() => {
    if (post.updatedAt === seen.current) return
    seen.current = post.updatedAt
    if (!dirty.current && !inflight.current) setDraft(draftFromPost(post))
  }, [post])

  const save = useCallback(
    async (opts: { versionName?: string } = {}) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (inflight.current) await inflight.current
      const snapshot = latest.current
      const run = (async () => {
        setSaveState('saving')
        try {
          const saved = await savePost(post.id, {
            ...inputFromDraft(snapshot),
            versionName: opts.versionName,
          })
          seen.current = saved.updatedAt
          qc.setQueryData(qk.post(post.id), saved)
          void qc.invalidateQueries({ queryKey: qk.posts() })
          void qc.invalidateQueries({ queryKey: ['posts', 'check', post.id] })
          // New versions get their server ids without losing edits made meanwhile.
          setDraft((d) => ({
            ...d,
            targets: d.targets.map((t) => {
              if (t.id) return t
              const match = saved.targets.find(
                (s) => s.accountId === t.accountId && s.placement === t.placement,
              )
              return match ? { ...t, id: match.id } : t
            }),
          }))
          if (latest.current === snapshot) dirty.current = false
          setSaveState('saved')
        } catch {
          setSaveState('error')
        }
      })()
      inflight.current = run
      await run
      inflight.current = null
      if (dirty.current && latest.current !== snapshot) timer.current = setTimeout(() => void save(), 400)
    },
    [post.id, qc],
  )

  const schedule = useCallback(() => {
    dirty.current = true
    setSaveState('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), 700)
  }, [save])

  useEffect(
    () => () => {
      // Leaving the page: send what is waiting.
      if (timer.current) {
        clearTimeout(timer.current)
        if (dirty.current) void savePost(post.id, inputFromDraft(latest.current)).catch(() => {})
      }
    },
    [post.id],
  )

  const update = useCallback(
    (fn: (d: Draft) => Draft) => {
      if (!editable) return
      setDraft((d) => {
        const next = fn(d)
        latest.current = next
        return next
      })
      schedule()
    },
    [editable, schedule],
  )

  const updateTarget = useCallback(
    (key: string, patch: Partial<DraftTarget>) =>
      update((d) => ({ ...d, targets: d.targets.map((t) => (t.key === key ? { ...t, ...patch } : t)) })),
    [update],
  )

  const addMedia = useCallback(
    (items: Media[]) => {
      setExtra((m) => {
        const next = new Map(m)
        for (const it of items) next.set(it.id, toPostMedia(it))
        return next
      })
      update((d) => ({
        ...d,
        media: [
          ...d.media,
          ...items.filter((i) => !d.media.some((x) => x.mediaId === i.id)).map((i) => ({ mediaId: i.id })),
        ],
      }))
    },
    [update],
  )

  const media = useMemo(() => {
    const known = new Map(post.media.map((m) => [m.mediaId, m]))
    return draft.media
      .map((m) => known.get(m.mediaId) ?? extra.get(m.mediaId))
      .filter((m): m is PostMediaItem => !!m)
  }, [draft.media, post.media, extra])

  return {
    post,
    draft,
    accounts,
    media,
    selected: selected === 'all' || draft.targets.some((t) => t.key === selected) ? selected : 'all',
    select: setSelected,
    update,
    updateTarget,
    addMedia,
    save,
    saveState,
    editable,
    checks,
  }
}
