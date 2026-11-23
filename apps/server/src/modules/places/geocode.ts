import { setTimeout as sleep } from 'node:timers/promises'
import type { GeocodeResult } from '@greenlit/shared'
import type { PlaceKind } from '@greenlit/shared/areas/geo'
import { HttpError } from '../../core/errors.ts'
import type { Logger } from '../../core/logger.ts'

/**
 * Geocoding proxy: the browser never talks to third parties. Forward search uses Photon (komoot) with
 * Nominatim as a fallback; reverse geocoding uses Nominatim. Requests carry a generic user agent and only
 * the query or coordinates — never anything about the person asking. Nominatim is limited to one request
 * per second for the whole process, as its usage policy asks, and every answer is cached in memory.
 */

const USER_AGENT = 'Greenlit (self-hosted media platform)'
const PHOTON = 'https://photon.komoot.io/api/'
const NOMINATIM = 'https://nominatim.openstreetmap.org'
const TIMEOUT_MS = 7000
const NOMINATIM_GAP_MS = 1100
/** Photon has no hard limit; a short gap keeps a busy search box from hammering a free service. */
const PHOTON_GAP_MS = 150

export type GeoLang = 'en' | 'it' | 'local'

/** A reverse geocoding hit with the town it is in (used to name places found from GPS tags). */
export interface ReverseHit extends GeocodeResult {
  locality: string | null
  road: string | null
}

class TtlCache<T> {
  private map = new Map<string, { at: number; value: T }>()
  private max: number
  private ttl: number
  constructor(max: number, ttlMs: number) {
    this.max = max
    this.ttl = ttlMs
  }
  get(key: string): T | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (Date.now() - hit.at > this.ttl) {
      this.map.delete(key)
      return undefined
    }
    // Least recently used goes first when full.
    this.map.delete(key)
    this.map.set(key, hit)
    return hit.value
  }
  set(key: string, value: T) {
    this.map.delete(key)
    this.map.set(key, { at: Date.now(), value })
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!)
  }
}

export class Geocoder {
  private log: Logger
  private searchCache = new TtlCache<GeocodeResult[]>(800, 24 * 3600_000)
  private reverseCache = new TtlCache<ReverseHit | null>(2000, 7 * 24 * 3600_000)
  private inflight = new Map<string, Promise<unknown>>()
  private queue: Promise<unknown> = Promise.resolve()
  private lastNominatim = 0
  private photonQueue: Promise<unknown> = Promise.resolve()
  private lastPhoton = 0

  constructor(log: Logger) {
    this.log = log
  }

  async search(q: string, opts: { limit?: number; lang?: GeoLang } = {}): Promise<GeocodeResult[]> {
    const query = q.trim().replace(/\s+/g, ' ')
    if (query.length < 2) return []
    const limit = Math.min(Math.max(opts.limit ?? 6, 1), 15)
    const lang = opts.lang ?? 'en'
    const key = `${lang}:${limit}:${query.toLowerCase()}`
    const cached = this.searchCache.get(key)
    if (cached) return cached
    return this.once(`s:${key}`, async () => {
      let photonFailed = false
      try {
        const results = await this.photon(query, limit, lang)
        if (results.length) {
          this.searchCache.set(key, results)
          return results
        }
      } catch (err) {
        photonFailed = true
        this.log.warn({ err: (err as Error).message }, 'photon search failed, trying nominatim')
      }
      try {
        const results = await this.nominatimSearch(query, limit, lang)
        this.searchCache.set(key, results)
        return results
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'nominatim search failed')
        if (photonFailed)
          throw new HttpError(
            'unavailable',
            'Place search is not reachable right now. Try again in a moment.',
          )
        return []
      }
    })
  }

  async reverse(
    lat: number,
    lng: number,
    opts: { lang?: GeoLang; zoom?: number } = {},
  ): Promise<ReverseHit | null> {
    const lang = opts.lang ?? 'local'
    const zoom = opts.zoom ?? 18
    // ~1 m precision is plenty and makes neighbouring requests share the cache.
    const key = `${lang}:${zoom}:${lat.toFixed(5)},${lng.toFixed(5)}`
    const cached = this.reverseCache.get(key)
    if (cached !== undefined) return cached
    return this.once(`r:${key}`, async () => {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng),
        zoom: String(zoom),
        addressdetails: '1',
      })
      if (lang !== 'local') params.set('accept-language', lang)
      let data: NominatimHit & { error?: string }
      try {
        data = (await this.nominatim(`/reverse?${params}`)) as NominatimHit & { error?: string }
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'nominatim reverse failed')
        throw new HttpError(
          'unavailable',
          'Reverse geocoding is not reachable right now. Try again in a moment.',
        )
      }
      const hit = data && !data.error && data.lat ? fromNominatim(data) : null
      this.reverseCache.set(key, hit)
      return hit
    })
  }

  /** Concurrent identical requests share one upstream call. */
  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key) as Promise<T> | undefined
    if (running) return running
    const p = fn().finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  private async photon(q: string, limit: number, lang: GeoLang): Promise<GeocodeResult[]> {
    // Photon's public instance speaks en/de/fr; "default" gives local names (Italian names in Italy).
    const params = new URLSearchParams({ q, limit: String(limit), lang: lang === 'en' ? 'en' : 'default' })
    const run = this.photonQueue.then(async () => {
      const wait = this.lastPhoton + PHOTON_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastPhoton = Date.now()
      const res = await fetch(`${PHOTON}?${params}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`photon answered ${res.status}`)
      return res.json()
    })
    this.photonQueue = run.catch(() => {})
    const body = (await run) as { features?: PhotonFeature[] }
    return dedupe((body.features ?? []).map(fromPhoton).filter((r): r is GeocodeResult => !!r))
  }

  private async nominatimSearch(q: string, limit: number, lang: GeoLang): Promise<GeocodeResult[]> {
    const params = new URLSearchParams({ format: 'jsonv2', q, limit: String(limit), addressdetails: '1' })
    if (lang !== 'local') params.set('accept-language', lang)
    const rows = (await this.nominatim(`/search?${params}`)) as NominatimHit[]
    return dedupe(
      (Array.isArray(rows) ? rows : []).map(fromNominatim).map(({ locality: _l, road: _r, ...hit }) => hit),
    )
  }

  /** One Nominatim request at a time, at least a second apart, for the whole process. */
  private nominatim(path: string): Promise<unknown> {
    const run = this.queue.then(async () => {
      const wait = this.lastNominatim + NOMINATIM_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastNominatim = Date.now()
      const res = await fetch(`${NOMINATIM}${path}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`nominatim answered ${res.status}`)
      return res.json()
    })
    this.queue = run.catch(() => {})
    return run
  }
}

// ── parsing ───────────────────────────────────────────────────────────────

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    osm_type?: string
    osm_id?: number
    osm_key?: string
    osm_value?: string
    type?: string
    name?: string
    housenumber?: string
    street?: string
    postcode?: string
    locality?: string
    district?: string
    city?: string
    county?: string
    state?: string
    country?: string
    countrycode?: string
    extent?: [number, number, number, number]
  }
}

interface NominatimHit {
  place_id?: number
  osm_type?: string
  osm_id?: number
  lat: string
  lon: string
  category?: string
  type?: string
  addresstype?: string
  name?: string
  display_name?: string
  address?: Record<string, string | undefined>
  boundingbox?: [string, string, string, string]
}

const uniq = (parts: (string | null | undefined)[], exclude: string[] = []) => {
  const seen = new Set(exclude.map((e) => e.toLowerCase()))
  const out: string[] = []
  for (const p of parts) {
    const v = p?.trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out
}

/** Drops repeats: the same OSM object, or two objects that would read the same (a station and its platform). */
function dedupe(rows: GeocodeResult[]): GeocodeResult[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const keys = [r.sourceId, `${r.name}|${r.address}`.toLowerCase()]
    if (keys.some((k) => seen.has(k))) return false
    for (const k of keys) seen.add(k)
    return true
  })
}

const coarse = new Set<PlaceKind>(['country', 'region', 'city'])

function fromPhoton(f: PhotonFeature): GeocodeResult | null {
  const p = f.properties
  const c = f.geometry?.coordinates
  if (!p || !c || !p.osm_type || p.osm_id === undefined) return null
  const street = uniq([p.street, p.housenumber]).join(' ')
  const town = p.city ?? p.locality ?? p.district ?? null
  const name = p.name || street || town || p.county || p.state || p.country || 'Unnamed place'
  const kind = photonKind(p)
  const address = uniq(
    [
      p.name && street ? street : null,
      coarse.has(kind) ? town : uniq([p.postcode, town]).join(' '),
      p.county,
      p.state,
      p.country,
    ],
    [name],
  ).join(', ')
  const e = p.extent
  return {
    name,
    address,
    lat: c[1],
    lng: c[0],
    kind,
    country: p.countrycode?.toUpperCase() ?? null,
    sourceId: `osm:${p.osm_type.toUpperCase()}${p.osm_id}`,
    bbox: e ? [Math.min(e[0], e[2]), Math.min(e[1], e[3]), Math.max(e[0], e[2]), Math.max(e[1], e[3])] : null,
  }
}

function photonKind(p: NonNullable<PhotonFeature['properties']>): PlaceKind {
  switch (p.type) {
    case 'country':
      return 'country'
    case 'state':
    case 'county':
      return 'region'
    case 'city':
      return 'city'
    case 'district':
    case 'locality':
      return 'district'
    case 'street':
      return 'street'
    case 'house':
      return p.osm_key === 'building' || p.osm_key === 'place' || !p.name ? 'address' : 'poi'
    default:
      return p.name ? 'poi' : 'other'
  }
}

const NOMINATIM_KIND: Record<string, PlaceKind> = {
  country: 'country',
  state: 'region',
  region: 'region',
  province: 'region',
  county: 'region',
  state_district: 'region',
  city: 'city',
  town: 'city',
  village: 'city',
  municipality: 'city',
  hamlet: 'city',
  suburb: 'district',
  quarter: 'district',
  neighbourhood: 'district',
  city_district: 'district',
  borough: 'district',
  locality: 'district',
  isolated_dwelling: 'district',
  farm: 'district',
  road: 'street',
  residential: 'street',
  pedestrian: 'street',
  house_number: 'address',
  house: 'address',
  building: 'address',
  postcode: 'district',
}

function fromNominatim(r: NominatimHit): ReverseHit {
  const a = r.address ?? {}
  const osmType = { node: 'N', way: 'W', relation: 'R' }[r.osm_type ?? '']
  const road = uniq([a.road ?? a.pedestrian ?? a.footway ?? a.path, a.house_number]).join(' ') || null
  const locality = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? null
  const display = r.display_name ?? ''
  const name = r.name || road || locality || display.split(',')[0]?.trim() || 'Unnamed place'
  const kind =
    NOMINATIM_KIND[r.addresstype ?? ''] ?? (r.category === 'highway' ? 'street' : r.name ? 'poi' : 'other')
  const parts = display.split(',').map((s) => s.trim())
  const address = (parts[0]?.toLowerCase() === name.toLowerCase() ? parts.slice(1) : parts).join(', ')
  const b = r.boundingbox?.map(Number)
  return {
    name,
    address,
    lat: Number(r.lat),
    lng: Number(r.lon),
    kind,
    country: a.country_code?.toUpperCase() ?? null,
    sourceId: osmType ? `osm:${osmType}${r.osm_id}` : `nominatim:${r.place_id}`,
    bbox: b && b.length === 4 && b.every(Number.isFinite) ? [b[2]!, b[0]!, b[3]!, b[1]!] : null,
    locality,
    road,
  }
}
