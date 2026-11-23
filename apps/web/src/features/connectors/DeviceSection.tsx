import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Circle, Eye, EyeOff, Hand, Search, Send, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/SettingsSection'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { useCan } from '@/lib/session'
import { Button, Input, Skeleton, StatusLabel, Toggle, Tooltip, toast } from '@/ui'
import { useRefreshAccounts } from './api'

interface DeviceStatus {
  configured: boolean
  online: boolean
  booted: boolean
  serial: string | null
  model: string | null
  android: string | null
  screen: { width: number; height: number } | null
  message: string | null
}

type DeviceInput =
  | { type: 'tap'; x: number; y: number }
  | { type: 'swipe'; x1: number; y1: number; x2: number; y2: number; ms: number }
  | { type: 'key'; key: 'back' | 'home' | 'recents' | 'enter' | 'delete' | 'tab' | 'escape' }
  | { type: 'text'; text: string }

/** Greenlit's own Android device: its state, its screen, and (when you choose to) your hands on it. */
export default function DeviceSection() {
  const t = useT('connectors')
  const manageAccounts = useCan('connectors.manage')
  const refreshAccounts = useRefreshAccounts()
  const { data: status, isLoading } = useQuery({
    queryKey: ['android'],
    queryFn: () => api.get<DeviceStatus>('/android'),
    refetchInterval: (q) => (q.state.data?.booted ? 30_000 : 5_000),
  })
  const [watch, setWatch] = useState(false)
  const [interact, setInteract] = useState(false)
  const [scanning, setScanning] = useState(false)

  const statusKey = !status
    ? null
    : !status.configured
      ? 'notConfigured'
      : !status.online
        ? 'offline'
        : !status.booted
          ? 'starting'
          : 'online'

  return (
    <SettingsSection title={t('device.section')} description={t('device.description')}>
      {isLoading || !status ? (
        <Skeleton className="h-40 rounded-panel" />
      ) : (
        <SettingsGroup>
          <SettingsRow
            label={t('device.status')}
            description={
              statusKey === 'notConfigured'
                ? t('device.notConfiguredBody')
                : statusKey === 'offline'
                  ? t('device.offlineBody')
                  : status.message
            }
          >
            <StatusLabel
              status={
                statusKey === 'online' ? 'connected' : statusKey === 'starting' ? 'connecting' : 'needs_login'
              }
              label={t(`device.${statusKey}`)}
              className="t-callout"
            />
          </SettingsRow>
          {status.model && (
            <SettingsRow label={t('device.model')}>
              <span className="t-meta text-ink-2">
                {status.model} · {t('device.android')} {status.android} · {status.serial}
              </span>
            </SettingsRow>
          )}
          {manageAccounts && status.booted && (
            <SettingsRow label={t('device.scan')} description={t('device.scanHint')}>
              <Button
                size="sm"
                icon={Search}
                loading={scanning}
                onClick={async () => {
                  setScanning(true)
                  try {
                    const r = await api.post<{ joined: unknown[] }>('/connectors/device/scan')
                    toast.done(t('device.scanned', { count: r.joined.length }))
                    void refreshAccounts()
                  } catch (err) {
                    toast.error(err)
                  } finally {
                    setScanning(false)
                  }
                }}
              >
                {t('device.scan')}
              </Button>
            </SettingsRow>
          )}
        </SettingsGroup>
      )}

      {status?.booted && status.screen && (
        <SettingsGroup
          title={t('device.screen')}
          aside={
            <Button
              size="sm"
              variant={watch ? 'ghost' : 'secondary'}
              icon={watch ? EyeOff : Eye}
              onClick={() => setWatch((w) => !w)}
            >
              {watch ? t('device.stop') : t('device.watch')}
            </Button>
          }
          bare
        >
          {watch ? (
            <DeviceScreen
              width={status.screen.width}
              height={status.screen.height}
              interact={interact}
              onInteract={setInteract}
            />
          ) : (
            <button
              type="button"
              onClick={() => setWatch(true)}
              className="press flex w-full items-center gap-4 rounded-panel px-5 py-5 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
            >
              <span className="grid h-14 w-8 shrink-0 place-items-center rounded-[9px] bg-[#0a0b0a] shadow-[inset_0_0_0_1.5px_var(--line-strong)]">
                <span className="h-10 w-5 rounded-[4px] bg-[color-mix(in_oklab,var(--ink)_10%,#0a0b0a)]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block t-callout font-[550] text-ink">{t('device.paused')}</span>
                <span className="block t-caption text-ink-3">
                  {status.screen.width} × {status.screen.height}
                </span>
              </span>
              <Eye size={16} className="text-ink-3" />
            </button>
          )}
        </SettingsGroup>
      )}
    </SettingsSection>
  )
}

function DeviceScreen({
  width,
  height,
  interact,
  onInteract,
}: {
  width: number
  height: number
  interact: boolean
  onInteract: (v: boolean) => void
}) {
  const t = useT('connectors')
  const img = useRef<HTMLImageElement>(null)
  const [live, setLive] = useState(false)
  const [text, setText] = useState('')
  const drag = useRef<{ x: number; y: number; t: number } | null>(null)

  // One frame at a time: the next is asked for when the last has arrived.
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const next = () => {
      if (stopped || !img.current) return
      img.current.src = `/api/android/screen?t=${Date.now()}`
    }
    const el = img.current
    const onLoad = () => {
      setLive(true)
      timer = setTimeout(next, document.hidden ? 2000 : 450)
    }
    const onError = () => {
      setLive(false)
      timer = setTimeout(next, 2500)
    }
    el?.addEventListener('load', onLoad)
    el?.addEventListener('error', onError)
    next()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      el?.removeEventListener('load', onLoad)
      el?.removeEventListener('error', onError)
    }
  }, [])

  const send = (input: DeviceInput) => api.post('/android/input', input).catch((err) => toast.error(err))
  const toDevice = (e: React.PointerEvent) => {
    const r = img.current!.getBoundingClientRect()
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * width),
      y: Math.round(((e.clientY - r.top) / r.height) * height),
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 rounded-panel bg-well px-4 py-6 shadow-[inset_0_0_0_1px_var(--line)] sm:flex-row sm:items-start sm:justify-center sm:gap-8">
      <div
        className="relative shrink-0 rounded-[34px] bg-[#0a0b0a] p-2.5 shadow-[0_0_0_1px_rgba(255,255,255,.08),0_24px_60px_-20px_rgba(0,0,0,.7)]"
        style={{ width: 290 }}
      >
        <div
          className="relative overflow-hidden rounded-[26px] bg-black"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <img
            ref={img}
            alt={t('device.screen')}
            draggable={false}
            className={cn(
              'absolute inset-0 size-full object-cover transition-opacity duration-300',
              live ? 'opacity-100' : 'opacity-0',
              interact ? 'cursor-pointer' : 'cursor-default',
            )}
            onPointerDown={(e) => {
              if (!interact) return
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { ...toDevice(e), t: performance.now() }
            }}
            onPointerUp={(e) => {
              if (!interact || !drag.current) return
              const end = toDevice(e)
              const start = drag.current
              drag.current = null
              const moved = Math.hypot(end.x - start.x, end.y - start.y)
              if (moved < 24) void send({ type: 'tap', x: start.x, y: start.y })
              else
                void send({
                  type: 'swipe',
                  x1: start.x,
                  y1: start.y,
                  x2: end.x,
                  y2: end.y,
                  ms: Math.max(80, Math.min(1500, Math.round(performance.now() - start.t))),
                })
            }}
          />
          {!live && <Skeleton className="absolute inset-0 rounded-none" />}
        </div>
        <span
          className={cn(
            'absolute top-4 right-5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 t-micro text-[10px] text-white/80',
            !live && 'hidden',
          )}
        >
          <span className="size-1.5 rounded-full bg-[#f75d59]" />
          {t('device.live')}
        </span>
      </div>
      <div className="flex w-full max-w-[300px] flex-col gap-4 pt-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 t-callout font-[550] text-ink">
              <Hand size={15} className="text-ink-3" />
              {t('device.interact')}
            </div>
            <div className="mt-0.5 t-caption text-ink-3">{t('device.interactHint')}</div>
          </div>
          <Toggle checked={interact} onChange={onInteract} />
        </div>
        <div className={cn('flex gap-2 transition-opacity', !interact && 'pointer-events-none opacity-40')}>
          {(
            [
              ['back', ArrowLeft],
              ['home', Circle],
              ['recents', Square],
            ] as const
          ).map(([key, Icon]) => (
            <Tooltip key={key} label={t(`device.${key}`)}>
              <button
                type="button"
                onClick={() => void send({ type: 'key', key })}
                className="press grid h-9 flex-1 place-items-center rounded-control bg-raised text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:text-ink"
                aria-label={t(`device.${key}`)}
              >
                <Icon size={15} strokeWidth={1.8} />
              </button>
            </Tooltip>
          ))}
        </div>
        <form
          className={cn('flex gap-2 transition-opacity', !interact && 'pointer-events-none opacity-40')}
          onSubmit={(e) => {
            e.preventDefault()
            if (!text) return
            void send({ type: 'text', text }).then(() => setText(''))
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('device.typeHere')}
            autoComplete="off"
            className="flex-1"
          />
          <Button type="submit" icon={Send} disabled={!text}>
            {t('device.send')}
          </Button>
        </form>
      </div>
    </div>
  )
}
