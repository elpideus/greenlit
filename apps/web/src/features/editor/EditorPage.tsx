import { contentEnd } from '@greenlit/composition'
import { PanelLeft } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router'
import { useSlot } from '@/app/Slot'
import { cn } from '@/lib/cn'
import { useStoredState } from '@/lib/dom'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { useRealtimeStatus } from '@/lib/realtime'
import { useCan } from '@/lib/session'
import { ErrorState, IconButton, Signal, Spinner } from '@/ui'
import { installAgentApi } from './agent'
import { useAssetResolver } from './assets'
import { clipActions } from './components/actions'
import { LeftPanel } from './components/Bin'
import { Inspector } from './components/Inspector'
import { Timeline } from './components/Timeline'
import { TopBar } from './components/TopBar'
import { Viewport } from './components/Viewport'
import { loadDocumentFonts } from './fonts'
import { catchUp, closeEditor, openEditor, redo, sendPresence, undo, useDoc, useEditor } from './store'

const get = useEditor.getState
const set = useEditor.setState

/**
 * The editor: media and layers on the left, the live preview in the middle, the inspector on the right, the
 * timeline below. Nothing is rendered while editing — the Stage draws every frame in the browser, exactly as the
 * export will.
 */
export default function EditorPage() {
  const { id } = useParams()
  const t = useT('editor')
  const canEdit = useCan('compositions.edit')
  const status = useEditor((s) => s.status)
  const error = useEditor((s) => s.error)
  const doc = useDoc()
  const assets = useAssetResolver(doc)
  const [timelineH, setTimelineH] = useStoredState('editor.timelineH', 300)
  const [leftOpen, setLeftOpen] = useStoredState('editor.left', true)

  // ── session (ownership-guarded: only the session that owns the store resets it) ──
  useEffect(() => {
    if (!id) return
    let session: string | null = null
    let alive = true
    void openEditor(id, !canEdit).then((s) => {
      if (alive) session = s
      else closeEditor(s)
    })
    const uninstall = installAgentApi()
    return () => {
      alive = false
      uninstall()
      if (session) closeEditor(session)
    }
  }, [id, canEdit])

  // Fonts used by text clips, loaded as the document changes.
  const fontsKey = useMemo(
    () =>
      doc
        ? JSON.stringify([
            doc.fonts,
            doc.tracks.flatMap((tr) =>
              tr.clips.filter((c) => c.type === 'text').map((c) => [c.text?.fontFamily, c.text?.fontWeight]),
            ),
          ])
        : '',
    [doc],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the fonts in use
  useEffect(() => {
    if (doc) void loadDocumentFonts(doc)
  }, [fontsKey])

  // ── playback: real time while playing (J/K/L rates, reverse scrubs) ──
  const playing = useEditor((s) => s.playing)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const s = get()
      const d = s.doc
      if (!d) return
      const dt = ((now - last) / 1000) * s.rate
      last = now
      const end = Math.max(d.duration, contentEnd(d))
      let next = s.time + dt
      if (next >= end) {
        set({ time: end - 1 / d.fps, playing: false })
        return
      }
      if (next <= 0) {
        next = 0
        set({ time: 0, playing: false })
        return
      }
      set({ time: next })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    sendPresence()
    return () => {
      cancelAnimationFrame(raf)
      sendPresence()
    }
  }, [playing])

  // ── presence: where my playhead is, what I selected ──
  useEffect(() => {
    const unsub = useEditor.subscribe((s, p) => {
      if (s.selection !== p.selection || s.formatId !== p.formatId || (!s.playing && s.time !== p.time))
        sendPresence()
    })
    const keep = setInterval(sendPresence, 20_000)
    return () => {
      unsub()
      clearInterval(keep)
    }
  }, [])

  // ── catch up after a reconnect ──
  const rt = useRealtimeStatus()
  const prevRt = useRef(rt)
  useEffect(() => {
    if (prevRt.current !== 'open' && rt === 'open') void catchUp()
    if (rt === 'closed' && get().status !== 'loading') set({ status: 'offline' })
    if (rt === 'open' && get().status === 'offline') set({ status: 'ready' })
    prevRt.current = rt
  }, [rt])

  useEditorHotkeys()

  if (status === 'error')
    return (
      <div className="grid min-h-dvh place-items-center">
        <ErrorState
          title={t('errors.load')}
          error={error}
          retry={() => id && void openEditor(id, !canEdit)}
        />
      </div>
    )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <TopBar />
      {!doc ? (
        <div className="grid flex-1 place-items-center">
          <div className="flex flex-col items-center gap-3 text-ink-3">
            <Signal tone="review" size={34} />
            <Spinner size={14} />
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            <aside
              className={cn(
                'flex min-h-0 shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-300 ease-out',
                leftOpen ? 'w-[268px]' : 'w-11',
              )}
            >
              {leftOpen ? (
                <LeftPanel />
              ) : (
                <div className="flex justify-center pt-2">
                  <IconButton icon={PanelLeft} label={t('bin.media')} onClick={() => setLeftOpen(true)} />
                </div>
              )}
            </aside>
            <div className="relative flex min-w-0 flex-1 flex-col">
              {leftOpen && (
                <div className="absolute top-2 left-2 z-10">
                  <IconButton
                    icon={PanelLeft}
                    size="sm"
                    variant="overlay"
                    label={t('bin.media')}
                    onClick={() => setLeftOpen(false)}
                  />
                </div>
              )}
              <Viewport assets={assets} />
            </div>
            <RightPanel />
          </div>
          <ResizeHandle height={timelineH} onChange={setTimelineH} />
          <Timeline media={assets.media} height={timelineH} />
        </>
      )}
    </div>
  )
}

function RightPanel() {
  const t = useT('editor')
  const tab = useEditor((s) => s.rightTab)
  const meta = useEditor((s) => s.meta)
  const doc = useEditor((s) => s.doc)
  const composition = useMemo(() => (meta && doc ? { ...meta, document: doc } : null), [meta, doc])
  const panels = useSlot('composition.panels', { composition })
  const active = panels.find((p) => p.id === tab)
  const ActiveComp = active?.component
  return (
    <aside className="flex min-h-0 w-[328px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line px-3.5">
        {[{ id: 'inspector', label: t('inspector.inspector'), feature: 'editor' }, ...panels].map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => set({ rightTab: p.id })}
            className={cn(
              'press relative flex h-full items-center t-callout',
              tab === p.id || (!active && p.id === 'inspector')
                ? 'font-[550] text-ink'
                : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {p.id === 'inspector' ? p.label : t(`${p.feature}:${p.label}`, { defaultValue: p.label })}
            {(tab === p.id || (!active && p.id === 'inspector')) && (
              <span className="absolute right-0 bottom-0 left-0 h-[2px] rounded-full bg-ink" />
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ActiveComp && composition ? <ActiveComp composition={composition} /> : <Inspector />}
      </div>
    </aside>
  )
}

function ResizeHandle({ height, onChange }: { height: number; onChange: (h: number) => void }) {
  const drag = useRef<{ y: number; h: number } | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="group relative z-10 h-1.5 shrink-0 cursor-row-resize border-t border-line bg-panel"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y: e.clientY, h: height }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        onChange(
          Math.max(160, Math.min(window.innerHeight * 0.65, drag.current.h - (e.clientY - drag.current.y))),
        )
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    >
      <span className="absolute top-1/2 left-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  )
}

function useEditorHotkeys() {
  const step = (secs: number) => {
    const s = get()
    const fps = s.doc?.fps ?? 30
    set({ time: Math.max(0, Math.round((s.time + secs) * fps) / fps), playing: false })
  }
  const frame = () => 1 / (get().doc?.fps ?? 30)
  useHotkey('space', () => set((s) => ({ playing: !s.playing, rate: 1 })))
  useHotkey('k', () => set({ playing: false, rate: 1 }))
  useHotkey('l', () =>
    set((s) => ({ playing: true, rate: s.playing && s.rate > 0 ? Math.min(8, s.rate * 2) : 1 })),
  )
  useHotkey('j', () =>
    set((s) => ({ playing: true, rate: s.playing && s.rate < 0 ? Math.max(-8, s.rate * 2) : -1 })),
  )
  useHotkey('arrowleft', () => step(-frame()))
  useHotkey('arrowright', () => step(frame()))
  useHotkey('shift+arrowleft', () => step(-1))
  useHotkey('shift+arrowright', () => step(1))
  useHotkey('home', () => set({ time: 0, playing: false }))
  useHotkey('end', () => {
    const d = get().doc
    if (d) set({ time: Math.max(0, d.duration - 1 / d.fps), playing: false })
  })
  useHotkey('s', () => clipActions.split())
  useHotkey(['backspace', 'delete'], () => clipActions.remove())
  useHotkey('mod+d', () => clipActions.duplicate())
  useHotkey('mod+c', () => clipActions.copy())
  useHotkey('mod+x', () => clipActions.cut())
  useHotkey('mod+v', () => clipActions.paste())
  useHotkey('mod+a', () => clipActions.selectAll())
  useHotkey('mod+z', (e) => !e.shiftKey && undo())
  useHotkey(['mod+shift+z', 'mod+y'], () => redo())
  useHotkey('escape', () => set({ selection: [] }), { preventDefault: false })
  useHotkey('t', () => clipActions.add('text'))
  useHotkey(['=', '+'], () => set((s) => ({ pxPerSec: Math.min(600, s.pxPerSec * 1.4) })))
  useHotkey('-', () => set((s) => ({ pxPerSec: Math.max(4, s.pxPerSec / 1.4) })))
  useHotkey('shift+z', () => window.dispatchEvent(new Event('gl-editor-fit')))
  useHotkey('mod+e', () => window.dispatchEvent(new Event('gl-editor-export')))
}
