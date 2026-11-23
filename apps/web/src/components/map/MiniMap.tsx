import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import { maplibre } from '@/components/map/maplibre'
import { currentLanguage } from '@/lib/i18n'
import { useConfig } from '@/lib/session'
import { useMode } from '@/lib/theme'
import { fallbackStyle, greenlitStyle, loadBaseStyle } from './basemap'

/**
 * A small, still map of a few places (an item's places in its Info). Not interactive; lamps mark the places.
 * Load it lazily: `const MiniMap = lazy(() => import('@/components/map/MiniMap'))`.
 */
export default function MiniMap({
  places,
  className,
  highlight,
}: {
  places: { id: string; lat: number; lng: number }[]
  className?: string
  highlight?: string | null
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<maplibre.Map | null>(null)
  const markers = useRef<maplibre.Marker[]>([])
  const { data: config } = useConfig()
  const { mode } = useMode(config?.theme.defaultMode)
  const key = places.map((p) => `${p.id}:${p.lat}:${p.lng}`).join('|')

  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is rebuilt only when the mode changes; places are framed by the next effect
  useEffect(() => {
    let cancelled = false
    void loadBaseStyle().then((base) => {
      if (cancelled || !box.current) return
      const m = new maplibre.Map({
        container: box.current,
        style: base ? greenlitStyle(base, mode, currentLanguage()) : fallbackStyle(mode),
        interactive: false,
        attributionControl: false,
        center: [17.52, 40.74],
        zoom: 9,
        fadeDuration: 0,
      })
      map.current = m
      m.on('load', () => frame(m))
    })
    return () => {
      cancelled = true
      for (const mk of markers.current) mk.remove()
      markers.current = []
      map.current?.remove()
      map.current = null
    }
  }, [mode])

  // biome-ignore lint/correctness/useExhaustiveDependencies: frame() reads the latest places through the key
  useEffect(() => {
    if (map.current?.loaded()) frame(map.current)
  }, [key, highlight])

  function frame(m: maplibre.Map) {
    for (const mk of markers.current) mk.remove()
    markers.current = places.map((p) => {
      const el = document.createElement('div')
      const on = !highlight || highlight === p.id
      el.style.cssText = `width:12px;height:12px;border-radius:99px;background:var(--signal);opacity:${on ? 1 : 0.45};box-shadow:0 0 0 2.5px color-mix(in oklab, var(--canvas) 75%, transparent),0 0 12px var(--signal);transition:opacity .2s`
      return new maplibre.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m)
    })
    if (!places.length) return
    if (places.length === 1) {
      m.jumpTo({ center: [places[0]!.lng, places[0]!.lat], zoom: 11 })
      return
    }
    const b = new maplibre.LngLatBounds()
    for (const p of places) b.extend([p.lng, p.lat])
    m.fitBounds(b, { padding: 28, maxZoom: 13, duration: 0 })
  }

  // MapLibre makes its container position: relative, so the caller's positioning goes on a wrapper.
  return (
    <div className={className} aria-hidden>
      <div ref={box} className="size-full" />
    </div>
  )
}
