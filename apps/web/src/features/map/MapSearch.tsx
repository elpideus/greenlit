import type { GeocodeResult } from '@greenlit/shared'
import { distanceMeters } from '@greenlit/shared/areas/geo'
import { Folder, MapPin, Search, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { kindIcon } from '@/components/MediaThumb'
import { cn } from '@/lib/cn'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { Kbd, Spinner } from '@/ui'
import { type MapPointView, type PlaceGroup, useGeocode } from './api'

export type SearchPick =
  | { kind: 'place'; group: PlaceGroup }
  | { kind: 'project'; groups: PlaceGroup[] }
  | { kind: 'media'; group: PlaceGroup }
  | { kind: 'osm'; result: GeocodeResult }

type Row = {
  key: string
  pick: SearchPick
  title: string
  subtitle: string
  icon: 'place' | 'project' | 'media' | 'osm'
  thumb: string | null
  mediaKind?: string | null
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/**
 * The map's search: places, projects and media already in Greenlit first, then OpenStreetMap. Arrow keys move,
 * Enter flies there.
 */
export function MapSearch({
  groups,
  onPick,
  className,
}: {
  groups: PlaceGroup[]
  onPick: (p: SearchPick) => void
  className?: string
}) {
  const t = useT('map')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const deferred = useDeferredValue(q.trim())
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(deferred), 320)
    return () => clearTimeout(id)
  }, [deferred])
  const osm = useGeocode(debounced)
  useHotkey('mod+f', () => input.current?.focus())

  const local = useMemo<Row[]>(() => {
    const n = norm(deferred)
    if (!n) return []
    const rows: Row[] = []
    const projects = new Map<string, { p: MapPointView; groups: PlaceGroup[] }>()
    for (const g of groups) {
      if (norm(g.place.name).includes(n))
        rows.push({
          key: `pl:${g.place.id}`,
          pick: { kind: 'place', group: g },
          title: g.place.name,
          subtitle: t('card.items', { count: g.items.length }),
          icon: 'place',
          thumb: g.thumb,
        })
      for (const p of g.projects) {
        if (!norm(p.title).includes(n)) continue
        const e = projects.get(p.id) ?? { p, groups: [] }
        e.groups.push(g)
        projects.set(p.id, e)
      }
      for (const m of g.media) {
        if (norm(m.title).includes(n))
          rows.push({
            key: `m:${m.id}:${g.place.id}`,
            pick: { kind: 'media', group: g },
            title: m.title,
            subtitle: g.place.name,
            icon: 'media',
            thumb: m.thumbnailUrl,
            mediaKind: m.kind,
          })
      }
    }
    const projectRows: Row[] = [...projects.values()].map(({ p, groups: gs }) => ({
      key: `pr:${p.id}`,
      pick: { kind: 'project', groups: gs },
      title: p.title,
      subtitle: gs.map((g) => g.place.name).join(' · '),
      icon: 'project',
      thumb: p.thumbnailUrl,
    }))
    return [...projectRows, ...rows].slice(0, 8)
  }, [deferred, groups, t])

  const known = new Set(groups.map((g) => `${g.place.lat.toFixed(3)},${g.place.lng.toFixed(3)}`))
  // Nearer first: where the studio's work is beats a namesake on another continent.
  const centre = useMemo(() => {
    if (!groups.length) return null
    const lat = groups.reduce((s, g) => s + g.place.lat, 0) / groups.length
    const lng = groups.reduce((s, g) => s + g.place.lng, 0) / groups.length
    return { lat, lng }
  }, [groups])
  const remote: Row[] =
    deferred.length >= 3
      ? [...(osm.data ?? [])]
          .sort((a, b) => (centre ? distanceMeters(centre, a) - distanceMeters(centre, b) : 0))
          .filter((r) => !known.has(`${r.lat.toFixed(3)},${r.lng.toFixed(3)}`))
          .slice(0, 5)
          .map((r) => ({
            key: `osm:${r.sourceId}`,
            pick: { kind: 'osm', result: r },
            title: r.name,
            subtitle: r.address,
            icon: 'osm',
            thumb: null,
          }))
      : []
  const rows = [...local, ...remote]
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets the highlighted row whenever the query changes
  useEffect(() => setActive(0), [deferred])

  const pick = (r: Row) => {
    onPick(r.pick)
    setOpen(false)
    input.current?.blur()
  }
  const showPanel = open && deferred.length > 0
  const loading = deferred.length >= 3 && (osm.isFetching || debounced !== deferred)

  return (
    <div className={cn('relative', className)}>
      <div className="floating flex h-11 items-center gap-2.5 rounded-[12px] pr-2 pl-3.5">
        <Search size={16} strokeWidth={1.9} className="shrink-0 text-ink-3" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(rows.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && rows[active]) {
              e.preventDefault()
              pick(rows[active]!)
            } else if (e.key === 'Escape') {
              if (q) setQ('')
              else input.current?.blur()
            }
          }}
          placeholder={t('searchPlaceholder')}
          className="h-full min-w-0 flex-1 bg-transparent t-callout text-[14px] text-ink outline-none placeholder:text-ink-3"
          aria-label={t('searchPlaceholder')}
          role="combobox"
          aria-expanded={showPanel}
        />
        {loading && <Spinner size={14} className="text-ink-3" />}
        {q ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQ('')
              input.current?.focus()
            }}
            className="press grid size-6 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
            aria-label="Clear"
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        ) : (
          <Kbd combo="mod+f" className="hidden sm:inline-flex" />
        )}
      </div>
      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease }}
            className="floating absolute top-[calc(100%+6px)] right-0 left-0 z-30 origin-top overflow-hidden p-1.5"
            role="listbox"
          >
            {local.length > 0 && (
              <div className="px-2.5 pt-1.5 pb-1 t-micro text-ink-3">{t('inGreenlit')}</div>
            )}
            {local.map((r) => (
              <ResultRow
                key={r.key}
                row={r}
                active={rows.indexOf(r) === active}
                onPick={() => pick(r)}
                onHover={() => setActive(rows.indexOf(r))}
              />
            ))}
            {remote.length > 0 && (
              <div className="px-2.5 pt-2.5 pb-1 t-micro text-ink-3">{t('onTheMap')}</div>
            )}
            {remote.map((r) => (
              <ResultRow
                key={r.key}
                row={r}
                active={rows.indexOf(r) === active}
                onPick={() => pick(r)}
                onHover={() => setActive(rows.indexOf(r))}
              />
            ))}
            {!rows.length && (
              <div className="px-3 py-5 text-center t-callout text-ink-3">
                {loading ? t('searching') : t('noMatches', { q: deferred })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ResultRow({
  row,
  active,
  onPick,
  onHover,
}: {
  row: Row
  active: boolean
  onPick: () => void
  onHover: () => void
}) {
  const KindIcon =
    row.icon === 'media' ? kindIcon(row.mediaKind ?? 'other') : row.icon === 'project' ? Folder : MapPin
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        'flex w-full items-center gap-3 rounded-[9px] px-2 py-1.5 text-left',
        active && 'bg-hover',
      )}
    >
      <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-hover text-ink-3 shadow-[inset_0_0_0_.5px_var(--line)]">
        {row.thumb ? (
          <img src={row.thumb} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <KindIcon size={15} strokeWidth={1.8} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate t-callout text-ink">{row.title}</span>
        <span className="block truncate t-caption text-ink-3">{row.subtitle}</span>
      </span>
      {row.thumb && <KindIcon size={13} strokeWidth={1.8} className="shrink-0 text-ink-4" />}
    </button>
  )
}
