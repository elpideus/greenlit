import { TZDate } from '@date-fns/tz'
import { currentLanguage } from './i18n'
import { useConfig } from './session'

/**
 * Every date in Greenlit is shown in the platform time zone (Settings → General), never the browser's:
 * it is the time zone schedules are sent to the social platforms in.
 */
export function useTimeZone(): string {
  const { data } = useConfig()
  return data?.platform.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function useWeekStart(): 0 | 1 {
  const { data } = useConfig()
  return (data?.platform.weekStartsOn ?? 1) as 0 | 1
}

type DateInput = string | number | Date

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const lang = currentLanguage()
  const key = `${lang}|${tz}|${JSON.stringify(opts)}`
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { timeZone: tz, ...opts })
    fmtCache.set(key, f)
  }
  return f
}

export function formatDate(
  d: DateInput,
  tz: string,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
) {
  return fmt(tz, opts).format(new Date(d))
}

export function formatDateTime(d: DateInput, tz: string) {
  return fmt(tz, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(d))
}

export function formatTime(d: DateInput, tz: string) {
  return fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(new Date(d))
}

/** "just now", "5 min ago", "yesterday", then a date. */
export function formatRelative(d: DateInput, tz: string, now = Date.now()) {
  const t = new Date(d).getTime()
  const diff = (t - now) / 1000
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(currentLanguage(), { numeric: 'auto', style: 'short' })
  if (abs < 45) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 7 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day')
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear()
  return formatDate(t, tz, sameYear ? { day: 'numeric', month: 'short' } : { dateStyle: 'medium' })
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(d: DateInput, tz: string) {
  const z = new TZDate(new Date(d).getTime(), tz)
  return {
    year: z.getFullYear(),
    month: z.getMonth(),
    day: z.getDate(),
    hour: z.getHours(),
    minute: z.getMinutes(),
    weekday: z.getDay(),
  }
}

/** The instant of a wall-clock time in a time zone (for schedule pickers). */
export function zonedToInstant(
  p: { year: number; month: number; day: number; hour?: number; minute?: number },
  tz: string,
): Date {
  return new Date(new TZDate(p.year, p.month, p.day, p.hour ?? 0, p.minute ?? 0, 0, tz).getTime())
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function zonedDayKey(d: DateInput, tz: string) {
  const p = zonedParts(d, tz)
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** The time zone's offset right now, e.g. "GMT+1". */
export function zoneLabel(tz: string, at: DateInput = Date.now()) {
  const part = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(new Date(at))
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? tz
}
