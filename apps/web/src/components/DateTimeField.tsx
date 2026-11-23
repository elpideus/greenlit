import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { currentLanguage, useT } from '@/lib/i18n'
import {
  formatDate,
  formatTime,
  useTimeZone,
  useWeekStart,
  zonedParts,
  zonedToInstant,
  zoneLabel,
} from '@/lib/time'
import { Button, Popover } from '@/ui'

/**
 * A moment in the platform time zone (never the browser's): a month to pick the day and a time field, with the
 * zone's name beside it. `value`/`onChange` are ISO instants.
 */
export function DateTimeField({
  value,
  onChange,
  min,
  className,
  placeholder,
  disabled,
}: {
  value: string | null
  onChange: (iso: string) => void
  min?: Date
  className?: string
  placeholder?: string
  disabled?: boolean
}) {
  const tz = useTimeZone()
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      width={320}
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'press flex h-9 min-w-0 items-center gap-2.5 rounded-control bg-well pr-3 pl-2.5 text-left shadow-[inset_0_0_0_1px_var(--line)] hover-device:hover:shadow-[inset_0_0_0_1px_var(--line-strong)] disabled:opacity-50',
            className,
          )}
        >
          <CalendarDays size={15} className="shrink-0 text-ink-3" />
          {value ? (
            <span className="min-w-0 flex-1 truncate t-callout text-ink">
              {formatDate(value, tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              <span className="t-meta ml-2 text-ink-2">{formatTime(value, tz)}</span>
            </span>
          ) : (
            <span className="flex-1 t-callout text-ink-3">{placeholder ?? t('dateTime.pick')}</span>
          )}
          <span className="t-meta shrink-0 text-ink-4">{zoneLabel(tz, value ?? Date.now())}</span>
        </button>
      }
    >
      <DateTimePanel
        value={value}
        min={min}
        onChange={(iso, close) => {
          onChange(iso)
          if (close) setOpen(false)
        }}
      />
    </Popover>
  )
}

export function DateTimePanel({
  value,
  onChange,
  min,
}: {
  value: string | null
  onChange: (iso: string, close: boolean) => void
  min?: Date
}) {
  const tz = useTimeZone()
  const t = useT()
  const weekStart = useWeekStart()
  const now = zonedParts(Date.now(), tz)
  const cur = value ? zonedParts(value, tz) : { ...now, hour: 9, minute: 0 }
  const [view, setView] = useState({ year: cur.year, month: cur.month })
  const [time, setTime] = useState(
    `${String(cur.hour).padStart(2, '0')}:${String(cur.minute).padStart(2, '0')}`,
  )

  const days = useMemo(() => {
    const first = new Date(Date.UTC(view.year, view.month, 1))
    const lead = (first.getUTCDay() - weekStart + 7) % 7
    const count = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate()
    const cells: ({ day: number } | null)[] = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= count; d++) cells.push({ day: d })
    while (cells.length % 7) cells.push(null)
    return cells
  }, [view, weekStart])

  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(currentLanguage(), { weekday: 'narrow', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, i) =>
      f.format(new Date(Date.UTC(2024, 0, 7 + ((i + weekStart) % 7)))),
    )
  }, [weekStart])

  const [hh, mm] = time.split(':').map(Number) as [number, number]
  const pick = (day: number, close = false) => {
    const at = zonedToInstant({ year: view.year, month: view.month, day, hour: hh || 0, minute: mm || 0 }, tz)
    onChange(at.toISOString(), close)
  }
  const setClock = (t: string) => {
    setTime(t)
    const [h, m] = t.split(':').map(Number) as [number, number]
    if (Number.isNaN(h) || Number.isNaN(m)) return
    const at = zonedToInstant({ year: cur.year, month: cur.month, day: cur.day, hour: h, minute: m }, tz)
    onChange(at.toISOString(), false)
  }
  const quick = (dayOffset: number, hour: number) => {
    const base = zonedParts(Date.now() + dayOffset * 86_400_000, tz)
    const at = zonedToInstant({ year: base.year, month: base.month, day: base.day, hour, minute: 0 }, tz)
    onChange(at.toISOString(), true)
  }
  const monthLabel = new Intl.DateTimeFormat(currentLanguage(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(view.year, view.month, 1)))
  const minKey = min ? zonedParts(min, tz) : null
  const isPast = (d: number) =>
    !!minKey &&
    (view.year < minKey.year ||
      (view.year === minKey.year &&
        (view.month < minKey.month || (view.month === minKey.month && d < minKey.day))))

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between pl-1.5">
        <span className="t-headline capitalize text-ink">{monthLabel}</span>
        <span className="flex">
          <button
            type="button"
            className="press grid size-7 place-items-center rounded-control text-ink-2 hover:bg-hover"
            onClick={() =>
              setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 }))
            }
            aria-label={t('dateTime.prevMonth')}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="press grid size-7 place-items-center rounded-control text-ink-2 hover:bg-hover"
            onClick={() =>
              setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 }))
            }
            aria-label={t('dateTime.nextMonth')}
          >
            <ChevronRight size={16} />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: weekday header
          <span key={i} className="pb-1 t-micro text-ink-4">
            {w}
          </span>
        ))}
        {days.map((c, i) => {
          if (!c) return <span key={`e${i}`} />
          const selected = value && cur.year === view.year && cur.month === view.month && cur.day === c.day
          const today = now.year === view.year && now.month === view.month && now.day === c.day
          const past = isPast(c.day)
          return (
            <button
              key={c.day}
              type="button"
              disabled={past}
              onClick={() => pick(c.day)}
              onDoubleClick={() => pick(c.day, true)}
              className={cn(
                'press relative grid h-8 place-items-center rounded-[8px] t-callout tabular disabled:opacity-25',
                selected ? 'bg-signal font-[600] text-signal-ink' : 'text-ink hover:bg-hover',
                today && !selected && 'font-[600] text-signal',
              )}
            >
              {c.day}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <input
          type="time"
          value={time}
          step={300}
          onChange={(e) => setClock(e.target.value)}
          className="h-8 rounded-control bg-well px-2.5 t-meta text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--signal)] [color-scheme:inherit]"
        />
        <span className="t-caption text-ink-3">{tz.replace(/_/g, ' ')}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="xs" variant="secondary" onClick={() => quick(1, 9)}>
          {t('dateTime.tomorrowAt', { time: '9:00' })}
        </Button>
        <Button size="xs" variant="secondary" onClick={() => quick(1, 18)}>
          {t('dateTime.tomorrowAt', { time: '18:00' })}
        </Button>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => {
            const wd = zonedParts(Date.now(), tz).weekday
            quick((8 - wd) % 7 || 7, 9)
          }}
        >
          {t('dateTime.nextMonday')}
        </Button>
      </div>
    </div>
  )
}
