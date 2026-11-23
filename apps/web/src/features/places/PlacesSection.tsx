import type { GeocodeResult, Media, Place, PlaceRef, Project } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { Copy, Map as MapIcon, MapPin, Plus, Search, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useDeferredValue, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useCan } from '@/lib/session'
import { IconButton, Skeleton, Spinner, Tooltip, toast, useContextMenu } from '@/ui'
import { type AssignTarget, type EntityType, usePlaceLinks, usePlaceSearch, usePlacesOf } from './api'

const MiniMap = lazy(() => import('@/components/map/MiniMap'))

export function MediaPlaces({ media }: { media: Media }) {
  return <PlacesSection type="media" id={media.id} initial={media.places} />
}

export function ProjectPlaces({ project }: { project: Project }) {
  return <PlacesSection type="project" id={project.id} initial={project.places} />
}

/**
 * Where a project or media item is: a small map, the places, and one field that finds places already used in
 * Greenlit first, then OpenStreetMap.
 */
export function PlacesSection({ type, id, initial }: { type: EntityType; id: string; initial?: PlaceRef[] }) {
  const t = useT('places')
  const navigate = useNavigate()
  const canEdit = useCan('places.manage')
  const { data: places = [] } = usePlacesOf(type, id, initial)
  const { assign, remove } = usePlaceLinks(type, id)
  const [hover, setHover] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const onRemove = (p: PlaceRef) =>
    remove.mutate(p.id, {
      onSuccess: () =>
        toast.done(t('removed', { name: p.name }), {
          action: { label: t('undo'), onClick: () => assign.mutate({ placeId: p.id }) },
        }),
      onError: (e) => toast.error(e),
    })
  const onAdd = (target: AssignTarget, name: string) =>
    assign.mutate(target, {
      onSuccess: () => {
        toast.done(t('added', { name }))
        setAdding(false)
      },
      onError: (e) => toast.error(e),
    })

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-label">{t('title')}</h3>
        {canEdit && places.length > 0 && !adding && (
          <IconButton size="xs" icon={Plus} label={t('add')} onClick={() => setAdding(true)} />
        )}
      </div>

      {places.length > 0 && (
        <button
          type="button"
          onClick={() => navigate(`/map?focus=place:${places[0]!.id}`)}
          className="press group relative block h-[120px] w-full overflow-hidden rounded-tile bg-well shadow-[inset_0_0_0_1px_var(--line)]"
          aria-label={t('openOnMap')}
        >
          <Suspense fallback={<Skeleton className="absolute inset-0 rounded-none" />}>
            <MiniMap places={places} highlight={hover} className="absolute inset-0" />
          </Suspense>
          <span className="pointer-events-none absolute inset-0 rounded-tile shadow-[inset_0_0_0_1px_var(--line)]" />
          <span className="floating absolute right-2 bottom-2 flex items-center gap-1 rounded-[7px] px-2 py-1 t-caption text-ink-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <MapIcon size={12} strokeWidth={1.9} />
            {t('openOnMap')}
          </span>
        </button>
      )}

      <div className="flex flex-col">
        <AnimatePresence initial={false}>
          {places.map((p) => (
            <PlaceRow
              key={p.id}
              place={p}
              canEdit={canEdit}
              onHover={setHover}
              onRemove={() => onRemove(p)}
              onOpen={() => navigate(`/map?focus=place:${p.id}`)}
            />
          ))}
        </AnimatePresence>
      </div>

      {canEdit && (places.length === 0 || adding) ? (
        <PlaceSearchField
          autoFocus={adding}
          busy={assign.isPending}
          exclude={new Set(places.map((p) => p.id))}
          onPick={onAdd}
          onCancel={places.length ? () => setAdding(false) : undefined}
        />
      ) : null}
      {places.length === 0 && (
        <p className="t-caption text-ink-3">
          {t('empty')} {type === 'media' && t('emptyGps')}
        </p>
      )}
    </section>
  )
}

function usePlaceDetail(id: string) {
  return useQuery({
    queryKey: [...qk.places, 'item', id],
    queryFn: () => api.get<Place>(`/places/${id}`),
    staleTime: 60_000,
  })
}

function PlaceRow({
  place,
  canEdit,
  onHover,
  onRemove,
  onOpen,
}: {
  place: PlaceRef
  canEdit: boolean
  onHover: (id: string | null) => void
  onRemove: () => void
  onOpen: () => void
}) {
  const t = useT('places')
  const { data } = usePlaceDetail(place.id)
  const coords = `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
  const copy = () => void navigator.clipboard.writeText(coords).then(() => toast.done(t('coordsCopied')))
  const menu = useContextMenu(() => [
    { label: t('openOnMap'), icon: MapIcon, onSelect: onOpen },
    { label: t('copyCoords'), icon: Copy, onSelect: copy },
    canEdit && 'separator',
    canEdit && { label: t('remove'), icon: X, danger: true, onSelect: onRemove },
  ])
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease }}
      className="overflow-hidden"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover only highlights the lamp on the mini map */}
      <div
        {...menu}
        onMouseEnter={() => onHover(place.id)}
        onMouseLeave={() => onHover(null)}
        className="group -mx-1.5 flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 hover:bg-hover"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-signal-soft text-signal">
          <MapPin size={14} strokeWidth={2} />
        </span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate t-callout text-ink">{place.name}</span>
          <span className="block truncate t-caption text-ink-3">
            {data?.address || coords}
            {data?.source === 'exif' && ` · ${t('exif')}`}
          </span>
        </button>
        {canEdit && (
          <Tooltip label={t('remove')}>
            <button
              type="button"
              onClick={onRemove}
              className="press grid size-6 shrink-0 place-items-center rounded-[6px] text-ink-3 opacity-0 hover:bg-press hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={t('remove')}
            >
              <X size={13} strokeWidth={2.1} />
            </button>
          </Tooltip>
        )}
      </div>
    </motion.div>
  )
}

type Option = { key: string; target: AssignTarget; name: string; detail: string; known: boolean }

/** One field: places already used in Greenlit first, then OpenStreetMap. */
export function PlaceSearchField({
  onPick,
  onCancel,
  exclude,
  busy,
  autoFocus,
}: {
  onPick: (target: AssignTarget, name: string) => void
  onCancel?: () => void
  exclude?: Set<string>
  busy?: boolean
  autoFocus?: boolean
}) {
  const t = useT('places')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const deferred = useDeferredValue(q.trim())
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const h = setTimeout(() => setDebounced(deferred), 300)
    return () => clearTimeout(h)
  }, [deferred])
  const search = usePlaceSearch(debounced)
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets the highlighted row whenever the query changes
  useEffect(() => setActive(0), [debounced])

  const known: Option[] = (search.data?.places ?? [])
    .filter((p) => !exclude?.has(p.id))
    .map((p) => ({
      key: p.id,
      target: { placeId: p.id },
      name: p.name,
      detail: p.address || t('used', { count: p.usage }),
      known: true,
    }))
  const osm: Option[] = (search.data?.geocoded ?? []).map((r: GeocodeResult) => ({
    key: r.sourceId,
    target: { place: r },
    name: r.name,
    detail: r.address,
    known: false,
  }))
  const options = [...known, ...osm]
  const loading = deferred.length >= 2 && (search.isFetching || debounced !== deferred)
  const show = open && deferred.length >= 2

  const pick = (o: Option) => {
    onPick(o.target, o.name)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <div className="flex h-8 items-center gap-2 rounded-control bg-well pr-1 pl-2.5 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]">
        {busy || loading ? (
          <Spinner size={13} className="text-ink-3" />
        ) : (
          <Search size={13} strokeWidth={2} className="shrink-0 text-ink-3" />
        )}
        <input
          ref={input}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 140)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(options.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && options[active]) {
              e.preventDefault()
              pick(options[active]!)
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              if (q) setQ('')
              else onCancel?.()
            }
          }}
          placeholder={t('searchPlaceholder')}
          className="h-full min-w-0 flex-1 bg-transparent t-callout text-ink outline-none placeholder:text-ink-3"
        />
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="press grid size-6 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink"
            aria-label="Cancel"
          >
            <X size={13} strokeWidth={2.1} />
          </button>
        )}
      </div>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18, ease }}
            className="floating absolute top-[calc(100%+5px)] right-0 left-0 z-40 max-h-72 overflow-y-auto bg-raised p-1"
          >
            {known.length > 0 && <div className="px-2 pt-1.5 pb-1 t-micro text-ink-3">{t('inGreenlit')}</div>}
            {known.map((o) => (
              <OptionRow
                key={o.key}
                o={o}
                active={options.indexOf(o) === active}
                onPick={() => pick(o)}
                onHover={() => setActive(options.indexOf(o))}
              />
            ))}
            {osm.length > 0 && <div className="px-2 pt-2 pb-1 t-micro text-ink-3">{t('onOsm')}</div>}
            {osm.map((o) => (
              <OptionRow
                key={o.key}
                o={o}
                active={options.indexOf(o) === active}
                onPick={() => pick(o)}
                onHover={() => setActive(options.indexOf(o))}
              />
            ))}
            {!options.length && (
              <div className="px-3 py-4 text-center t-caption text-ink-3">
                {loading ? t('searching') : t('noMatches', { q: deferred })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function OptionRow({
  o,
  active,
  onPick,
  onHover,
}: {
  o: Option
  active: boolean
  onPick: () => void
  onHover: () => void
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left',
        active && 'bg-hover',
      )}
    >
      <MapPin
        size={14}
        strokeWidth={1.9}
        className={cn('shrink-0', o.known ? 'text-signal' : 'text-ink-3')}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate t-callout text-ink">{o.name}</span>
        <span className="block truncate t-caption text-ink-3">{o.detail}</span>
      </span>
    </button>
  )
}
