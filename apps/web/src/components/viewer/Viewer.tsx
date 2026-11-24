import { type Media, type MediaFormat, versionFormats } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { menuEntries } from '@/app/registry'
import { Slot } from '@/app/Slot'
import { formatByKey, useBulkMedia, useMediaItem, useUpdateMedia } from '@/data/media'
import { useProjects } from '@/data/projects'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useIsPhone, useStoredState } from '@/lib/dom'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { can, useConfig, useSession } from '@/lib/session'
import { EmptyState, IconButton, InlineEdit, Menu, Signal, Skeleton, Tally, toast, toneFor } from '@/ui'
import { useViewer } from './store'
import './locales'
import { type Neighbors, useNeighbors } from './browse'
import { FormatSwitcher } from './FormatSwitcher'
import { SidePanel } from './SidePanel'
import { Stage } from './Stage'
import { Transport } from './Transport'
import { stepFrames } from './usePlayer'
import { NewVersionDialog, VersionSwitcher } from './VersionSwitcher'

/**
 * The stage column is always dark (`force-dark`), whatever the mode: its lamps (pins, markers, the playhead) take the
 * theme's dark palette so they read on black in light mode too.
 */
function useStageVars(): React.CSSProperties {
  const { data } = useConfig()
  const d = data?.theme.dark
  if (!d) return {}
  return {
    '--signal': d.accent,
    '--signal-hover': d.accentHover,
    '--signal-ink': d.accentText,
    '--signal-soft': d.accentSoft,
    '--review': d.warning,
    '--cut': d.danger,
    '--cue': d.info,
    '--focus': d.focus,
  } as React.CSSProperties
}

/**
 * The screening room: the frame on black, the transport under it, the decision and the notes beside it.
 * Full window on /media/:id; `embedded` inside the review room (no back button, fills its container).
 */
export function Viewer({
  mediaId,
  embedded,
  onClose,
}: {
  mediaId: string
  embedded?: boolean
  onClose?: () => void
}) {
  const t = useT('viewer')
  const { data: media, isLoading, error } = useMediaItem(mediaId)
  const phone = useIsPhone()
  const [params, setParams] = useSearchParams()
  const [panelOpen, setPanelOpen] = useStoredState('viewer.panelOpen', true)
  const [width, setWidth] = useStoredState('viewer.panelWidth', 384)
  const column = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const set = useViewer((s) => s.set)
  const stageVars = useStageVars()
  // Previous / next in the list the viewer was opened from (the review room has its own list beside it).
  const nav = useNeighbors(mediaId, media, !embedded)

  // ?version=<key> (another version of the item), ?format=<key>, ?audio=<track key>
  const wantedVersion = params.get('version')
  const version =
    media && wantedVersion && media.versions.some((v) => v.key === wantedVersion) ? wantedVersion : ''
  const format = media ? formatByKey(media, params.get('format'), version) : undefined
  const audioParam = params.get('audio')
  const audioTrack = media?.audioTracks.some((a) => a.key === audioParam) ? audioParam : null
  const [newVersion, setNewVersion] = useState(false)

  // Reset the shared state per item, keeping playback preferences. Another version or shape of the same item keeps
  // the moment, playback and the open note: the stage carries playback over when the lengths match.
  const shownItem = useRef<string | null>(null)
  useEffect(() => {
    const s = useViewer.getState()
    const patch = {
      mediaId,
      formatId: format?.id ?? null,
      kind: format?.kind ?? null,
      duration: format?.duration ?? 0,
      audioTrack,
    }
    if (shownItem.current === mediaId) return s.set(patch)
    shownItem.current = mediaId
    const keep = { rate: s.rate, loop: s.loop, volume: s.volume, muted: s.muted, tab: s.tab }
    s.reset()
    s.set({ ...keep, ...patch })
  }, [mediaId, format?.id])
  useEffect(() => {
    useViewer.getState().set({ audioTrack })
  }, [audioTrack])

  // deep links: ?t=<seconds>, ?comment=<id>
  const deepLinked = useRef<string | null>(null)
  const controls = useViewer((s) => s.controls)
  useEffect(() => {
    if (!media || deepLinked.current === media.id) return
    const tParam = params.get('t')
    const comment = params.get('comment')
    if (comment) set({ activeNote: comment, tab: 'comments' })
    if (tParam && controls) {
      controls.seek(Number(tParam))
      deepLinked.current = media.id
    } else if (!tParam) deepLinked.current = media.id
  }, [media, controls])

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void column.current?.requestFullscreen().catch(() => {})
  }, [])

  // shortcuts
  const timed = format?.kind === 'video' || format?.kind === 'audio'
  const jog = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopJog = () => {
    if (jog.current) clearInterval(jog.current)
    jog.current = null
  }
  useHotkey(
    'space',
    () => {
      const s = useViewer.getState()
      stopJog()
      s.playing ? s.controls?.pause() : s.controls?.play()
    },
    { enabled: timed },
  )
  useHotkey(
    'k',
    () => {
      stopJog()
      useViewer.getState().controls?.pause()
      set({ rate: 1 })
    },
    { enabled: timed },
  )
  useHotkey(
    'l',
    () => {
      stopJog()
      const s = useViewer.getState()
      if (s.playing) set({ rate: Math.min(4, s.rate * 2) })
      else {
        set({ rate: 1 })
        s.controls?.play()
      }
    },
    { enabled: timed },
  )
  useHotkey(
    'j',
    () => {
      // browsers can't play backwards: step back in place of reverse playback
      const s = useViewer.getState()
      s.controls?.pause()
      if (jog.current) return stopJog()
      jog.current = setInterval(() => {
        const st = useViewer.getState()
        if (st.time <= 0) return stopJog()
        st.controls?.seek(st.time - 0.1)
      }, 100)
    },
    { enabled: timed },
  )
  useHotkey('arrowleft', () => useViewer.getState().controls?.seek(useViewer.getState().time - 1), {
    enabled: timed,
  })
  useHotkey('arrowright', () => useViewer.getState().controls?.seek(useViewer.getState().time + 1), {
    enabled: timed,
  })
  useHotkey('shift+arrowleft', () => useViewer.getState().controls?.seek(useViewer.getState().time - 5), {
    enabled: timed,
  })
  useHotkey('shift+arrowright', () => useViewer.getState().controls?.seek(useViewer.getState().time + 5), {
    enabled: timed,
  })
  useHotkey(',', () => stepFrames(-1), { enabled: format?.kind === 'video' })
  useHotkey('.', () => stepFrames(1), { enabled: format?.kind === 'video' })
  const step = (to: string | null | undefined, e: KeyboardEvent) => {
    if (!to || !nav || e.repeat) return
    if (document.querySelector('[role=dialog][data-open],[role=menu]')) return
    nav.go(to)
  }
  // ← → walk the list where they don't move through time; Shift+P / Shift+N everywhere (designs keep their arrows).
  useHotkey('arrowleft', (e) => step(nav?.prev, e), { enabled: !!nav && !timed && format?.kind !== 'design' })
  useHotkey('arrowright', (e) => step(nav?.next, e), {
    enabled: !!nav && !timed && format?.kind !== 'design',
  })
  useHotkey('shift+p', (e) => step(nav?.prev, e), { enabled: !!nav })
  useHotkey('shift+n', (e) => step(nav?.next, e), { enabled: !!nav })
  useHotkey('f', toggleFullscreen)
  useHotkey('m', () => set({ muted: !useViewer.getState().muted }), { enabled: timed })
  useHotkey('mod+.', () => setPanelOpen((o) => !o))
  useEffect(() => stopJog, [])

  if (error)
    return (
      <div className="grid h-full place-items-center bg-canvas">
        <EmptyState
          title={t('notFound')}
          action={
            !embedded ? (
              <Link to="/library" className="t-callout text-signal">
                {t('library')}
              </Link>
            ) : undefined
          }
        />
      </div>
    )
  if (isLoading || !media || !format) return <ViewerSkeleton embedded={embedded} />

  const formats = versionFormats(media, version)
  const selectFormat = (key: string) => {
    const next = new URLSearchParams(params)
    if (key === (formats.find((f) => f.isPrimary) ?? formats[0])?.key) next.delete('format')
    else next.set('format', key)
    setParams(next, { replace: true })
  }
  // Same shape in the other version when it has one, else its main one.
  const selectVersion = (key: string) => {
    const next = new URLSearchParams(params)
    if (key) next.set('version', key)
    else next.delete('version')
    const target = versionFormats(media, key)
    const primary = target.find((f) => f.isPrimary) ?? target[0]
    if (!target.some((f) => f.key === format.key) || primary?.key === format.key) next.delete('format')
    else next.set('format', format.key)
    setParams(next, { replace: true })
  }
  const versionProps = {
    version,
    formats,
    format,
    onVersion: selectVersion,
    onNewVersion: () => setNewVersion(true),
  }
  const dialogs = (
    <NewVersionDialog
      media={media}
      format={format}
      version={version}
      open={newVersion}
      onOpenChange={setNewVersion}
      onCreated={selectVersion}
    />
  )

  const panel = <SidePanel media={media} format={format} />

  if (phone) {
    // Phones: the page scrolls — the picture at its own shape, then the decision and the panel at full height.
    const ratio =
      format.width && format.height && (format.kind === 'video' || format.kind === 'image')
        ? format.width / format.height
        : format.kind === 'design'
          ? 4 / 5
          : 16 / 9
    return (
      <div className="flex min-h-full flex-col bg-canvas">
        <div ref={column} className="force-dark flex shrink-0 flex-col bg-stage" style={stageVars}>
          <ViewerBar
            media={media}
            {...versionProps}
            onFormat={selectFormat}
            embedded={embedded}
            onClose={onClose}
            nav={nav}
            walkKeys={!timed && format.kind !== 'design'}
            compact
          />
          <div className="relative max-h-[64dvh] w-full" style={{ aspectRatio: String(ratio) }}>
            <Stage media={media} format={format} padding={0} />
          </div>
          {timed && (
            <Transport
              media={media}
              format={format}
              fullscreen={fullscreen}
              onFullscreen={toggleFullscreen}
            />
          )}
        </div>
        <div className="h-[100dvh] shrink-0">{panel}</div>
        {dialogs}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <div
        ref={column}
        className="force-dark relative flex min-w-0 flex-1 flex-col bg-stage"
        style={stageVars}
      >
        <ViewerBar
          media={media}
          {...versionProps}
          onFormat={selectFormat}
          embedded={embedded}
          onClose={onClose}
          nav={nav}
          walkKeys={!timed && format.kind !== 'design'}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((o) => !o)}
        />
        <div className="relative min-h-0 flex-1">
          <Stage media={media} format={format} padding={fullscreen ? 0 : 28} />
        </div>
        {timed && (
          <Transport media={media} format={format} fullscreen={fullscreen} onFullscreen={toggleFullscreen} />
        )}
      </div>
      {panelOpen && (
        <>
          <ResizeHandle width={width} onWidth={setWidth} />
          <aside className="relative flex min-h-0 shrink-0 flex-col bg-panel" style={{ width }}>
            {panel}
          </aside>
        </>
      )}
      {dialogs}
    </div>
  )
}

/** Room the viewer bar keeps beside the switches: back button, a 140px title, the tools, gaps and padding. */
const BAR_RESERVE = 340

/** How wide a row of switches is on one line, wrapped or not (its visible children and the 8px gaps). */
function naturalWidth(el: HTMLElement | null) {
  if (!el) return 0
  const widths = [...el.children].map((c) => (c as HTMLElement).offsetWidth).filter((w) => w > 0)
  return widths.reduce((a, w) => a + w, 0) + Math.max(0, widths.length - 1) * 8
}

function ResizeHandle({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null)
  return (
    <div
      className="group relative z-10 w-px shrink-0 cursor-col-resize bg-line"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: width }
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        onWidth(Math.max(320, Math.min(620, start.current.w - (e.clientX - start.current.x))))
      }}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={() => onWidth(384)}
      role="separator"
      aria-orientation="vertical"
    >
      <div className="absolute inset-y-0 -right-1 -left-1 transition-colors duration-150 group-hover:bg-signal/40 group-active:bg-signal/60" />
    </div>
  )
}

function ViewerBar({
  media,
  version,
  formats,
  format,
  onVersion,
  onNewVersion,
  onFormat,
  embedded,
  onClose,
  nav,
  walkKeys,
  panelOpen,
  onTogglePanel,
  compact,
}: {
  media: Media
  version: string
  formats: MediaFormat[]
  format: MediaFormat
  onVersion: (key: string) => void
  onNewVersion: () => void
  onFormat: (key: string) => void
  embedded?: boolean
  onClose?: () => void
  nav?: Neighbors | null
  /** Whether ← → step through the list (items without a timeline), for the buttons' tooltips. */
  walkKeys?: boolean
  panelOpen?: boolean
  onTogglePanel?: () => void
  compact?: boolean
}) {
  const t = useT('viewer')
  const me = useSession()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const update = useUpdateMedia(media.id)
  const bulk = useBulkMedia()
  const { data: projects } = useProjects()
  const [renaming, setRenaming] = useState(false)
  const project = projects?.find((p) => p.id === media.projectId)
  const canEdit = can(me, 'media.edit')

  const back = () => {
    if (onClose) return onClose()
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate(media.projectId ? `/projects/${media.projectId}` : '/library')
  }

  const menu = () =>
    menuEntries('media', { items: [media], me }, [
      {
        order: 0,
        items: canEdit ? [{ label: t('rename'), icon: Pencil, onSelect: () => setRenaming(true) }] : [],
      },
      {
        order: 80,
        items: [
          {
            label: `${t('download')} · ${format.label}`,
            icon: Download,
            onSelect: () => window.open(format.urls.download, '_self'),
          },
          {
            label: t('copyLink'),
            icon: Copy,
            onSelect: async () => {
              await navigator.clipboard.writeText(`${location.origin}/media/${media.id}`)
              toast.done(t('linkCopied'))
            },
          },
          canEdit && {
            label: t('reprocess'),
            icon: RefreshCw,
            onSelect: async () => {
              await api.post(`/media/${media.id}/reprocess`)
              toast.info(t('reprocessStarted'))
              void qc.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
            },
          },
        ],
      },
      {
        order: 100,
        items: can(me, 'media.delete')
          ? [
              {
                label: t('trash'),
                icon: Trash2,
                danger: true,
                onSelect: async () => {
                  await bulk.mutateAsync({ ids: [media.id], action: 'trash' })
                  toast.done(t('trashed', { title: media.title || t('common:untitled') }), {
                    action: {
                      label: t('undo'),
                      onClick: () => bulk.mutate({ ids: [media.id], action: 'restore' }),
                    },
                  })
                  back()
                },
              },
            ]
          : [],
      },
    ])

  // The version and format switches sit in the bar while they fit beside the back button, a readable title and the
  // tools (about BAR_RESERVE); otherwise they get a row of their own under it, as on phones.
  const bar = useRef<HTMLDivElement>(null)
  const strips = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the strips move to the other row when `stacked` flips
  useLayoutEffect(() => {
    const b = bar.current
    if (compact || !b) return
    const check = () => setStacked(naturalWidth(strips.current) + BAR_RESERVE > b.clientWidth)
    const ro = new ResizeObserver(check)
    ro.observe(b)
    if (strips.current) ro.observe(strips.current)
    check()
    return () => ro.disconnect()
  }, [compact, stacked])
  const ownRow = compact ? formats.length > 1 || media.versions.length > 1 || !!version : stacked
  const switches = media.formats.length > 0 && (
    <div
      ref={strips}
      className={cn(
        'flex items-center gap-2',
        // Under the bar on a computer, a switch that doesn't fit goes to the next line; phones scroll sideways.
        ownRow && !compact ? 'flex-wrap justify-center' : 'mx-auto w-max',
      )}
    >
      <VersionSwitcher
        media={media}
        version={version}
        format={format}
        onSelect={onVersion}
        onNew={onNewVersion}
      />
      <FormatSwitcher
        media={media}
        formats={formats}
        version={version}
        format={format}
        onSelect={onFormat}
        onNewVersion={onNewVersion}
      />
    </div>
  )
  return (
    <>
      <div ref={bar} className={cn('flex h-[52px] shrink-0 items-center gap-3', compact ? 'px-2' : 'px-3')}>
        {!embedded && (
          <IconButton icon={ArrowLeft} label={t('back')} onClick={back} className="text-white/80" />
        )}
        {nav && <Pager nav={nav} walkKeys={walkKeys} compact={compact} />}
        <div className={cn('flex min-w-0 flex-1 items-center gap-2', !compact && 'min-w-[140px]')}>
          {project && !compact && (
            <>
              <Link
                to={`/projects/${project.id}`}
                className="press max-w-[200px] truncate rounded-[6px] px-1 t-callout text-white/50 hover:text-white/85"
              >
                {project.name}
              </Link>
              <ChevronRight size={13} className="shrink-0 text-white/25" />
            </>
          )}
          <Tally tone={toneFor(media.status)} size={8} />
          <InlineEdit
            value={media.title}
            placeholder={t('common:untitled')}
            disabled={!canEdit}
            editing={renaming}
            onEditingChange={setRenaming}
            onSave={(title) => update.mutate({ title })}
            className="t-headline text-white"
          />
        </div>
        {!compact && !stacked && switches}
        <div className={cn('flex flex-1 items-center justify-end gap-0.5', compact && 'flex-none')}>
          <Slot name="media.viewer.tools" props={{ media, format }} />
          <Menu
            align="end"
            width={240}
            trigger={<IconButton icon={Ellipsis} label={t('common:more')} />}
            items={menu()}
          />
          {onTogglePanel && (
            <IconButton
              icon={panelOpen ? PanelRightClose : PanelRightOpen}
              label={panelOpen ? t('hidePanel') : t('showPanel')}
              shortcut="mod+."
              onClick={onTogglePanel}
            />
          )}
        </div>
      </div>
      {ownRow && switches && (
        // Centred while it fits, scrolled from its start when it doesn't.
        <div className={cn('no-scrollbar shrink-0 overflow-x-auto pb-2', compact ? 'px-2' : 'px-3')}>
          {switches}
        </div>
      )}
    </>
  )
}

/** Previous / next in the list the viewer was opened from, with the place in it between them. */
function Pager({ nav, walkKeys, compact }: { nav: Neighbors; walkKeys?: boolean; compact?: boolean }) {
  const t = useT('viewer')
  const place =
    nav.position && nav.total ? t('place', { position: nav.position, total: nav.total }) : undefined
  return (
    <div className="-ml-1.5 flex shrink-0 items-center">
      <IconButton
        icon={ChevronLeft}
        label={place ? `${t('previous')} · ${place}` : t('previous')}
        shortcut={walkKeys ? 'arrowleft' : 'shift+p'}
        disabled={!nav.prev}
        onClick={() => nav.prev && nav.go(nav.prev)}
        className="text-white/80"
      />
      {!compact && nav.position && (
        <span className="min-w-[3ch] text-center t-meta tabular-nums text-white/45" aria-hidden>
          {nav.position}
          {nav.total ? <span className="text-white/25"> / {nav.total}</span> : null}
        </span>
      )}
      <IconButton
        icon={ChevronRight}
        label={place ? `${t('next')} · ${place}` : t('next')}
        shortcut={walkKeys ? 'arrowright' : 'shift+n'}
        disabled={!nav.next}
        onClick={() => nav.next && nav.go(nav.next)}
        className="text-white/80"
      />
    </div>
  )
}

function ViewerSkeleton({ embedded }: { embedded?: boolean }) {
  return (
    <div className="flex h-full bg-canvas">
      <div className="force-dark flex flex-1 flex-col bg-stage">
        <div className="flex h-[52px] items-center gap-3 px-4">
          {!embedded && <Skeleton className="size-7 rounded-full" />}
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid flex-1 place-items-center">
          <Signal tone="review" size={34} className="text-white/20" />
        </div>
      </div>
      <div className="hidden w-[384px] flex-col gap-3 bg-panel p-5 md:flex">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  )
}
