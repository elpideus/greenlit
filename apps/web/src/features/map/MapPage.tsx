import { zoomForKind } from '@greenlit/shared/areas/geo'
import { Compass, LocateFixed, Maximize2, Minus, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { cn } from '@/lib/cn'
import { useIsPhone, useStoredState } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { useConfig } from '@/lib/session'
import { useMode } from '@/lib/theme'
import { EmptyState, IconButton, Segmented, toast } from '@/ui'
import { groupByPlace, useMapPoints } from './api'
import { MapSearch, type SearchPick } from './MapSearch'
import { type MapHandle, MapView, type Projection } from './MapView'
import { PlaceCard } from './PlaceCard'

const CARD_W = 360

/**
 * The map: every project and media item with a place, as photo pins on a flat map or a globe. Search flies to a place,
 * a pin opens what is there. `?focus=place:<id>` opens a place, `?view=globe` the globe.
 */
export default function MapPage() {
  const t = useT('map')
  const phone = useIsPhone()
  const [params, setParams] = useSearchParams()
  const { data: config } = useConfig()
  const { mode } = useMode(config?.theme.defaultMode)
  const [stored, setStored] = useStoredState<Projection>('map.projection', 'map')
  const projection: Projection =
    params.get('view') === 'globe' ? 'globe' : params.get('view') === 'map' ? 'map' : stored
  const { data: points, isLoading } = useMapPoints()
  const groups = useMemo(() => groupByPlace(points ?? []), [points])
  const focus = params.get('focus')?.replace(/^place:/, '') ?? null
  const [selected, setSelected] = useState<string | null>(focus)
  const [bearing, setBearing] = useState(0)
  const [ready, setReady] = useState(false)
  const [interacted, setInteracted] = useState(false)
  const map = useRef<MapHandle>(null)
  const didInitialView = useRef(false)
  const themeKey =
    typeof document !== 'undefined' ? (document.documentElement.dataset.theme ?? 'greenlit') : 'greenlit'

  const group = groups.find((g) => g.place.id === selected) ?? null
  const inset = {
    top: phone ? 64 : 0,
    right: !phone && group ? CARD_W + 16 : 0,
    bottom: phone && group ? 280 : 0,
    left: 0,
  }

  const select = (id: string | null, fly = false) => {
    setSelected(id)
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (id) next.set('focus', `place:${id}`)
        else next.delete('focus')
        return next
      },
      { replace: true },
    )
    const g = groups.find((x) => x.place.id === id)
    if (fly && g)
      map.current?.flyTo(
        g.place,
        Math.max(map.current.zoom(), zoomForKind[(g.placeKind as keyof typeof zoomForKind) ?? 'other'] ?? 14),
      )
  }

  // A pin opened by a tap stays in sight: pan it out from under the card or the sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a different place opens, not on every render of the group object
  useEffect(() => {
    if (!group) return
    const id = requestAnimationFrame(() => map.current?.reveal(group.place))
    return () => cancelAnimationFrame(id)
  }, [group?.place.id, phone])

  // First view: the focused place, else everything.
  useEffect(() => {
    if (!ready || !points || didInitialView.current) return
    didInitialView.current = true
    const g = focus ? groups.find((x) => x.place.id === focus) : null
    if (g)
      setTimeout(
        () =>
          map.current?.flyTo(
            g.place,
            zoomForKind[(g.placeKind as keyof typeof zoomForKind) ?? 'other'] ?? 14,
          ),
        200,
      )
    else if (projection === 'map') map.current?.fitAll(false)
  }, [ready, points, groups, focus, projection])

  const setProjection = (p: Projection) => {
    setStored(p)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('view')
        return next
      },
      { replace: true },
    )
  }

  const onPick = (p: SearchPick) => {
    if (p.kind === 'place' || p.kind === 'media') {
      map.current?.drop(null)
      select(p.group.place.id, true)
    } else if (p.kind === 'project') {
      map.current?.drop(null)
      const [first] = p.groups
      if (!first) return
      if (p.groups.length > 1) {
        const lats = p.groups.map((g) => g.place.lat)
        const lngs = p.groups.map((g) => g.place.lng)
        map.current?.flyToBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)])
        setSelected(first.place.id)
      } else select(first.place.id, true)
    } else {
      const r = p.result
      select(null)
      map.current?.drop({ lat: r.lat, lng: r.lng })
      if (r.bbox) map.current?.flyToBounds([r.bbox[0], r.bbox[1], r.bbox[2], r.bbox[3]])
      else map.current?.flyTo(r, zoomForKind[(r.kind as keyof typeof zoomForKind) ?? 'other'] ?? 14)
    }
  }

  const locate = () => {
    if (!navigator.geolocation) return toast.info(t('locateFailed'))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        map.current?.drop(at, 'cue')
        map.current?.flyTo(at, 14)
      },
      () => toast.info(t('locateFailed')),
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }

  const counts = useMemo(() => {
    const projects = new Set<string>()
    const media = new Set<string>()
    for (const g of groups) {
      for (const p of g.projects) projects.add(p.id)
      for (const m of g.media) media.add(m.id)
    }
    return { places: groups.length, projects: projects.size, media: media.size }
  }, [groups])

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden',
        phone
          ? 'h-[calc(100dvh-var(--bar-h)-var(--tabbar-h)-env(safe-area-inset-bottom))]'
          : 'h-[calc(100dvh-var(--bar-h))]',
      )}
    >
      <MapView
        ref={map}
        groups={groups}
        projection={projection}
        mode={mode}
        themeKey={themeKey}
        selectedId={selected}
        inset={inset}
        spin={projection === 'globe' && !selected && !interacted}
        clusterLabel={(n) => t('cluster', { count: n })}
        onSelect={(id) => select(id, false)}
        onBearing={setBearing}
        onReady={() => setReady(true)}
        onInteract={() => setInteracted(true)}
      />

      {/* veil while the basemap loads */}
      <AnimatePresence>
        {!ready && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.6, ease } }}
            className="pointer-events-none absolute inset-0 z-10 bg-canvas"
          />
        )}
      </AnimatePresence>

      {/* search + projection */}
      <div className={cn('absolute z-20 flex items-start gap-2', phone ? 'inset-x-2 top-2' : 'top-4 left-4')}>
        <MapSearch groups={groups} onPick={onPick} className={phone ? 'min-w-0 flex-1' : 'w-[340px]'} />
        {phone && (
          <div className="floating flex h-11 items-center rounded-[12px] px-1">
            <Segmented
              size="sm"
              value={projection}
              onChange={setProjection}
              options={[
                { value: 'map', label: t('map') },
                { value: 'globe', label: t('globe') },
              ]}
            />
          </div>
        )}
      </div>

      {!phone && (
        <div
          className="absolute top-4 z-20 transition-[right] duration-300 ease-out"
          style={{ right: group ? CARD_W + 32 : 16 }}
        >
          <div className="floating rounded-[11px] p-1">
            <Segmented
              value={projection}
              onChange={setProjection}
              options={[
                { value: 'map', label: t('map') },
                { value: 'globe', label: t('globe') },
              ]}
            />
          </div>
        </div>
      )}

      {/* controls (on phones they make way for an open sheet) */}
      {!(phone && group) && (
        <div
          className={cn('absolute z-20 flex flex-col gap-2 transition-[right,bottom] duration-300 ease-out')}
          style={{ right: !phone && group ? CARD_W + 32 : phone ? 10 : 16, bottom: 46 }}
        >
          {!phone && (
            <div className="floating flex flex-col rounded-[11px] p-1">
              <IconButton
                icon={Plus}
                label={t('zoomIn')}
                tooltip="left"
                onClick={() => map.current?.zoomBy(1)}
              />
              <div className="mx-1.5 h-px bg-line" />
              <IconButton
                icon={Minus}
                label={t('zoomOut')}
                tooltip="left"
                onClick={() => map.current?.zoomBy(-1)}
              />
            </div>
          )}
          <div className="floating flex flex-col rounded-[11px] p-1">
            <AnimatePresence initial={false}>
              {Math.abs(bearing) > 0.5 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease }}
                >
                  <span className="block" style={{ transform: `rotate(${-bearing}deg)` }}>
                    <IconButton
                      icon={Compass}
                      label={t('resetNorth')}
                      tooltip="left"
                      onClick={() => map.current?.resetNorth()}
                    />
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <IconButton icon={LocateFixed} label={t('locate')} tooltip="left" onClick={locate} />
            <IconButton
              icon={Maximize2}
              label={t('fitAll')}
              tooltip="left"
              onClick={() => map.current?.fitAll(true)}
            />
          </div>
        </div>
      )}

      {/* what's on the map */}
      {!phone && ready && groups.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease, delay: 0.3 }}
          className="floating absolute bottom-4 left-4 z-20 rounded-[9px] px-3 py-1.5 t-caption tabular text-ink-2"
        >
          {t('summary', counts)}
        </motion.div>
      )}

      <AnimatePresence>
        {group && (
          <PlaceCard
            key={group.place.id}
            group={group}
            sheet={phone}
            onClose={() => select(null)}
            onZoom={() => map.current?.flyTo(group.place, 16)}
          />
        )}
      </AnimatePresence>

      {ready && !isLoading && groups.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-4">
          <div className="floating pointer-events-auto max-w-sm px-6">
            <EmptyState compact title={t('empty.title')} body={t('empty.body')} />
          </div>
        </div>
      )}
    </div>
  )
}
