import type { CalendarEntry, Platform } from '@greenlit/shared'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { PLATFORM_NAME, PlatformIcon } from '@/components/PlatformIcon'
import { useAccounts } from '@/data/accounts'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useIsPhone, useStoredState } from '@/lib/dom'
import { useHotkey } from '@/lib/hotkeys'
import { currentLanguage, useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { useLiveQuery } from '@/lib/realtime'
import { useCan } from '@/lib/session'
import {
  formatDateTime,
  useTimeZone,
  useWeekStart,
  zonedDayKey,
  zonedParts,
  zonedToInstant,
  zoneLabel,
} from '@/lib/time'
import {
  Button,
  confirm,
  IconButton,
  Page,
  Popover,
  Segmented,
  Select,
  Tally,
  type Tone,
  Tooltip,
  toast,
} from '@/ui'

type View = 'month' | 'week'
const HOUR = 52

function tone(e: CalendarEntry): Tone {
  if (e.state === 'published') return 'live'
  if (e.state === 'scheduled') return 'scheduled'
  if (e.state === 'failed') return 'failed'
  if (e.state === 'queued') return new Date(e.at).getTime() > Date.now() ? 'scheduled' : 'review'
  if (e.state === 'preparing' || e.state === 'uploading') return 'review'
  return 'draft'
}

function useCalendarEntries(from: Date, to: Date, filter: { platform?: string; accountId?: string }) {
  useLiveQuery('calendar', [['calendar']])
  return useQuery({
    queryKey: ['calendar', from.toISOString(), to.toISOString(), filter],
    queryFn: () =>
      api.get<CalendarEntry[]>('/calendar', { from: from.toISOString(), to: to.toISOString(), ...filter }),
    placeholderData: keepPreviousData,
  })
}

/** Day arithmetic on wall-clock dates (y, m, d) — independent of the browser's zone. */
const addDays = (p: { year: number; month: number; day: number }, n: number) => {
  const d = new Date(Date.UTC(p.year, p.month, p.day + n))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }
}
const weekdayOf = (p: { year: number; month: number; day: number }) =>
  new Date(Date.UTC(p.year, p.month, p.day)).getUTCDay()
const keyOf = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`

/**
 * Everything scheduled and published, on the platform time zone's calendar. Drag a version to another day (or hour,
 * in the week) to move it — on the platform too when it is already scheduled there.
 */
export default function CalendarPage() {
  const t = useT('calendar')
  const tz = useTimeZone()
  const weekStart = useWeekStart()
  const navigate = useNavigate()
  const phone = useIsPhone()
  const canMove = useCan('posts.publish')
  const qc = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  const [view, setView] = useStoredState<View>('calendar.view', 'month')
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [account, setAccount] = useState('all')
  const today = zonedParts(Date.now(), tz)
  const [anchor, setAnchor] = useState({ year: today.year, month: today.month, day: today.day })
  const [dir, setDir] = useState(0)

  // The grid's days (wall-clock), and the instants that bound them.
  const days = useMemo(() => {
    if (view === 'week') {
      const start = addDays(anchor, -((weekdayOf(anchor) - weekStart + 7) % 7))
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }
    const first = { year: anchor.year, month: anchor.month, day: 1 }
    const start = addDays(first, -((weekdayOf(first) - weekStart + 7) % 7))
    const last = addDays({ year: anchor.year, month: anchor.month + 1, day: 1 }, -1)
    const count = Math.ceil(((weekdayOf(first) - weekStart + 7) % 7) + last.day) > 35 ? 42 : 35
    return Array.from({ length: count }, (_, i) => addDays(start, i))
  }, [view, anchor, weekStart])
  const from = zonedToInstant(days[0]!, tz)
  const to = zonedToInstant(addDays(days.at(-1)!, 1), tz)
  const { data: entries = [] } = useCalendarEntries(from, to, {
    accountId: account === 'all' ? undefined : account,
  })
  const shown = entries.filter((e) => !platforms.length || platforms.includes(e.platform))
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>()
    for (const e of shown) {
      const k = zonedDayKey(e.at, tz)
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return m
  }, [shown, tz])

  const step = (n: number) => {
    setDir(n)
    setAnchor((a) => (view === 'week' ? addDays(a, 7 * n) : { year: a.year, month: a.month + n, day: 1 }))
  }
  // normalise month overflow
  useEffect(() => {
    const d = new Date(Date.UTC(anchor.year, anchor.month, anchor.day))
    if (d.getUTCMonth() !== anchor.month || d.getUTCFullYear() !== anchor.year)
      setAnchor({ year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() })
  }, [anchor])
  useHotkey('arrowleft', () => step(-1))
  useHotkey('arrowright', () => step(1))
  useHotkey('t', () => setAnchor({ year: today.year, month: today.month, day: today.day }))

  const title = useMemo(() => {
    const lang = currentLanguage()
    if (view === 'month')
      return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(Date.UTC(anchor.year, anchor.month, 1)),
      )
    const a = days[0]!
    const b = days[6]!
    const f = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    return `${f.format(new Date(Date.UTC(a.year, a.month, a.day)))} – ${f.format(new Date(Date.UTC(b.year, b.month, b.day)))} ${b.year}`
  }, [view, anchor, days])

  const move = async (
    e: CalendarEntry,
    target: { year: number; month: number; day: number; minutes?: number },
  ) => {
    const cur = zonedParts(e.at, tz)
    const minutes = target.minutes ?? cur.hour * 60 + cur.minute
    const at = zonedToInstant({ ...target, hour: Math.floor(minutes / 60), minute: minutes % 60 }, tz)
    if (Math.abs(at.getTime() - new Date(e.at).getTime()) < 60_000) return
    const when = formatDateTime(at, tz)
    if (e.state === 'scheduled') {
      const ok = await confirm({
        title: t('moveConfirm', { where: PLATFORM_NAME[e.platform] }),
        body: t('moveBody', { when }),
        confirm: t('move'),
      })
      if (!ok) return
    }
    // Optimistic: the entry jumps now, the server confirms.
    const key = [
      'calendar',
      from.toISOString(),
      to.toISOString(),
      { accountId: account === 'all' ? undefined : account },
    ]
    const prev = qc.getQueryData<CalendarEntry[]>(key)
    qc.setQueryData<CalendarEntry[]>(key, (xs) =>
      xs?.map((x) => (x.targetId === e.targetId ? { ...x, at: at.toISOString() } : x)),
    )
    try {
      await api.post(`/posts/${e.postId}/targets/${e.targetId}/reschedule`, { scheduleAt: at.toISOString() })
      toast.done(t('moved', { when }))
      void qc.invalidateQueries({ queryKey: ['calendar'] })
      void qc.invalidateQueries({ queryKey: ['posts'] })
    } catch (err) {
      qc.setQueryData(key, prev)
      toast.error(err, errorMessage(err))
    }
  }

  const drag = useDrag((e, drop) => void move(e, drop))

  return (
    <Page className="pb-10">
      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="t-title-1 mr-3 min-w-0 truncate text-ink capitalize">{title}</h1>
          <IconButton
            icon={ChevronLeft}
            label={t('previous')}
            shortcut="arrowleft"
            onClick={() => step(-1)}
          />
          <IconButton icon={ChevronRight} label={t('next')} shortcut="arrowright" onClick={() => step(1)} />
          <Button
            size="sm"
            variant="ghost"
            className="ml-1"
            onClick={() => setAnchor({ year: today.year, month: today.month, day: today.day })}
          >
            {t('today')}
          </Button>
        </div>
        <span className="t-caption text-ink-4">
          {t('zone', { zone: `${tz.replace(/_/g, ' ')} (${zoneLabel(tz)})` })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-control bg-well p-[3px] shadow-[inset_0_0_0_1px_var(--line)]">
            {(['instagram', 'facebook', 'tiktok', 'youtube'] as Platform[]).map((p) => {
              const on = platforms.includes(p)
              return (
                <Tooltip key={p} label={PLATFORM_NAME[p]}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPlatforms((xs) => (on ? xs.filter((x) => x !== p) : [...xs, p]))}
                    className={cn(
                      'press grid h-[26px] w-8 place-items-center rounded-[calc(var(--r-control)-3px)]',
                      on
                        ? 'bg-raised shadow-[0_1px_2px_rgba(0,0,0,.18),inset_0_0_0_.5px_var(--line-strong)]'
                        : platforms.length
                          ? 'opacity-40 hover:opacity-80'
                          : 'opacity-75 hover:opacity-100',
                    )}
                  >
                    <PlatformIcon platform={p} size={15} />
                  </button>
                </Tooltip>
              )
            })}
          </div>
          {accounts.filter((a) => !a.mergedInto && a.state !== 'disabled').length > 1 && !phone && (
            <Select
              value={account}
              onChange={setAccount}
              className="w-48"
              options={[
                { value: 'all', label: t('allAccounts') },
                ...accounts
                  .filter((a) => !a.mergedInto && a.state !== 'disabled')
                  .map((a) => ({
                    value: a.id,
                    label: a.name,
                    icon: <PlatformIcon platform={a.platform} size={14} />,
                  })),
              ]}
            />
          )}
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: t('month') },
              { value: 'week', label: t('week') },
            ]}
          />
          <Segmented
            value="calendar"
            onChange={(v) => v === 'list' && navigate('/posts')}
            options={[
              { value: 'list', label: phone ? undefined : t('list'), icon: List, title: t('list') },
              {
                value: 'calendar',
                label: phone ? undefined : t('calendar'),
                icon: CalendarDays,
                title: t('calendar'),
              },
            ]}
          />
        </div>
      </header>

      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={`${view}:${keyOf(days[0]!)}`}
          custom={dir}
          initial={{ opacity: 0, x: dir * 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -24 }}
          transition={{ duration: 0.28, ease }}
        >
          {view === 'month' ? (
            <MonthGrid
              days={days}
              month={anchor.month}
              byDay={byDay}
              today={today}
              weekStart={weekStart}
              drag={canMove ? drag : null}
              onOpen={(e) => navigate(`/posts/${e.postId}`)}
            />
          ) : (
            <WeekGrid
              days={days}
              byDay={byDay}
              today={today}
              drag={canMove ? drag : null}
              onOpen={(e) => navigate(`/posts/${e.postId}`)}
            />
          )}
        </motion.div>
      </AnimatePresence>
      {!shown.length && (
        <p className="mt-6 text-center t-callout text-ink-3">
          {t('empty', { span: t(view === 'month' ? 'monthSpan' : 'weekSpan') })}
          <span className="block t-caption text-ink-4">{t('emptyBody')}</span>
        </p>
      )}
      {drag.ghost}
    </Page>
  )
}

// ── drag to reschedule ─────────────────────────────────────────────────────────────────

interface Drop {
  year: number
  month: number
  day: number
  minutes?: number
}

/** Pointer drag of an entry onto a day cell (`data-day`) or an hour slot (`data-day` + `data-minutes-top`). */
function useDrag(onDrop: (e: CalendarEntry, drop: Drop) => void) {
  const [state, setState] = useState<{
    entry: CalendarEntry
    x: number
    y: number
    over: string | null
  } | null>(null)
  const start = (e: React.PointerEvent, entry: CalendarEntry) => {
    if (entry.state === 'published' || e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const target = e.currentTarget as HTMLElement
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
      moved = true
      target.setPointerCapture?.(ev.pointerId)
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-day]')
      setState({
        entry,
        x: ev.clientX,
        y: ev.clientY,
        over: el ? `${el.dataset.day}${slotOf(el, ev.clientY) ?? ''}` : null,
      })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) return
      // a drag is not a click
      target.addEventListener('click', (c) => c.preventDefault(), { once: true, capture: true })
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-day]')
      setState(null)
      if (!el?.dataset.day) return
      const [y, m, d] = el.dataset.day.split('-').map(Number) as [number, number, number]
      onDrop(entry, { year: y, month: m - 1, day: d, minutes: slotOf(el, ev.clientY) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const ghost = state ? (
    <div
      className="floating pointer-events-none fixed z-[90] flex items-center gap-2 px-2.5 py-1.5 t-caption text-ink"
      style={{ left: state.x + 12, top: state.y + 10 }}
    >
      <EntryThumb entry={state.entry} small />
      <span className="max-w-[200px] truncate">{state.entry.name}</span>
    </div>
  ) : null
  return { start, over: state?.over ?? null, dragging: state?.entry.targetId ?? null, ghost }
}
type DragApi = ReturnType<typeof useDrag>

/** Minutes from midnight under the pointer in a week column (snapped to 15). */
function slotOf(el: HTMLElement, clientY: number) {
  if (el.dataset.hours !== '1') return undefined
  const r = el.getBoundingClientRect()
  const m = Math.round((((clientY - r.top) / HOUR) * 60) / 15) * 15
  return Math.max(0, Math.min(23 * 60 + 45, m))
}

// ── month ─────────────────────────────────────────────────────────────────────────────

function MonthGrid({
  days,
  month,
  byDay,
  today,
  weekStart,
  drag,
  onOpen,
}: {
  days: { year: number; month: number; day: number }[]
  month: number
  byDay: Map<string, CalendarEntry[]>
  today: { year: number; month: number; day: number }
  weekStart: number
  drag: DragApi | null
  onOpen: (e: CalendarEntry) => void
}) {
  const t = useT('calendar')
  const names = useMemo(() => {
    const f = new Intl.DateTimeFormat(currentLanguage(), { weekday: 'short', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, i) =>
      f.format(new Date(Date.UTC(2024, 0, 7 + ((i + weekStart) % 7)))),
    )
  }, [weekStart])
  const todayKey = keyOf(today)
  return (
    <div className="overflow-hidden rounded-panel bg-panel shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)]">
      <div className="grid grid-cols-7 border-b border-line">
        {names.map((n) => (
          <div key={n} className="px-3 py-2 t-micro text-ink-3 capitalize">
            {n}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const k = keyOf(d)
          const list = byDay.get(k) ?? []
          const outside = d.month !== ((month % 12) + 12) % 12
          const isToday = k === todayKey
          const over = drag?.over === k
          return (
            <div
              key={k}
              data-day={k}
              className={cn(
                'group relative min-h-[118px] border-line p-1.5 transition-colors duration-150',
                i % 7 !== 6 && 'border-r',
                i < days.length - 7 && 'border-b',
                outside && 'bg-[color-mix(in_oklab,var(--well),var(--panel)_40%)]',
                over && 'bg-signal-soft',
              )}
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <span
                  className={cn(
                    'grid h-6 min-w-6 place-items-center rounded-full px-1 t-callout tabular',
                    isToday ? 'bg-signal font-[600] text-signal-ink' : outside ? 'text-ink-4' : 'text-ink-2',
                  )}
                >
                  {d.day}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {list.slice(0, 3).map((e) => (
                  <EntryChip key={e.targetId} entry={e} drag={drag} onOpen={onOpen} />
                ))}
                {list.length > 3 && (
                  <Popover
                    align="start"
                    width={280}
                    trigger={
                      <button
                        type="button"
                        className="press rounded-[6px] px-1.5 py-0.5 text-left t-caption text-ink-3 hover:bg-hover hover:text-ink"
                      >
                        {t('more', { count: list.length - 3 })}
                      </button>
                    }
                  >
                    <div className="flex flex-col gap-1 p-2">
                      {list.map((e) => (
                        <EntryChip key={e.targetId} entry={e} drag={null} onOpen={onOpen} />
                      ))}
                    </div>
                  </Popover>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const clockFmt = new Map<string, Intl.DateTimeFormat>()
/** "9:05" / "9:05 PM": the shortest clock for chips. */
function clock(at: string, tz: string) {
  const lang = currentLanguage()
  let f = clockFmt.get(lang + tz)
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: tz })
    clockFmt.set(lang + tz, f)
  }
  return f.format(new Date(at)).replace(/\s?([AP])M$/i, (_, x: string) => x.toLowerCase())
}

function EntryChip({
  entry,
  drag,
  onOpen,
  tall,
}: {
  entry: CalendarEntry
  drag: DragApi | null
  onOpen: (e: CalendarEntry) => void
  tall?: boolean
}) {
  const t = useT('calendar')
  const tz = useTimeZone()
  const lamp = tone(entry)
  const movable = !!drag && entry.state !== 'published'
  return (
    <Tooltip
      label={`${PLATFORM_NAME[entry.platform]} · ${entry.account.name} · ${formatDateTime(entry.at, tz)}${movable ? ` · ${t('dragHint')}` : ''}`}
    >
      <button
        type="button"
        onPointerDown={movable ? (e) => drag!.start(e, entry) : undefined}
        onClick={() => onOpen(entry)}
        className={cn(
          'press group/chip relative flex w-full min-w-0 overflow-hidden rounded-[7px] bg-raised text-left shadow-[inset_0_0_0_.5px_var(--line-strong)] hover:bg-[color-mix(in_oklab,var(--raised),var(--ink)_6%)]',
          tall ? 'h-full gap-2 p-1.5' : 'h-10 gap-2 p-1 pr-2',
          drag?.dragging === entry.targetId && 'opacity-40',
          movable && 'cursor-grab',
        )}
      >
        <EntryThumb entry={entry} />
        <span className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate t-caption text-ink">{entry.name}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="t-meta shrink-0 text-[11px] text-ink-3">{clock(entry.at, tz)}</span>
            {tall && entry.caption && !entry.caption.startsWith(entry.name) && (
              <span className="min-w-0 flex-1 truncate t-caption text-ink-3">{entry.caption}</span>
            )}
            <Tally tone={lamp} size={6} className="ml-auto" />
          </span>
        </span>
      </button>
    </Tooltip>
  )
}

/** The post's picture with its platform in the corner; the platform alone when there is no picture. */
function EntryThumb({ entry, small }: { entry: CalendarEntry; small?: boolean }) {
  const [broken, setBroken] = useState(false)
  const box = small ? 'size-6' : 'aspect-square h-full'
  if (!entry.thumbnailUrl || broken)
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-[5px] bg-well', box)}>
        <PlatformIcon platform={entry.platform} size={small ? 16 : 18} tile />
      </span>
    )
  return (
    <span className={cn('relative shrink-0', box)}>
      <img
        src={entry.thumbnailUrl}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="size-full rounded-[5px] bg-stage object-cover"
        draggable={false}
      />
      <PlatformIcon
        platform={entry.platform}
        size={small ? 11 : 13}
        tile
        className="absolute -right-1 -bottom-1 shadow-[0_0_0_1.5px_var(--raised)]"
      />
    </span>
  )
}

// ── week ──────────────────────────────────────────────────────────────────────────────

function WeekGrid({
  days,
  byDay,
  today,
  drag,
  onOpen,
}: {
  days: { year: number; month: number; day: number }[]
  byDay: Map<string, CalendarEntry[]>
  today: { year: number; month: number; day: number }
  drag: DragApi | null
  onOpen: (e: CalendarEntry) => void
}) {
  const tz = useTimeZone()
  const scroller = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => zonedParts(Date.now(), tz))
  useEffect(() => {
    scroller.current?.scrollTo({ top: HOUR * 7.5 })
    const id = setInterval(() => setNow(zonedParts(Date.now(), tz)), 60_000)
    return () => clearInterval(id)
  }, [tz])
  const lang = currentLanguage()
  const head = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' })
  const todayKey = keyOf(today)
  const hours = Array.from({ length: 24 }, (_, h) => h)
  const hourLabel = (h: number) =>
    new Intl.DateTimeFormat(lang, { hour: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1, h)),
    )
  return (
    <div className="overflow-hidden rounded-panel bg-panel shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)]">
      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line">
        <div />
        {days.map((d) => {
          const k = keyOf(d)
          return (
            <div key={k} className="flex items-baseline gap-1.5 px-3 py-2.5">
              <span className="t-micro text-ink-3 capitalize">
                {head.format(new Date(Date.UTC(d.year, d.month, d.day)))}
              </span>
              <span
                className={cn(
                  'grid h-6 min-w-6 place-items-center rounded-full px-1 t-callout tabular',
                  k === todayKey ? 'bg-signal font-[600] text-signal-ink' : 'text-ink',
                )}
              >
                {d.day}
              </span>
            </div>
          )
        })}
      </div>
      <div ref={scroller} className="relative max-h-[calc(100dvh-260px)] min-h-[420px] overflow-y-auto">
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height: HOUR * 24 }}>
          <div className="relative">
            {hours.map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 t-meta text-[10.5px] text-ink-4"
                style={{ top: h * HOUR }}
              >
                {h === 0 ? '' : hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const k = keyOf(d)
            const list = byDay.get(k) ?? []
            const overHere = drag?.over?.startsWith(k)
            const slot = overHere ? Number(drag!.over!.slice(k.length)) : null
            return (
              <div key={k} data-day={k} data-hours="1" className="relative border-l border-line">
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-line/60"
                    style={{ top: h * HOUR }}
                  />
                ))}
                {slot !== null && !Number.isNaN(slot) && (
                  <div
                    className="absolute inset-x-1 h-10 rounded-[7px] bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--signal)]"
                    style={{ top: (slot / 60) * HOUR }}
                  />
                )}
                {k === todayKey && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: ((now.hour * 60 + now.minute) / 60) * HOUR }}
                  >
                    <span className="-ml-1 size-2 rounded-full bg-cut" />
                    <span className="h-[1.5px] flex-1 bg-cut" />
                  </div>
                )}
                {layoutDay(list, tz).map(({ e, top, col, cols }) => (
                  <div
                    key={e.targetId}
                    className="absolute p-0.5"
                    style={{ top, height: 50, left: `${(col / cols) * 100}%`, width: `${100 / cols}%` }}
                  >
                    <EntryChip entry={e} drag={drag} onOpen={onOpen} tall />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Side-by-side columns for entries that overlap in time. */
function layoutDay(list: CalendarEntry[], tz: string) {
  const items = list
    .map((e) => {
      const p = zonedParts(e.at, tz)
      return { e, top: ((p.hour * 60 + p.minute) / 60) * HOUR }
    })
    .sort((a, b) => a.top - b.top)
  const out: { e: CalendarEntry; top: number; col: number; cols: number }[] = []
  let group: typeof out = []
  let end = -1
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1))
    for (const g of group) out.push({ ...g, cols })
    group = []
  }
  for (const it of items) {
    if (it.top >= end) {
      flush()
      end = -1
    }
    const used = new Set(group.filter((g) => g.top + 50 > it.top).map((g) => g.col))
    let col = 0
    while (used.has(col)) col++
    group.push({ ...it, col, cols: 1 })
    end = Math.max(end, it.top + 50)
  }
  flush()
  return out
}
