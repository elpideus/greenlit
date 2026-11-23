import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'

/**
 * The basemap: OpenFreeMap's Positron vector style (OpenStreetMap data, no key), repainted in Greenlit's palette so the
 * map reads as part of the product — graphite land, quieter water, roads as hairlines, labels in the ink scale.
 * Places and media are the only colour on it.
 */
const SOURCES = [
  'https://tiles.openfreemap.org/styles/positron',
  'https://tiles.openfreemap.org/styles/bright',
  'https://tiles.openfreemap.org/styles/liberty',
]

let base: Promise<StyleSpecification | null> | null = null

export function loadBaseStyle(): Promise<StyleSpecification | null> {
  if (!base) {
    base = (async () => {
      for (const url of SOURCES) {
        try {
          const res = await fetch(url)
          if (res.ok) return (await res.json()) as StyleSpecification
        } catch {}
      }
      return null
    })()
    void base.then((s) => {
      if (!s) base = null // try again next time
    })
  }
  return base
}

interface Palette {
  land: string
  landAlt: string
  park: string
  water: string
  waterLine: string
  building: string
  roadMinor: string
  roadMajor: string
  roadMotorway: string
  casing: string
  rail: string
  boundary: string
  label: string
  labelStrong: string
  labelWater: string
  halo: string
  sky: string
  horizon: string
}

// ── colours from the active theme ─────────────────────────────────────────────────────

type RGB = [number, number, number]
function parse(c: string): RGB {
  const s = c.trim()
  if (s.startsWith('#')) {
    const h =
      s.length === 4
        ? s
            .slice(1)
            .split('')
            .map((x) => x + x)
            .join('')
        : s.slice(1, 7)
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as RGB
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m)
    return m[1]!
      .split(',')
      .slice(0, 3)
      .map((x) => Number.parseFloat(x)) as RGB
  return [128, 128, 128]
}
const hex = (c: RGB) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
const mix = (a: string, b: string, t: number) => {
  const A = parse(a)
  const B = parse(b)
  return hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t])
}

/** The theme's roles as set on the document (lib/theme.ts applies them). */
function themeColors() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--gl-bg', '#0c0d0c'),
    text: v('--gl-text', '#edefed'),
    muted: v('--gl-text-muted', '#a8aca9'),
    subtle: v('--gl-text-subtle', '#828683'),
    accent: v('--gl-accent', '#42d77b'),
    success: v('--gl-success', '#42d77b'),
    info: v('--gl-info', '#6aa7f4'),
    surface: v('--gl-surface', '#131413'),
  }
}

export function paletteFor(mode: 'dark' | 'light'): Palette {
  const t = themeColors()
  if (mode === 'dark') {
    const land = mix(t.bg, t.text, 0.035)
    return {
      land,
      landAlt: mix(t.bg, t.text, 0.05),
      park: mix(land, t.success, 0.045),
      water: mix(t.bg, '#000000', 0.45),
      waterLine: mix(t.bg, t.info, 0.06),
      building: mix(t.bg, t.text, 0.075),
      roadMinor: mix(t.bg, t.text, 0.085),
      roadMajor: mix(t.bg, t.text, 0.12),
      roadMotorway: mix(t.bg, t.text, 0.16),
      casing: mix(t.bg, '#000000', 0.2),
      rail: mix(t.bg, t.text, 0.1),
      boundary: mix(t.bg, t.text, 0.24),
      label: mix(t.subtle, t.bg, 0.18),
      labelStrong: t.muted,
      labelWater: mix(t.bg, t.info, 0.32),
      halo: t.bg,
      sky: mix(t.bg, '#000000', 0.55),
      horizon: mix(t.bg, t.accent, 0.1),
    }
  }
  const land = mix(t.bg, t.text, 0.025)
  return {
    land,
    landAlt: mix(t.bg, t.text, 0.04),
    park: mix(land, t.success, 0.07),
    water: mix(t.bg, t.info, 0.15),
    waterLine: mix(t.bg, t.info, 0.22),
    building: mix(t.bg, t.text, 0.075),
    roadMinor: '#ffffff',
    roadMajor: '#ffffff',
    roadMotorway: mix('#ffffff', t.text, 0.02),
    casing: mix(t.bg, t.text, 0.11),
    rail: mix(t.bg, t.text, 0.13),
    boundary: mix(t.bg, t.text, 0.28),
    label: t.subtle,
    labelStrong: t.muted,
    labelWater: mix(t.bg, t.info, 0.5),
    halo: t.bg,
    sky: mix(t.bg, t.info, 0.08),
    horizon: '#ffffff',
  }
}

const HIDE =
  /shield|road_shield|aeroway|ice_shelf|glacier|railway_(transit|service)_dashline|^highway-name-path$/

function paintFor(l: LayerSpecification, p: Palette, lang: string): LayerSpecification | null {
  const id = l.id
  if (HIDE.test(id)) return null
  const L = { ...l, paint: { ...((l as { paint?: object }).paint ?? {}) } } as LayerSpecification & {
    paint: Record<string, unknown>
    layout?: Record<string, unknown>
  }
  switch (l.type) {
    case 'background':
      L.paint = { 'background-color': p.land }
      return L
    case 'fill': {
      let color = p.landAlt
      if (id.startsWith('water')) color = p.water
      else if (id.startsWith('park') || id.includes('wood')) color = p.park
      else if (id.startsWith('building')) color = p.building
      else if (id.includes('residential')) color = p.landAlt
      else if (id.startsWith('road_area')) color = p.roadMinor
      L.paint = {
        'fill-color': color,
        'fill-antialias': true,
        ...(id.startsWith('building') ? { 'fill-opacity': 0.9 } : {}),
      }
      return L
    }
    case 'line': {
      const width = (L.paint['line-width'] as unknown) ?? 1
      let color = p.roadMinor
      if (id.startsWith('waterway')) color = p.waterLine
      else if (id.includes('casing')) color = p.casing
      else if (id.includes('motorway')) color = p.roadMotorway
      else if (id.includes('major')) color = p.roadMajor
      else if (id.startsWith('railway')) color = p.rail
      else if (id.startsWith('boundary')) {
        L.paint = {
          'line-color': p.boundary,
          'line-width': width,
          'line-dasharray': [2, 2],
          'line-opacity': 0.8,
        }
        return L
      }
      L.paint = {
        'line-color': color,
        'line-width': width,
        ...(id.includes('subtle') ? { 'line-opacity': 0.6 } : {}),
      }
      return L
    }
    case 'symbol': {
      const strong = /label_city|capital/.test(id)
      const water = id.startsWith('water') || id.startsWith('waterway')
      L.paint = {
        'text-color': water ? p.labelWater : strong ? p.labelStrong : p.label,
        'text-halo-color': p.halo,
        'text-halo-width': 1.3,
        'text-halo-blur': 0.4,
      }
      if (L.layout) {
        L.layout = { ...L.layout }
        // One name per label, in the reader's language when the map has it (no "Russia Россия" pairs).
        if (L.layout['text-field'] && !id.startsWith('highway'))
          L.layout['text-field'] = [
            'coalesce',
            ['get', `name:${lang}`],
            ['get', 'name:latin'],
            ['get', 'name'],
          ]
        if (/label_country/.test(id)) L.layout['text-font'] = ['Noto Sans Regular']
        // Calmer type: regular weight, a touch of tracking on place names.
        if (strong) L.layout['text-letter-spacing'] = 0.02
        delete L.layout['icon-image']
      }
      return L
    }
    case 'raster':
      return null
    default:
      return L
  }
}

/** The base style repainted for a mode, with the globe's sky. */
export function greenlitStyle(
  baseStyle: StyleSpecification,
  mode: 'dark' | 'light',
  lang = 'en',
): StyleSpecification {
  const p = paletteFor(mode)
  const layers = baseStyle.layers.map((l) => paintFor(l, p, lang)).filter((l): l is LayerSpecification => !!l)
  const sources = Object.fromEntries(Object.entries(baseStyle.sources).filter(([, s]) => s.type !== 'raster'))
  return {
    ...baseStyle,
    sources,
    layers,
    sky: {
      'sky-color': p.sky,
      'horizon-color': p.horizon,
      'fog-color': p.land,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.5,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
  }
}

/** A plain style for when no basemap can be loaded: land and nothing else, so the points still show. */
export function fallbackStyle(mode: 'dark' | 'light'): StyleSpecification {
  const p = paletteFor(mode)
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': p.land } }],
  }
}
