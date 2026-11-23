import type { Media } from '@greenlit/shared'
import { formatDate, zonedDayKey, zonedParts } from '@/lib/time'

export interface MediaSection {
  key: string
  label: string | null
  items: Media[]
}

/**
 * Date sections for date sorts (Today, Yesterday, Earlier this week, then months), in the platform time zone.
 * Other sorts are one section without a header.
 */
export function groupMedia(
  items: Media[],
  sort: string,
  tz: string,
  labels: { today: string; yesterday: string; week: string; undated: string },
): MediaSection[] {
  if (sort !== 'recent' && sort !== 'oldest' && sort !== 'taken') return [{ key: 'all', label: null, items }]
  const now = Date.now()
  const today = zonedDayKey(now, tz)
  const yesterday = zonedDayKey(now - 86_400_000, tz)
  const nowParts = zonedParts(now, tz)
  const sections: MediaSection[] = []
  for (const m of items) {
    const at = sort === 'taken' ? (m.takenAt ?? m.createdAt) : m.createdAt
    let key: string
    let label: string
    if (!at) {
      key = 'undated'
      label = labels.undated
    } else {
      const day = zonedDayKey(at, tz)
      const age = (now - new Date(at).getTime()) / 86_400_000
      if (day === today) {
        key = 'today'
        label = labels.today
      } else if (day === yesterday) {
        key = 'yesterday'
        label = labels.yesterday
      } else if (age < 7 && age > 0 && sort !== 'oldest') {
        key = 'week'
        label = labels.week
      } else {
        const p = zonedParts(at, tz)
        key = `${p.year}-${p.month}`
        label = formatDate(
          at,
          tz,
          p.year === nowParts.year ? { month: 'long' } : { month: 'long', year: 'numeric' },
        )
        label = label.charAt(0).toUpperCase() + label.slice(1)
      }
    }
    const last = sections.at(-1)
    if (last && last.key === key) last.items.push(m)
    else sections.push({ key, label, items: [m] })
  }
  return sections
}
