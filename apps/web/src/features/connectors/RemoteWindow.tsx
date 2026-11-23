import type { Account, Platform } from '@greenlit/shared'
import { ArrowLeft, ArrowRight, Cookie, Lock, RotateCw, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PLATFORM_NAME, PlatformIcon } from '@/components/PlatformIcon'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { realtime, useTopic } from '@/lib/realtime'
import { Button, IconButton, Signal, Spinner } from '@/ui'
import { accountsApi, type SessionView } from './api'
import { ChoiceList } from './ChooseAccounts'

/** Keys sent as key events; everything else typed arrives as text (IME-safe), like the server expects. */
const NAMED = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
])

function modifiers(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
}

const BUTTON = ['left', 'middle', 'right'] as const

/**
 * The platform's real sign-in page, streamed from Greenlit's browser: frames come over `connector-session:<id>`,
 * pointer, wheel, keys and text go back as `input` messages. Two-step verification, QR codes and captchas are in
 * front of a person, never automated.
 */
export function RemoteWindow({
  platform,
  driver,
  accountId,
  host,
  qr,
  onConnected,
  onCookies,
  onClose,
}: {
  platform: Platform
  driver: string | null
  accountId: string | null
  host: string
  qr: boolean
  onConnected: (accounts: Account[]) => void
  onCookies: () => void
  onClose: () => void
}) {
  const t = useT('connectors')
  const stage = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const keys = useRef<HTMLTextAreaElement>(null)
  const [session, setSession] = useState<SessionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasFrame, setHasFrame] = useState(false)
  const [cursor, setCursor] = useState('default')
  const [connected, setConnected] = useState<Account[] | null>(null)
  const [closedReason, setClosedReason] = useState<string | null>(null)
  const [choice, setChoice] = useState<string[]>([])
  const [choosing, setChoosing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const started = useRef<string | null>(null)
  const topic = session ? `connector-session:${session.id}` : null

  // Open a session sized to the window (once per attempt; React's dev double-run is guarded).
  useEffect(() => {
    const key = `${attempt}`
    if (started.current === key) return
    started.current = key
    const box = stage.current?.getBoundingClientRect()
    const width = Math.round(Math.max(360, Math.min(2560, box?.width ?? 1100)))
    const height = Math.round(Math.max(320, Math.min(1600, box?.height ?? 680)))
    setError(null)
    setHasFrame(false)
    setConnected(null)
    setClosedReason(null)
    accountsApi
      .startSession({
        platform,
        driver,
        accountId,
        width,
        height,
        dpr: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
      })
      .then(setSession)
      .catch((err) => setError(errorMessage(err)))
  }, [attempt, platform, driver, accountId])

  // Close the window on the server when this one goes away.
  const live = useRef<string | null>(null)
  useEffect(() => {
    live.current = session && session.state !== 'closed' ? session.id : null
  }, [session])
  useEffect(() => () => void (live.current && accountsApi.closeSession(live.current).catch(() => {})), [])

  const send = useCallback(
    (data: Record<string, unknown>) => topic && realtime.send(topic, 'input', data),
    [topic],
  )

  useTopic<Record<string, unknown>>(topic, (msg) => {
    if (msg.event === 'frame') {
      const f = msg.data as { data: string }
      if (img.current) img.current.src = `data:image/jpeg;base64,${f.data}`
      if (!hasFrame) setHasFrame(true)
    } else if (msg.event === 'state') {
      setSession((s) => ({ ...(s ?? {}), ...(msg.data as SessionView) }))
    } else if (msg.event === 'cursor') {
      setCursor(String((msg.data as { cursor: string }).cursor || 'default'))
    } else if (msg.event === 'event') {
      const ev = msg.data as { kind?: string; accounts?: Account[] }
      if (ev.kind === 'connected' && ev.accounts) setConnected(ev.accounts)
    } else if (msg.event === 'closed') {
      setClosedReason(String((msg.data as { reason?: string }).reason ?? ''))
      live.current = null
    }
  })

  // Ask for the last frame until one arrives (the subscription and the hello can cross on the server).
  useEffect(() => {
    if (!topic || hasFrame) return
    const first = setTimeout(() => send({ type: 'hello' }), 300)
    const again = setInterval(() => send({ type: 'hello' }), 2000)
    return () => {
      clearTimeout(first)
      clearInterval(again)
    }
  }, [topic, hasFrame, send])

  // Follow the window's size.
  useEffect(() => {
    if (!topic || !stage.current) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(([e]) => {
      if (!e) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        send({
          type: 'resize',
          width: Math.round(Math.max(360, Math.min(2560, e.contentRect.width))),
          height: Math.round(Math.max(320, Math.min(1600, e.contentRect.height))),
          dpr: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
        })
      }, 300)
    })
    ro.observe(stage.current)
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [topic, send])

  // Connected: let the lamp light, then hand back.
  useEffect(() => {
    if (!connected) return
    const timer = setTimeout(() => onConnected(connected), 1700)
    return () => clearTimeout(timer)
  }, [connected, onConnected])

  // Wheel needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = img.current
    if (!el || !session) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = point(e)
      if (p) send({ type: 'wheel', ...p, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiers(e) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const point = (e: { clientX: number; clientY: number }) => {
    const el = img.current
    if (!el || !session) return null
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * session.width),
      y: Math.round(((e.clientY - r.top) / r.height) * session.height),
    }
  }
  /** Keys go to the hidden textarea, which turns them into `key` / `text` messages. */
  const focusKeys = () => keys.current?.focus({ preventScroll: true })

  // The page usually focuses its first field by itself: be ready to type as soon as it shows.
  useEffect(() => {
    if (hasFrame) keys.current?.focus({ preventScroll: true })
  }, [hasFrame])

  const lastMove = useRef(0)
  const onPointer = (action: 'move' | 'down' | 'up') => (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && action === 'move' && !e.buttons) return
    const now = performance.now()
    if (action === 'move' && now - lastMove.current < 16) return
    lastMove.current = now
    const p = point(e)
    if (!p) return
    if (action === 'down') {
      e.currentTarget.setPointerCapture(e.pointerId)
      focusKeys()
    }
    send({
      type: 'mouse',
      action,
      ...p,
      button: action === 'move' ? (e.buttons & 1 ? 'left' : 'none') : (BUTTON[e.button] ?? 'left'),
      buttons: e.buttons,
      clickCount: Math.max(1, e.detail || 1),
      modifiers: modifiers(e),
    })
  }
  const onKey = (action: 'down' | 'up') => (e: React.KeyboardEvent) => {
    const combo = e.ctrlKey || e.metaKey || e.altKey
    if (!NAMED.has(e.key) && !combo && !/^F\d{1,2}$/.test(e.key)) return
    // Let the browser paste into the field (it becomes a `text` message).
    if (combo && e.key.toLowerCase() === 'v') return
    e.preventDefault()
    send({
      type: 'key',
      action,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      modifiers: modifiers(e),
      repeat: e.repeat,
      location: e.location,
    })
  }

  const state = session?.state
  const signingIn = state === 'signed_in' && !connected
  const failed = !!error || state === 'failed'
  const closed = state === 'closed' || closedReason !== null

  return (
    <div className="flex h-[min(86dvh,860px)] flex-col">
      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <IconButton
          icon={ArrowLeft}
          label={t('remote.back')}
          size="sm"
          disabled={!session?.canGoBack}
          onClick={() => send({ type: 'nav', action: 'back' })}
        />
        <IconButton
          icon={ArrowRight}
          label={t('remote.forward')}
          size="sm"
          disabled={!session?.canGoForward}
          onClick={() => send({ type: 'nav', action: 'forward' })}
        />
        <IconButton
          icon={RotateCw}
          label={t('remote.reload')}
          size="sm"
          disabled={!session}
          onClick={() => send({ type: 'nav', action: 'reload' })}
        />
        <div className="mx-2 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control bg-well px-3 shadow-[inset_0_0_0_1px_var(--line)]">
          {session?.loading ? (
            <Spinner size={12} className="text-ink-3" />
          ) : (
            <Lock size={12} className="shrink-0 text-ink-3" />
          )}
          <span className="truncate t-caption text-ink-2">
            {session?.url ? new URL(session.url).host : host}
          </span>
          {session?.title && (
            <span className="hidden truncate t-caption text-ink-4 sm:inline">— {session.title}</span>
          )}
        </div>
        <Button size="sm" variant="ghost" icon={Cookie} onClick={onCookies}>
          {t('dialog.cookiesInstead')}
        </Button>
        <IconButton icon={X} label={t('remote.close')} size="sm" onClick={onClose} />
      </div>

      {/* the page */}
      <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden bg-[#fff]">
        <img
          ref={img}
          alt=""
          draggable={false}
          onPointerMove={onPointer('move')}
          onPointerDown={onPointer('down')}
          onPointerUp={onPointer('up')}
          // A click would otherwise move the focus to the dialog (the nearest focusable box) and drop every key.
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            'absolute inset-0 size-full object-fill transition-opacity duration-300 select-none',
            hasFrame ? 'opacity-100' : 'opacity-0',
          )}
          style={{ cursor }}
        />
        <textarea
          ref={keys}
          aria-label={t('remote.title', { platform: PLATFORM_NAME[platform] })}
          className="absolute -top-10 left-0 size-1 opacity-0"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={onKey('down')}
          onKeyUp={onKey('up')}
          onInput={(e) => {
            const el = e.currentTarget
            if ((e.nativeEvent as InputEvent).isComposing) return
            if (el.value) send({ type: 'text', text: el.value })
            el.value = ''
          }}
          onCompositionEnd={(e) => {
            if (e.data) send({ type: 'text', text: e.data })
            e.currentTarget.value = ''
          }}
          onPaste={(e) => {
            e.preventDefault()
            const text = e.clipboardData.getData('text')
            if (text) send({ type: 'text', text })
          }}
        />

        <AnimatePresence>
          {!hasFrame && !failed && !closed && (
            <motion.div
              key="loading"
              exit={{ opacity: 0 }}
              className="absolute inset-0 grid place-items-center bg-raised"
            >
              <div className="flex flex-col items-center gap-4">
                <PlatformIcon platform={platform} size={44} tile />
                <div className="flex items-center gap-2 t-callout text-ink-3">
                  <Spinner size={14} />
                  {t('remote.starting', { host })}
                </div>
              </div>
            </motion.div>
          )}
          {signingIn && (
            <motion.div
              key="reading"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease }}
              className="floating absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2.5 px-4 py-2.5 t-callout text-ink"
            >
              <Spinner size={14} className="text-signal" />
              {session?.message ?? t('remote.reading')}
            </motion.div>
          )}
          {connected && (
            <motion.div
              key="connected"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 grid place-items-center bg-[color-mix(in_oklab,var(--raised)_94%,transparent)] backdrop-blur-md"
            >
              <motion.div
                initial={{ scale: 0.96, y: 8 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ duration: 0.45, ease }}
                className="flex flex-col items-center text-center"
              >
                <Signal tone="greenlit" size={56} />
                <div className="mt-5 t-title-2 text-ink">{t('remote.connected')}</div>
                <div className="mt-1.5 t-callout text-ink-3">{t('remote.connectedBody')}</div>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {connected.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1.5 rounded-tag bg-hover px-2 py-1 t-caption text-ink-2"
                    >
                      <PlatformIcon platform={a.platform} size={12} />
                      {a.name}
                    </span>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
          {state === 'choosing' && !connected && session?.choices && (
            <motion.div
              key="choosing"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.3, ease }}
              className="absolute inset-y-3 right-3 flex w-[400px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-sheet bg-raised shadow-[var(--shadow-sheet),inset_0_0_0_.5px_var(--line-strong)]"
            >
              <div className="px-5 pt-5 pb-2">
                <div className="t-title-2 text-ink">{t('remote.choose')}</div>
                <p className="mt-1 t-callout text-ink-3">{t('remote.chooseBody')}</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
                <ChoiceList choices={session.choices} value={choice} onChange={setChoice} />
              </div>
              <div className="flex justify-end border-t border-line px-5 py-3">
                <Button
                  variant="primary"
                  disabled={!choice.length}
                  loading={choosing}
                  onClick={async () => {
                    setChoosing(true)
                    try {
                      setConnected(await accountsApi.choose(session.id, choice))
                    } catch (err) {
                      setError(errorMessage(err))
                    } finally {
                      setChoosing(false)
                    }
                  }}
                >
                  {t('remote.connectN', { count: choice.length })}
                </Button>
              </div>
            </motion.div>
          )}
          {(failed || closed) && !connected && (
            <motion.div
              key="problem"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn(
                'absolute inset-x-0 bottom-0 flex justify-center p-4',
                (!hasFrame || closed) && 'inset-0 items-center bg-raised',
              )}
            >
              <div className="floating flex max-w-lg flex-col items-center gap-3 px-6 py-5 text-center">
                <Signal tone="changes" size={34} />
                <div className="t-headline text-ink">{closed ? t('remote.closed') : t('remote.failed')}</div>
                {(error || session?.message || closedReason) && (
                  <div className="t-callout text-ink-3">
                    {error ?? (closed ? closedReason : session?.message)}
                  </div>
                )}
                <div className="mt-1 flex gap-2">
                  <Button variant="ghost" icon={Cookie} onClick={onCookies}>
                    {t('dialog.cookiesInstead')}
                  </Button>
                  <Button variant="primary" icon={RotateCw} onClick={() => setAttempt((n) => n + 1)}>
                    {t('remote.tryAgain')}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* what to do */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line px-4 t-caption text-ink-3">
        <PlatformIcon platform={platform} size={14} />
        <span className="min-w-0 flex-1 truncate">
          {qr ? t('remote.qrHint', { platform: PLATFORM_NAME[platform] }) : t('remote.hint')}
        </span>
        <span className="hidden shrink-0 text-ink-4 md:inline">{t('remote.privacy')}</span>
      </div>
    </div>
  )
}
