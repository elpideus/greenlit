import {
  type DesignFont,
  type DesignInfo,
  FIGCRAFT_MIME,
  type Media,
  type MediaFormat,
} from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileWarning, ImagePlus, RefreshCw, Type, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { spring } from '@/lib/motion'
import { qk } from '@/lib/query'
import { can, useSession } from '@/lib/session'
import { upload } from '@/lib/uploads'
import { Button, confirm, IconButton, Spinner, toast } from '@/ui'
import { designKeys, fetchFonts, useDesignFonts, useFigcraftStatus } from './api'
import { FontUploadButton } from './FontUploadButton'
import { FigcraftHost, isDocumentFile, mimeOf, readMessage } from './host'
import { type HandedFile, useDesign } from './store'

/** Where a document's saves go: the item (and file) it was opened from, or the item a Save As made. */
interface SaveTarget {
  mediaId: string
  formatKey?: string
  version?: string
}

/**
 * The viewer's stage for a design: FigCraft itself, framed from Greenlit's own origin, with the file opened in it.
 * View shows the canvas alone; Edit brings FigCraft's panels. Save stores a new file version of the item (History
 * keeps the old ones); exports and Save As copies can be added to the library. Until FigCraft is running, and on
 * browsers it can't run in (no WebGPU or WebGL2), the stage shows the design's picture instead.
 */
export function DesignStage({ media, format }: { media: Media; format: MediaFormat }) {
  const t = useT('figcraft')
  const me = useSession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const status = useFigcraftStatus()
  useDesignFonts()
  const canSave = can(me, 'media.upload')
  const frame = useRef<HTMLIFrameElement>(null)
  const design = useDesign()
  const [webgl, setWebgl] = useState(() => readFlag())
  const [attempt, setAttempt] = useState(0)
  // The file revision FigCraft has open; saves made here move it on without reopening.
  const opened = useRef<{ formatId: string; revision: number } | null>(null)
  const targets = useRef(new Map<number, SaveTarget>())

  const appUrl = status.data?.appUrl
  const src = appUrl
    ? `${appUrl}?host=parent&control&author=${encodeURIComponent(me.displayName)}${webgl ? '&webgl' : ''}`
    : null

  // A fresh FigCraft for every file (another version or shape of the item, a reload).
  const session = `${format.id}:${attempt}:${webgl ? 'gl' : 'auto'}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: everything resets with each fresh FigCraft (`session`)
  useEffect(() => {
    useDesign.getState().reset()
    useDesign.getState().set({ formatId: format.id })
    opened.current = null
    targets.current = new Map()
    return () => useDesign.getState().reset()
  }, [session])

  const start = useCallback(async () => {
    const el = frame.current
    if (!el) return
    const host = new FigcraftHost(el)
    useDesign.getState().set({ host, phase: 'opening' })
    try {
      await host.setDark().catch(() => {})
      // Fonts first: loading one after opening re-measures text, which FigCraft counts as a change.
      const info = await qc
        .ensureQueryData({
          queryKey: designKeys.info(media.id, format.id, format.fileRevision),
          queryFn: () => api.get<DesignInfo | null>(`/media/${media.id}/design`, { formatId: format.id }),
        })
        .catch(() => null)
      const library = await qc
        .ensureQueryData({
          queryKey: designKeys.fonts,
          queryFn: () => api.get<DesignFont[]>('/figcraft/fonts'),
        })
        .catch(() => [] as DesignFont[])
      if (info?.fonts.length && library.length) {
        for (const f of await fetchFonts(library, info.fonts).catch(() => []))
          await host.loadFont(f.bytes).catch(() => {})
      }
      const res = await fetch(format.urls.original, { credentials: 'include' })
      if (!res.ok) throw new Error(t('couldNotRead'))
      const docId = await host.open(format.filename, await res.arrayBuffer())
      targets.current.set(docId, {
        mediaId: media.id,
        formatKey: format.key,
        version: format.version || undefined,
      })
      opened.current = { formatId: format.id, revision: format.fileRevision }
      await host.setViewing(useDesign.getState().mode === 'view').catch(() => {})
      await host.zoomFit().catch(() => {})
      const missing = await host.missingFonts().catch(() => [])
      useDesign.getState().set({ phase: 'ready', missingFonts: missing, dirty: false })
    } catch (err) {
      useDesign.getState().set({ phase: 'failed', error: (err as Error).message })
    }
  }, [media.id, format, qc, t])

  // ── what FigCraft says ────────────────────────────────────────────────────
  const onSave = useCallback(
    async (name: string, saveAs: boolean, bytes: ArrayBuffer) => {
      const host = useDesign.getState().host
      if (!isDocumentFile(name)) {
        // An export: the person chooses what becomes of it.
        hand({ name, mime: mimeOf(name), bytes, document: false })
        return
      }
      const docId = (await host?.current())?.id ?? null
      const target = docId !== null ? targets.current.get(docId) : undefined
      if (!canSave) {
        toast.info(t('cannotSave'), { description: t('cannotSaveHint') })
        return
      }
      const file = new File([bytes], name.toLowerCase().endsWith('.figcraft') ? name : `${name}.figcraft`, {
        type: FIGCRAFT_MIME,
      })
      useDesign.getState().set({ saving: true })
      try {
        if (target && !saveAs) {
          // Save: a new file version of the item it came from. The revision it becomes is ours, not "newer".
          const mine = target.mediaId === media.id && target.formatKey === format.key ? opened.current : null
          if (mine) mine.revision += 1
          try {
            await upload(file, {
              purpose: 'media.upload',
              target: { ...target, note: t('savedNote') },
              label: t('savingLabel', { name: file.name }),
            })
          } catch (err) {
            if (mine) mine.revision -= 1
            throw err
          }
          useDesign.getState().set({ dirty: false })
          toast.done(t('saved'))
        } else {
          // Save As, or a document from another FigCraft tab: a new item next to this one.
          const r = (await upload(file, {
            purpose: 'media.upload',
            target: { projectId: media.projectId, tags: media.tags },
            label: file.name,
          })) as { mediaId: string }
          if (docId !== null) targets.current.set(docId, { mediaId: r.mediaId })
          toast.done(t('savedAsNew', { name: file.name }), {
            action: { label: t('open'), onClick: () => navigate(`/media/${r.mediaId}`) },
          })
        }
        void qc.invalidateQueries({ queryKey: qk.media() })
      } catch (err) {
        // FigCraft thinks it is saved; keep saying it isn't.
        useDesign.getState().set({ dirty: true })
        toast.error(err, t('saveFailed'))
      } finally {
        useDesign.getState().set({ saving: false })
      }
    },
    [canSave, media, format.key, qc, t, navigate],
  )

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = readMessage(e, frame.current)
      if (!msg) return
      if (msg.kind === 'ready') void start()
      else if (msg.kind === 'dirty') useDesign.getState().set({ dirty: msg.dirty })
      else if (msg.kind === 'save') void onSave(msg.name, msg.saveAs, msg.bytes)
      else if (msg.kind === 'failed') {
        if (useDesign.getState().phase === 'ready') return toast.error(msg.error, t('figcraftError'))
        // WebGPU that can't make a surface leaves the canvas unusable for WebGL2: try again on WebGL2 alone.
        if (!webgl) {
          writeFlag()
          setWebgl(true)
        } else useDesign.getState().set({ phase: 'failed', error: msg.error })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [start, onSave, webgl, t])

  // A newer file of this format arrived (saved elsewhere): offer to reopen.
  useEffect(() => {
    const o = opened.current
    if (o && o.formatId === format.id && format.fileRevision > o.revision)
      useDesign.getState().set({ newer: true })
  }, [format.id, format.fileRevision])

  // View / edit.
  useEffect(() => {
    const s = useDesign.getState()
    if (s.phase === 'ready') void s.host?.setViewing(design.mode === 'view').catch(() => {})
  }, [design.mode])

  // Leaving with unsaved changes.
  // Another page, or another version or shape of the item (FigCraft reopens with that file).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!useDesign.getState().dirty) return false
    if (currentLocation.pathname !== nextLocation.pathname) return true
    const a = new URLSearchParams(currentLocation.search)
    const b = new URLSearchParams(nextLocation.search)
    return a.get('version') !== b.get('version') || a.get('format') !== b.get('format')
  })
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    void confirm({
      title: t('leaveTitle'),
      body: t('leaveBody'),
      confirm: t('leave'),
      cancel: t('stay'),
      danger: true,
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()))
  }, [blocker, t])
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useDesign.getState().dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  const reload = () => setAttempt((a) => a + 1)
  const poster = format.urls.poster ?? format.urls.thumbnail
  const live = design.phase === 'ready'
  const unavailable = status.data && status.data.state !== 'ready' && status.data.state !== 'installing'

  return (
    <div className="relative size-full">
      {src && design.phase !== 'failed' && (
        <iframe
          key={session}
          ref={frame}
          src={src}
          title={t('frameTitle', { title: media.title || format.filename })}
          allow="fullscreen; clipboard-read; clipboard-write; local-fonts"
          className={cn(
            'absolute inset-0 size-full border-0 bg-stage transition-opacity duration-200',
            !live && 'opacity-0',
          )}
        />
      )}

      {/* The design's picture while FigCraft starts, and in its place when it can't run here. */}
      {!live && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8">
          {poster ? (
            <img src={poster} alt="" draggable={false} className="min-h-0 max-w-full flex-1 object-contain" />
          ) : (
            <FileWarning size={40} strokeWidth={1.2} className="text-white/30" />
          )}
          <div className="flex shrink-0 flex-col items-center gap-3 text-center">
            {design.phase === 'failed' || unavailable ? (
              <>
                <p className="max-w-[52ch] t-callout text-white/70">
                  {unavailable
                    ? status.data?.state === 'failed'
                      ? t('notInstalledFailed')
                      : t('notInstalled')
                    : t('cannotRun')}
                </p>
                {design.error && design.phase === 'failed' && (
                  <p className="max-w-[64ch] t-caption text-white/40">{design.error}</p>
                )}
                <div className="flex gap-2">
                  {design.phase === 'failed' && (
                    <Button size="sm" icon={RefreshCw} onClick={reload}>
                      {t('tryAgain')}
                    </Button>
                  )}
                  <a href={format.urls.download}>
                    <Button size="sm" icon={Download}>
                      {t('download')}
                    </Button>
                  </a>
                </div>
              </>
            ) : (
              <span className="floating flex items-center gap-2 px-3 py-1.5 t-caption text-ink-2">
                <Spinner size={13} />
                {status.data?.state === 'installing' ? t('installing') : t('opening')}
              </span>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {live && design.newer && (
          <Banner key="newer" onClose={() => design.set({ newer: false })}>
            <span>{design.dirty ? t('newerDirty') : t('newer')}</span>
            <Button size="xs" icon={RefreshCw} onClick={reload}>
              {t('reload')}
            </Button>
          </Banner>
        )}
        {live && !design.newer && design.missingFonts.length > 0 && (
          <Banner key="fonts" onClose={() => design.set({ missingFonts: [] })}>
            <Type size={14} className="shrink-0 text-review" />
            <span className="min-w-0">
              {t('missingFonts', {
                families: design.missingFonts.join(', '),
                count: design.missingFonts.length,
              })}
            </span>
            {can(me, 'designs.fonts') ? (
              <FontUploadButton size="xs" onAdded={() => (design.dirty ? undefined : reload())} />
            ) : (
              <span className="t-caption text-ink-3">{t('askAdmin')}</span>
            )}
          </Banner>
        )}
      </AnimatePresence>

      <HandedTray media={media} />
    </div>
  )
}

/** Keeps a file FigCraft handed over (an export) for the person to add or download. */
function hand(f: Omit<HandedFile, 'id' | 'state'>) {
  const s = useDesign.getState()
  s.set({ handed: [...s.handed, { ...f, id: crypto.randomUUID(), state: 'waiting' }] })
}

function Banner({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const t = useT('figcraft')
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={spring.snap}
      className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center px-4"
    >
      <div className="floating pointer-events-auto flex max-w-[640px] items-center gap-3 py-1.5 pr-1.5 pl-3.5 t-callout text-ink-2">
        {children}
        <IconButton icon={X} size="xs" label={t('dismiss')} onClick={onClose} />
      </div>
    </motion.div>
  )
}

/** Files FigCraft exported: add each to the project, or download it. */
function HandedTray({ media }: { media: Media }) {
  const t = useT('figcraft')
  const me = useSession()
  const navigate = useNavigate()
  const handed = useDesign((s) => s.handed)
  const set = useDesign((s) => s.set)
  if (!handed.length) return null
  const update = (id: string, patch: Partial<HandedFile>) =>
    set({ handed: useDesign.getState().handed.map((h) => (h.id === id ? { ...h, ...patch } : h)) })
  const add = async (h: HandedFile) => {
    update(h.id, { state: 'adding' })
    try {
      const r = (await upload(new File([h.bytes], h.name, { type: h.mime }), {
        purpose: 'media.upload',
        target: { projectId: media.projectId, tags: media.tags },
        label: h.name,
      })) as { mediaId: string }
      update(h.id, { state: 'added', mediaId: r.mediaId })
    } catch (err) {
      update(h.id, { state: 'failed' })
      toast.error(err, t('addFailed'))
    }
  }
  const download = (h: HandedFile) => {
    const url = URL.createObjectURL(new Blob([h.bytes], { type: h.mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = h.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  const canAdd = can(me, 'media.upload')
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.snap}
      className="floating absolute right-4 bottom-16 z-10 w-[320px] p-2"
    >
      <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-1.5">
        <span className="flex-1 t-headline text-ink">{t('exportsTitle', { count: handed.length })}</span>
        {canAdd && handed.some((h) => h.state === 'waiting') && (
          <Button
            size="xs"
            variant="primary"
            icon={ImagePlus}
            onClick={() => void Promise.all(handed.filter((h) => h.state === 'waiting').map(add))}
          >
            {t('addAll')}
          </Button>
        )}
        <IconButton icon={X} size="xs" label={t('dismiss')} onClick={() => set({ handed: [] })} />
      </div>
      <ul className="flex max-h-[240px] flex-col overflow-y-auto">
        {handed.map((h) => (
          <li key={h.id} className="flex items-center gap-2 rounded-control px-1.5 py-1 hover:bg-hover">
            <span className="min-w-0 flex-1 truncate t-callout text-ink">{h.name}</span>
            {h.state === 'added' && h.mediaId ? (
              <Button size="xs" variant="ghost" onClick={() => navigate(`/media/${h.mediaId}`)}>
                {t('open')}
              </Button>
            ) : (
              canAdd && (
                <Button size="xs" variant="ghost" loading={h.state === 'adding'} onClick={() => void add(h)}>
                  {t('addToLibrary')}
                </Button>
              )
            )}
            <IconButton icon={Download} size="xs" label={t('download')} onClick={() => download(h)} />
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

const FLAG = 'figcraft.webgl'
function readFlag() {
  try {
    return sessionStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}
function writeFlag() {
  try {
    sessionStorage.setItem(FLAG, '1')
  } catch {}
}
