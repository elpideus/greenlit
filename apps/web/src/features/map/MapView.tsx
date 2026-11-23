import 'maplibre-gl/dist/maplibre-gl.css'
import './map.css'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { fallbackStyle, greenlitStyle, loadBaseStyle } from '@/components/map/basemap'
import { maplibre } from '@/components/map/maplibre'
import { currentLanguage } from '@/lib/i18n'
import type { PlaceGroup } from './api'

export type Projection = 'map' | 'globe'
export interface Inset {
  top: number
  right: number
  bottom: number
  left: number
}

export interface MapHandle {
  flyTo: (target: { lat: number; lng: number }, zoom?: number) => void
  flyToBounds: (bbox: [number, number, number, number]) => void
  fitAll: (animate?: boolean) => void
  zoomBy: (delta: number) => void
  resetNorth: () => void
  /** A lamp at a point found by search (null removes it). */
  drop: (at: { lat: number; lng: number } | null, tone?: 'signal' | 'cue') => void
  zoom: () => number
  /** Pans just enough to bring a point out from under the card / sheet (no zoom change). */
  reveal: (target: { lat: number; lng: number }) => void
}

const SOURCE = 'gl-places'

type PointGeometry = { type: 'Point'; coordinates: [number, number] }
type PlacesCollection = {
  type: 'FeatureCollection'
  features: { type: 'Feature'; geometry: PointGeometry; properties: Record<string, unknown> }[]
}
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function toGeoJSON(groups: PlaceGroup[]): PlacesCollection {
  return {
    type: 'FeatureCollection',
    features: groups.map((g) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.place.lng, g.place.lat] },
      properties: {
        placeId: g.place.id,
        name: g.place.name,
        count: g.items.length,
        projects: g.projects.length,
        thumb: g.thumb ?? '',
        kind: g.projects.length ? 'project' : 'media',
      },
    })),
  }
}

function boundsOf(groups: PlaceGroup[]): maplibre.LngLatBounds | null {
  if (!groups.length) return null
  const b = new maplibre.LngLatBounds()
  for (const g of groups) b.extend([g.place.lng, g.place.lat])
  return b
}

function pinElement(kind: string, label: string, count: number, thumb: string) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'gl-pin'
  el.dataset.kind = kind
  el.setAttribute('aria-label', label)
  const frame = document.createElement('span')
  frame.className = 'gl-pin-frame'
  if (thumb) frame.style.backgroundImage = `url("${thumb}")`
  else frame.dataset.empty = 'true'
  const tip = document.createElement('span')
  tip.className = 'gl-pin-tip'
  el.append(frame, tip)
  if (count > 1) {
    const c = document.createElement('span')
    c.className = 'gl-pin-count'
    c.textContent = count > 999 ? `${Math.round(count / 100) / 10}k` : String(count)
    el.append(c)
  }
  const l = document.createElement('span')
  l.className = 'gl-pin-label'
  l.textContent = label
  el.append(l)
  return el
}

/**
 * The MapLibre map, driven imperatively: one GeoJSON source of places (clustered by MapLibre), drawn as photo pins
 * (DOM markers) synced with the source on every render. Globe and flat map share everything.
 */
export const MapView = forwardRef<
  MapHandle,
  {
    groups: PlaceGroup[]
    projection: Projection
    mode: 'dark' | 'light'
    /** Changes when the theme pack changes (repaints the basemap). */
    themeKey: string
    selectedId: string | null
    inset: Inset
    spin: boolean
    clusterLabel: (n: number) => string
    onSelect: (placeId: string | null) => void
    onBearing?: (deg: number) => void
    onReady?: () => void
    onInteract?: () => void
  }
>(function MapView(props, ref) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibre.Map | null>(null)
  const markers = useRef(new Map<string, maplibre.Marker>())
  const dropRef = useRef<maplibre.Marker | null>(null)
  const latest = useRef(props)
  latest.current = props
  const ready = useRef(false)
  const lastInteraction = useRef(0)

  // ── create ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is created once; later props are read through `latest`
  useEffect(() => {
    let cancelled = false
    let map: maplibre.Map | null = null
    void loadBaseStyle().then((base) => {
      if (cancelled || !box.current) return
      const p = latest.current
      const style = base ? greenlitStyle(base, p.mode, currentLanguage()) : fallbackStyle(p.mode)
      map = new maplibre.Map({
        container: box.current,
        style: {
          ...style,
          projection: { type: p.projection === 'globe' ? 'globe' : 'mercator' },
        },
        center: [17.52, 40.74],
        zoom: p.projection === 'globe' ? 2.2 : 8.5,
        attributionControl: { compact: true },
        fadeDuration: 180,
        maxPitch: 60,
        renderWorldCopies: p.projection !== 'globe',
        dragRotate: true,
        pitchWithRotate: false,
        cooperativeGestures: false,
      })
      mapRef.current = map
      map.on('load', () => {
        if (!map) return
        map.addSource(SOURCE, {
          type: 'geojson',
          data: toGeoJSON(latest.current.groups),
          cluster: true,
          clusterRadius: 58,
          clusterMaxZoom: 15,
          clusterProperties: { total: ['+', ['get', 'count']] },
        })
        // An invisible layer keeps the source's tiles loaded so the pins can be read from it.
        map.addLayer({
          id: 'gl-places-hit',
          type: 'circle',
          source: SOURCE,
          paint: { 'circle-opacity': 0, 'circle-radius': 1 },
        })
        ready.current = true
        // The attribution starts folded into its (i) button.
        map
          .getContainer()
          .querySelector('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show')
        latest.current.onReady?.()
        sync()
      })
      map.on('render', () => schedule())
      map.on('rotate', () => latest.current.onBearing?.(map!.getBearing()))
      map.on('click', (e) => {
        const target = e.originalEvent.target as HTMLElement
        if (!target.closest('.gl-pin')) latest.current.onSelect(null)
      })
      const interact = () => {
        lastInteraction.current = performance.now()
        latest.current.onInteract?.()
      }
      for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const) map.on(ev, interact)
    })
    const ro = new ResizeObserver(() => mapRef.current?.resize())
    if (box.current) ro.observe(box.current)
    return () => {
      cancelled = true
      ro.disconnect()
      for (const m of markers.current.values()) m.remove()
      markers.current.clear()
      map?.remove()
      mapRef.current = null
      ready.current = false
    }
  }, [])

  // ── markers ──
  const pending = useRef(false)
  function schedule() {
    if (pending.current) return
    pending.current = true
    requestAnimationFrame(() => {
      pending.current = false
      sync()
    })
  }

  function sync() {
    const map = mapRef.current
    if (!map || !ready.current || !map.getSource(SOURCE)) return
    const src = map.getSource(SOURCE) as maplibre.GeoJSONSource
    const seen = new Set<string>()
    const { selectedId, clusterLabel } = latest.current
    for (const f of map.querySourceFeatures(SOURCE)) {
      const pr = f.properties as Record<string, unknown>
      const cluster = !!pr.cluster
      const key = cluster ? `c${pr.cluster_id}` : `p${pr.placeId}`
      if (seen.has(key)) continue
      seen.add(key)
      const coords = (f.geometry as unknown as PointGeometry).coordinates as [number, number]
      let m = markers.current.get(key)
      if (!m) {
        const count = cluster ? Number(pr.total ?? pr.point_count) : Number(pr.count)
        const el = pinElement(
          cluster ? 'cluster' : String(pr.kind),
          cluster ? clusterLabel(Number(pr.point_count)) : String(pr.name),
          count,
          cluster ? '' : String(pr.thumb ?? ''),
        )
        if (cluster) {
          const id = Number(pr.cluster_id)
          void src
            .getClusterLeaves(id, 3, 0)
            .then((leaves) => {
              const thumb = leaves.map((l) => l.properties?.thumb).find(Boolean)
              const frame = el.querySelector<HTMLElement>('.gl-pin-frame')
              if (thumb && frame) {
                frame.style.backgroundImage = `url("${thumb}")`
                delete frame.dataset.empty
              }
            })
            .catch(() => {})
          el.addEventListener('click', (e) => {
            e.stopPropagation()
            void src.getClusterExpansionZoom(id).then((z) => {
              map.easeTo({
                center: coords,
                zoom: Math.min(z + 0.4, 17),
                duration: reduceMotion() ? 0 : 650,
                padding: latest.current.inset,
              })
            })
          })
        } else {
          const placeId = String(pr.placeId)
          el.dataset.place = placeId
          el.addEventListener('click', (e) => {
            e.stopPropagation()
            latest.current.onSelect(placeId)
          })
        }
        m = new maplibre.Marker({ element: el, anchor: 'bottom' }).setLngLat(coords).addTo(map)
        markers.current.set(key, m)
      }
      const el = m.getElement()
      if (!cluster) el.dataset.selected = String(el.dataset.place === selectedId)
    }
    for (const [key, m] of markers.current) {
      if (!seen.has(key)) {
        m.remove()
        markers.current.delete(key)
      }
    }
  }

  // ── data ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    const src = map.getSource(SOURCE) as maplibre.GeoJSONSource | undefined
    if (!src) return
    // cluster ids change with the data: rebuild every pin
    for (const m of markers.current.values()) m.remove()
    markers.current.clear()
    void src.setData(toGeoJSON(props.groups))
  }, [props.groups])

  useEffect(() => {
    for (const m of markers.current.values()) {
      const el = m.getElement()
      if (el.dataset.place) el.dataset.selected = String(el.dataset.place === props.selectedId)
    }
  }, [props.selectedId])

  // ── theme ──
  const firstTheme = useRef(true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: repaint when the mode or theme changes; the rest is read through refs
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false
      return
    }
    const map = mapRef.current
    if (!map) return
    void loadBaseStyle().then((base) => {
      if (!mapRef.current) return
      const next = base ? greenlitStyle(base, props.mode, currentLanguage()) : fallbackStyle(props.mode)
      map.setStyle(next, {
        diff: true,
        transformStyle: (prev, nextStyle) => ({
          ...nextStyle,
          projection: prev?.projection ?? nextStyle.projection,
          sources: {
            ...nextStyle.sources,
            ...(prev?.sources[SOURCE] ? { [SOURCE]: prev.sources[SOURCE] } : {}),
          },
          layers: [...nextStyle.layers, ...(prev?.layers.filter((l) => l.id.startsWith('gl-')) ?? [])],
        }),
      })
    })
  }, [props.mode, props.themeKey])

  // ── projection ──
  const firstProjection = useRef(true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a projection change moves the camera
  useEffect(() => {
    const map = mapRef.current
    if (firstProjection.current) {
      firstProjection.current = false
      return
    }
    if (!map) return
    const globe = props.projection === 'globe'
    map.setProjection({ type: globe ? 'globe' : 'mercator' })
    map.setRenderWorldCopies(!globe)
    const dur = reduceMotion() ? 0 : 1600
    if (globe) {
      map.easeTo({
        zoom: Math.min(map.getZoom(), 2.4),
        pitch: 0,
        bearing: 0,
        duration: dur,
        easing: easeOutCubic,
      })
    } else {
      fitAll(true)
    }
  }, [props.projection])

  // ── idle globe rotation ──
  useEffect(() => {
    if (!props.spin || reduceMotion()) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const map = mapRef.current
      const dt = now - last
      last = now
      if (
        map &&
        ready.current &&
        now - lastInteraction.current > 12_000 &&
        map.getZoom() < 4.2 &&
        !map.isMoving()
      ) {
        const c = map.getCenter()
        map.jumpTo({ center: [c.lng - dt * 0.0012, c.lat] })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [props.spin])

  function fitAll(animate = true) {
    const map = mapRef.current
    if (!map) return
    const { groups, inset, projection } = latest.current
    const b = boundsOf(groups)
    const duration = animate && !reduceMotion() ? 1200 : 0
    if (!b) {
      map.easeTo({ center: [12.5, 42], zoom: projection === 'globe' ? 2.2 : 5, duration })
      return
    }
    if (groups.length === 1) {
      map.easeTo({ center: b.getCenter(), zoom: 12, duration, padding: inset })
      return
    }
    // Room around the pins, scaled to the screen (a phone has no 190 px to spare on each side).
    const c = map.getContainer()
    const w = c.clientWidth - inset.left - inset.right
    const h = c.clientHeight - inset.top - inset.bottom
    const side = Math.min(190, Math.max(36, w * 0.14))
    map.fitBounds(b, {
      padding: {
        top: inset.top + Math.min(160, Math.max(70, h * 0.16)),
        right: inset.right + side,
        bottom: inset.bottom + Math.min(120, Math.max(50, h * 0.1)),
        left: inset.left + side,
      },
      maxZoom: 14,
      duration,
    })
  }

  useImperativeHandle(ref, () => ({
    flyTo: (t, zoom) => {
      const map = mapRef.current
      if (!map) return
      lastInteraction.current = performance.now()
      map.flyTo({
        center: [t.lng, t.lat],
        zoom: zoom ?? Math.max(map.getZoom(), 13),
        curve: 1.5,
        speed: 1.15,
        padding: latest.current.inset,
        essential: false,
      })
    },
    flyToBounds: (bbox) => {
      const map = mapRef.current
      if (!map) return
      lastInteraction.current = performance.now()
      const { inset } = latest.current
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        {
          padding: {
            top: inset.top + 60,
            right: inset.right + 60,
            bottom: inset.bottom + 60,
            left: inset.left + 60,
          },
          maxZoom: 16,
          duration: reduceMotion() ? 0 : 1800,
          linear: false,
          curve: 1.5,
        },
      )
    },
    fitAll,
    zoomBy: (d) => {
      const map = mapRef.current
      if (!map) return
      map.easeTo({ zoom: map.getZoom() + d, duration: reduceMotion() ? 0 : 300 })
    },
    resetNorth: () => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: reduceMotion() ? 0 : 500 }),
    drop: (at, tone = 'signal') => {
      dropRef.current?.remove()
      dropRef.current = null
      const map = mapRef.current
      if (!at || !map) return
      const el = document.createElement('div')
      el.className = 'gl-drop'
      if (tone === 'cue') el.style.setProperty('--signal', 'var(--cue)')
      dropRef.current = new maplibre.Marker({ element: el }).setLngLat([at.lng, at.lat]).addTo(map)
    },
    zoom: () => mapRef.current?.getZoom() ?? 0,
    reveal: (target) => {
      const map = mapRef.current
      if (!map) return
      const { inset } = latest.current
      const c = map.getContainer()
      const pt = map.project([target.lng, target.lat])
      const margin = 64
      const inside =
        pt.x > inset.left + margin &&
        pt.x < c.clientWidth - inset.right - margin &&
        pt.y > inset.top + margin + 50 &&
        pt.y < c.clientHeight - inset.bottom - margin / 2
      if (!inside)
        map.easeTo({ center: [target.lng, target.lat], padding: inset, duration: reduceMotion() ? 0 : 520 })
    },
  }))

  return (
    <div className="gl-map absolute inset-0" data-projection={props.projection}>
      <div ref={box} className="size-full" />
    </div>
  )
})

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}
