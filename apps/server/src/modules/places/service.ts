import type { GeocodeResult, Place, PlaceInput, PlaceRef } from '@greenlit/shared'
import {
  distanceMeters,
  type MapPointsQuery,
  type MapPointView,
  type PlaceEntityType,
  type PlaceUpdateInput,
  parseBbox,
} from '@greenlit/shared/areas/geo'
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm'
import { type Actor, actorUserId, can, systemActor } from '../../core/actor.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import { media, mediaFormats } from '../media/schema.ts'
import { projects } from '../projects/schema.ts'
import { Geocoder, type GeoLang, type ReverseHit } from './geocode.ts'
import { placeLinks, places } from './schema.ts'

type PlaceRow = typeof places.$inferSelect

declare module '../../core/events.ts' {
  interface Events {
    'places.linked': { placeId: string; entityType: PlaceEntityType; entityId: string }
    'places.unlinked': { placeId: string; entityType: PlaceEntityType; entityId: string }
    'places.changed': { placeId: string }
  }
}

/** A GPS position this close to an existing place reuses that place instead of adding a near-duplicate. */
export const NEARBY_METERS = 150

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&')
const words = (q: string | undefined) => (q ?? '').split(/\s+/).map(fold).filter(Boolean).slice(0, 8)
const searchTextFor = (p: { name: string; address: string }) => fold(`${p.name} • ${p.address}`)

export class PlacesService {
  readonly ctx: ModuleContext
  readonly geo: Geocoder
  /** GPS auto-placement runs one item at a time so photos taken together share one place. */
  private locating: Promise<unknown> = Promise.resolve()

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
    this.geo = new Geocoder(ctx.log.child({ part: 'geocode' }))
  }
  private get db() {
    return this.ctx.db
  }

  // ── views ───────────────────────────────────────────────────────────────

  view(r: PlaceRow, usage = 0): Place {
    return {
      id: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      kind: r.kind,
      country: r.country,
      source: r.source as Place['source'],
      sourceId: r.sourceId,
      usage,
    }
  }

  ref(r: Pick<PlaceRow, 'id' | 'name' | 'lat' | 'lng'>): PlaceRef {
    return { id: r.id, name: r.name, lat: r.lat, lng: r.lng }
  }

  async row(id: string): Promise<PlaceRow> {
    const [r] = await this.db.select().from(places).where(eq(places.id, id))
    if (!r) throw notFound('Place not found')
    return r
  }

  /** Places of many projects or media items at once (for the decorate hooks). */
  async refsFor(entityType: PlaceEntityType, ids: string[]): Promise<Record<string, { places: PlaceRef[] }>> {
    if (!ids.length) return {}
    const rows = await this.db
      .select({
        entityId: placeLinks.entityId,
        id: places.id,
        name: places.name,
        lat: places.lat,
        lng: places.lng,
      })
      .from(placeLinks)
      .innerJoin(places, eq(places.id, placeLinks.placeId))
      .where(and(eq(placeLinks.entityType, entityType), inArray(placeLinks.entityId, ids)))
      .orderBy(asc(placeLinks.position), asc(placeLinks.createdAt))
    const out: Record<string, { places: PlaceRef[] }> = {}
    for (const r of rows) {
      const entry = out[r.entityId] ?? { places: [] }
      entry.places.push(this.ref(r))
      out[r.entityId] = entry
    }
    return out
  }

  async placesOf(entityType: PlaceEntityType, id: string): Promise<PlaceRef[]> {
    return (await this.refsFor(entityType, [id]))[id]?.places ?? []
  }

  /** How many things this actor can see are at each place. */
  private async usageSql(actor: Actor): Promise<SQL<number>> {
    const parts: SQL[] = []
    if (this.ctx.has('media') && can(actor, 'media.read')) {
      const visible = await this.ctx.services.media.visibleWhere(actor)
      parts.push(
        sql`(select count(*) from ${placeLinks} join ${media} on ${media.id} = ${placeLinks.entityId} where ${placeLinks.placeId} = ${places.id} and ${placeLinks.entityType} = 'media' and ${visible})`,
      )
    }
    if (can(actor, 'projects.read')) {
      const visible = this.ctx.services.projects.visibleWhere(actor)
      parts.push(
        sql`(select count(*) from ${placeLinks} join ${projects} on ${projects.id} = ${placeLinks.entityId} where ${placeLinks.placeId} = ${places.id} and ${placeLinks.entityType} = 'project' and ${visible})`,
      )
    }
    return (parts.length ? sql`(${sql.join(parts, sql` + `)})::int` : sql`0`).mapWith(Number) as SQL<number>
  }

  async list(actor: Actor, opts: { q?: string; limit?: number; ids?: string[] } = {}): Promise<Place[]> {
    const usage = await this.usageSql(actor)
    const ws = words(opts.q)
    const where: (SQL | undefined)[] = ws.map((w) => sql`${places.searchText} like ${`%${escapeLike(w)}%`}`)
    if (opts.ids) where.push(opts.ids.length ? inArray(places.id, opts.ids) : sql`false`)
    const first = ws.join(' ')
    const rows = await this.db
      .select({ place: places, usage })
      .from(places)
      .where(and(...where))
      .orderBy(
        ...(first ? [desc(sql`${places.searchText} like ${`${escapeLike(first)}%`}`)] : []),
        desc(usage),
        desc(places.updatedAt),
      )
      .limit(Math.min(opts.limit ?? 50, 500))
    return rows.map((r) => this.view(r.place, r.usage))
  }

  async get(id: string, actor: Actor): Promise<Place> {
    const [p] = await this.list(actor, { ids: [id], limit: 1 })
    if (!p) throw notFound('Place not found')
    return p
  }

  /** Existing places first, then OpenStreetMap results that are not in Greenlit yet. */
  async search(actor: Actor, q: string, opts: { limit?: number; lang?: GeoLang; geocode?: boolean } = {}) {
    const limit = opts.limit ?? 6
    const existing = await this.list(actor, { q, limit })
    let geocoded: GeocodeResult[] = []
    if (opts.geocode !== false && q.trim().length >= 2) {
      try {
        geocoded = await this.geo.search(q, { limit, lang: opts.lang })
      } catch {
        geocoded = [] // existing places still answer while geocoding is down
      }
      const known = new Set(existing.map((p) => p.sourceId).filter(Boolean))
      geocoded = geocoded.filter((g) => !known.has(g.sourceId))
    }
    return { places: existing, geocoded }
  }

  // ── writes ──────────────────────────────────────────────────────────────

  /** Adds a place, or returns the existing one for the same OpenStreetMap object. */
  async create(input: PlaceInput, actor: Actor): Promise<PlaceRow> {
    if (input.sourceId && input.source === 'osm') {
      const [same] = await this.db.select().from(places).where(eq(places.sourceId, input.sourceId)).limit(1)
      if (same) return same
    }
    const name = input.name.trim()
    if (!name) throw badRequest('A place needs a name')
    const [row] = await this.db
      .insert(places)
      .values({
        name,
        address: input.address.trim(),
        lat: input.lat,
        lng: input.lng,
        kind: input.kind,
        country: input.country?.toUpperCase() ?? null,
        source: input.source,
        sourceId: input.sourceId,
        searchText: searchTextFor({ name, address: input.address }),
        createdBy: actorUserId(actor),
      })
      .returning()
    await this.ctx.versions.record('place', row!.id, actor)
    this.ctx.events.emit('places.changed', { placeId: row!.id })
    this.ctx.realtime.publish('places', 'places.changed', {})
    return row!
  }

  /** `record: false` is for version restores, which record their own revision. */
  async update(
    id: string,
    patch: PlaceUpdateInput,
    actor: Actor,
    opts: { record?: boolean } = {},
  ): Promise<PlaceRow> {
    const cur = await this.row(id)
    const next = {
      name: patch.name?.trim() || cur.name,
      address: patch.address !== undefined ? patch.address.trim() : cur.address,
      lat: patch.lat ?? cur.lat,
      lng: patch.lng ?? cur.lng,
      kind: patch.kind !== undefined ? patch.kind : cur.kind,
      country: patch.country !== undefined ? (patch.country?.toUpperCase() ?? null) : cur.country,
    }
    const moved = next.lat !== cur.lat || next.lng !== cur.lng
    const [row] = await this.db
      .update(places)
      .set({
        ...next,
        searchText: searchTextFor(next),
        // A place moved by hand is no longer the OpenStreetMap object it came from.
        ...(moved && cur.source !== 'manual' ? { source: 'manual', sourceId: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(places.id, id))
      .returning()
    if (opts.record !== false) await this.ctx.versions.record('place', id, actor)
    await this.touchLinked(id)
    this.ctx.events.emit('places.changed', { placeId: id })
    return row!
  }

  async remove(id: string, _actor: Actor) {
    await this.row(id)
    const links = await this.linksOf(id)
    await this.db.delete(places).where(eq(places.id, id))
    for (const l of links) await this.touchEntity(l.entityType as PlaceEntityType, l.entityId)
    this.ctx.events.emit('places.changed', { placeId: id })
    this.ctx.realtime.publish('places', 'places.changed', {})
  }

  /** Puts a project or media item at a place (an existing one, or a new one created from `place`). */
  async assign(
    entityType: PlaceEntityType,
    entityId: string,
    input: { placeId?: string; place?: PlaceInput },
    actor: Actor,
  ): Promise<PlaceRef[]> {
    await this.ensureVisible(entityType, entityId, actor)
    const place = input.placeId
      ? await this.row(input.placeId)
      : input.place
        ? await this.create(input.place, actor)
        : null
    if (!place) throw badRequest('Give either placeId or place')
    await this.link(entityType, entityId, place.id, actor)
    return this.placesOf(entityType, entityId)
  }

  async unassign(
    entityType: PlaceEntityType,
    entityId: string,
    placeId: string,
    actor: Actor,
  ): Promise<PlaceRef[]> {
    await this.ensureVisible(entityType, entityId, actor)
    const gone = await this.db
      .delete(placeLinks)
      .where(
        and(
          eq(placeLinks.placeId, placeId),
          eq(placeLinks.entityType, entityType),
          eq(placeLinks.entityId, entityId),
        ),
      )
      .returning({ id: placeLinks.id })
    if (gone.length) {
      const place = await this.row(placeId).catch(() => null)
      // A place made from a file's GPS tags that nothing uses any more is just noise.
      if (place?.source === 'exif' && !(await this.linksOf(placeId)).length) {
        await this.db.delete(places).where(eq(places.id, placeId))
      } else {
        await this.ctx.versions.record('place', placeId, actor)
      }
      this.ctx.events.emit('places.unlinked', { placeId, entityType, entityId })
      await this.touchEntity(entityType, entityId)
    }
    return this.placesOf(entityType, entityId)
  }

  private async link(entityType: PlaceEntityType, entityId: string, placeId: string, actor: Actor) {
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(placeLinks)
      .where(and(eq(placeLinks.entityType, entityType), eq(placeLinks.entityId, entityId)))
    const added = await this.db
      .insert(placeLinks)
      .values({ placeId, entityType, entityId, position: n, createdBy: actorUserId(actor) })
      .onConflictDoNothing()
      .returning({ id: placeLinks.id })
    if (!added.length) return false
    await this.db.update(places).set({ updatedAt: new Date() }).where(eq(places.id, placeId))
    await this.ctx.versions.record('place', placeId, actor)
    this.ctx.events.emit('places.linked', { placeId, entityType, entityId })
    await this.touchEntity(entityType, entityId)
    return true
  }

  async linksOf(placeId: string) {
    return this.db
      .select({ entityType: placeLinks.entityType, entityId: placeLinks.entityId })
      .from(placeLinks)
      .where(eq(placeLinks.placeId, placeId))
      .orderBy(asc(placeLinks.entityType), asc(placeLinks.entityId))
  }

  /** Replaces the links of a place (version restore). Things that no longer exist are skipped. */
  async setLinks(placeId: string, refs: { type: PlaceEntityType; id: string }[], actor: Actor) {
    const before = await this.linksOf(placeId)
    const key = (t: string, id: string) => `${t}:${id}`
    const want = new Map(refs.map((r) => [key(r.type, r.id), r]))
    const have = new Set(before.map((l) => key(l.entityType, l.entityId)))
    for (const l of before) {
      if (want.has(key(l.entityType, l.entityId))) continue
      await this.db
        .delete(placeLinks)
        .where(
          and(
            eq(placeLinks.placeId, placeId),
            eq(placeLinks.entityType, l.entityType),
            eq(placeLinks.entityId, l.entityId),
          ),
        )
      await this.touchEntity(l.entityType as PlaceEntityType, l.entityId)
    }
    for (const r of want.values()) {
      if (have.has(key(r.type, r.id))) continue
      if (!(await this.ctx.entities.canView(r.type, r.id, systemActor()))) continue
      await this.db
        .insert(placeLinks)
        .values({ placeId, entityType: r.type, entityId: r.id, createdBy: actorUserId(actor) })
        .onConflictDoNothing()
      await this.touchEntity(r.type, r.id)
    }
  }

  private async ensureVisible(entityType: PlaceEntityType, entityId: string, actor: Actor) {
    if (
      !this.ctx.entities.has(entityType) ||
      !(await this.ctx.entities.canView(entityType, entityId, actor))
    ) {
      throw notFound(entityType === 'media' ? 'Media not found' : 'Project not found')
    }
  }

  /** Tells open pages that a project's or media item's places changed. */
  async touchEntity(entityType: PlaceEntityType, entityId: string) {
    if (entityType === 'media' && this.ctx.has('media')) {
      const m = await this.ctx.services.media.row(entityId).catch(() => null)
      if (m) this.ctx.services.media.publish(entityId, m.projectId, 'media.updated')
    } else if (entityType === 'project') {
      this.ctx.realtime.publish(`project:${entityId}`, 'project.updated', { id: entityId })
    }
    this.ctx.realtime.publish('places', 'places.changed', {})
  }

  private async touchLinked(placeId: string) {
    for (const l of await this.linksOf(placeId))
      await this.touchEntity(l.entityType as PlaceEntityType, l.entityId)
    this.ctx.realtime.publish('places', 'places.changed', {})
  }

  // ── GPS ─────────────────────────────────────────────────────────────────

  /** The closest place within `meters`, skipping countries and regions (their centre means nothing). */
  async nearest(lat: number, lng: number, meters = NEARBY_METERS): Promise<PlaceRow | null> {
    const dLat = meters / 111_320
    const dLng = meters / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
    const rows = await this.db
      .select()
      .from(places)
      .where(
        and(
          gte(places.lat, lat - dLat),
          lte(places.lat, lat + dLat),
          gte(places.lng, lng - dLng),
          lte(places.lng, lng + dLng),
          or(isNull(places.kind), sql`${places.kind} not in ('country', 'region')`),
        ),
      )
    let best: PlaceRow | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const r of rows) {
      const d = distanceMeters({ lat, lng }, r)
      if (d <= meters && d < bestD) {
        best = r
        bestD = d
      }
    }
    return best
  }

  /** media.located: give a media item without a place the place its GPS tags point at. */
  autoLocate(mediaId: string, lat: number, lng: number) {
    this.locating = this.locating
      .then(() => this.locate(mediaId, lat, lng))
      .catch((err) => this.ctx.log.warn({ err, mediaId }, 'could not place media from its GPS tags'))
    return this.locating
  }

  private async locate(mediaId: string, lat: number, lng: number) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return
    if (lat === 0 && lng === 0) return // "null island": a camera without a fix
    const [already] = await this.db
      .select({ id: placeLinks.id })
      .from(placeLinks)
      .where(and(eq(placeLinks.entityType, 'media'), eq(placeLinks.entityId, mediaId)))
      .limit(1)
    if (already) return // someone (or an earlier pass) already placed it
    const actor = systemActor('gps')
    let place = await this.nearest(lat, lng)
    if (!place) {
      let hit: ReverseHit | null = null
      try {
        hit = await this.geo.reverse(lat, lng)
      } catch {
        hit = null // offline: still put it on the map, named by its coordinates
      }
      place = await this.create(
        {
          name: hit ? gpsName(hit) : `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          address: hit?.address ?? '',
          lat,
          lng,
          kind: hit?.kind ?? 'other',
          country: hit?.country ?? null,
          source: 'exif',
          sourceId: hit?.sourceId ?? null,
        },
        actor,
      )
    }
    await this.link('media', mediaId, place.id, actor)
  }

  /** When media rows are purged their links go too. */
  async forgetEntity(entityType: PlaceEntityType, entityId: string) {
    const gone = await this.db
      .delete(placeLinks)
      .where(and(eq(placeLinks.entityType, entityType), eq(placeLinks.entityId, entityId)))
      .returning({ placeId: placeLinks.placeId })
    for (const g of gone) {
      const p = await this.row(g.placeId).catch(() => null)
      if (p?.source === 'exif' && !(await this.linksOf(p.id)).length)
        await this.db.delete(places).where(eq(places.id, p.id))
    }
    if (gone.length) this.ctx.realtime.publish('places', 'places.changed', {})
  }

  // ── search & map ────────────────────────────────────────────────────────

  /** `place:"Ostuni"` in the library: media at a matching place, or in a project at one. */
  async mediaIdsAt(values: string[]): Promise<string[]> {
    const conds = values
      .map(fold)
      .filter(Boolean)
      .map((v) => sql`p.search_text like ${`%${escapeLike(v)}%`}`)
    if (!conds.length) return []
    const match = sql.join(conds, sql` or `)
    const rows = await this.db.execute<{ id: string }>(sql`
      select l.entity_id as id from ${placeLinks} l join ${places} p on p.id = l.place_id
        where l.entity_type = 'media' and (${match})
      union
      select m.id from ${media} m where m.project_id in (
        select l.entity_id from ${placeLinks} l join ${places} p on p.id = l.place_id
        where l.entity_type = 'project' and (${match}))`)
    return rows.map((r) => r.id)
  }

  /** Everything with a place that this actor may see, as map points (one per thing and place). */
  async mapPoints(actor: Actor, q: Partial<MapPointsQuery>): Promise<MapPointView[]> {
    const limit = q.limit ?? 5000
    const placeWhere: SQL[] = []
    const bbox = parseBbox(q.bbox)
    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox
      placeWhere.push(and(gte(places.lat, minLat), lte(places.lat, maxLat))!)
      placeWhere.push(
        minLng <= maxLng
          ? and(gte(places.lng, minLng), lte(places.lng, maxLng))!
          : or(gte(places.lng, minLng), lte(places.lng, maxLng))!,
      )
    }
    if (q.placeId) placeWhere.push(eq(places.id, q.placeId))
    const ws = words(q.q)
    const placeCols = {
      placeId: places.id,
      placeName: places.name,
      lat: places.lat,
      lng: places.lng,
      placeKind: places.kind,
    }
    const out: MapPointView[] = []

    if (q.type !== 'media' && can(actor, 'projects.read')) {
      const rows = await this.db
        .select({ id: projects.id, title: projects.name, color: projects.color, ...placeCols })
        .from(placeLinks)
        .innerJoin(places, eq(places.id, placeLinks.placeId))
        .innerJoin(projects, eq(projects.id, placeLinks.entityId))
        .where(
          and(
            eq(placeLinks.entityType, 'project'),
            this.ctx.services.projects.visibleWhere(actor),
            isNull(projects.archivedAt),
            ...placeWhere,
            ...ws.map(
              (w) =>
                sql`(lower(unaccent(${projects.name})) like ${`%${escapeLike(w)}%`} or ${places.searchText} like ${`%${escapeLike(w)}%`})`,
            ),
          ),
        )
        .orderBy(desc(projects.updatedAt))
        .limit(limit)
      let ids = [...new Set(rows.map((r) => r.id))]
      if (actor.kind === 'user' && actor.share) {
        const ok = await Promise.all(ids.map((id) => this.ctx.services.projects.canView(id, actor)))
        ids = ids.filter((_, i) => ok[i]) // share links: only what the link shows
      }
      const full = new Map((await this.ctx.services.projects.many(ids, actor)).map((p) => [p.id, p]))
      for (const r of rows) {
        const p = full.get(r.id)
        if (!p) continue
        out.push({
          type: 'project',
          id: r.id,
          title: r.title,
          thumbnailUrl: p.coverUrl,
          projectId: null,
          projectName: null,
          kind: null,
          color: r.color,
          mediaCount: p.mediaCount,
          place: { id: r.placeId, name: r.placeName, lat: r.lat, lng: r.lng },
          placeKind: r.placeKind,
        })
      }
    }

    if (q.type !== 'project' && this.ctx.has('media') && can(actor, 'media.read')) {
      const visible = await this.ctx.services.media.visibleWhere(actor)
      const rows = await this.db
        .select({
          id: media.id,
          title: media.title,
          kind: media.kind,
          projectId: media.projectId,
          projectName: projects.name,
          color: projects.color,
          thumb: sql<
            string | null
          >`(select '/api/files/' || f.blob_id::text || '/d/thumb.webp?v=' || f.file_revision::text from ${mediaFormats} f where f.media_id = ${media.id} and f.is_primary and 'thumb.webp' = any(f.derived) limit 1)`,
          ...placeCols,
        })
        .from(placeLinks)
        .innerJoin(places, eq(places.id, placeLinks.placeId))
        .innerJoin(media, eq(media.id, placeLinks.entityId))
        .leftJoin(projects, and(eq(projects.id, media.projectId), isNull(projects.deletedAt)))
        .where(
          and(
            eq(placeLinks.entityType, 'media'),
            visible,
            ...placeWhere,
            ...ws.map(
              (w) =>
                sql`(${media.searchText} like ${`%${escapeLike(w)}%`} or ${places.searchText} like ${`%${escapeLike(w)}%`})`,
            ),
          ),
        )
        .orderBy(desc(sql`coalesce(${media.takenAt}, ${media.createdAt})`))
        .limit(limit)
      let allowed: Set<string> | null = null
      if (actor.kind === 'user' && actor.share) {
        allowed = new Set()
        for (const id of new Set(rows.map((r) => r.id)))
          if (await this.ctx.services.media.canView(id, actor)) allowed.add(id)
      }
      for (const r of rows) {
        if (allowed && !allowed.has(r.id)) continue
        out.push({
          type: 'media',
          id: r.id,
          title: r.title || 'Untitled',
          thumbnailUrl: r.thumb,
          projectId: r.projectId,
          projectName: r.projectName,
          kind: r.kind,
          color: r.color,
          mediaCount: null,
          place: { id: r.placeId, name: r.placeName, lat: r.lat, lng: r.lng },
          placeKind: r.placeKind,
        })
      }
    }
    return out
  }
}

/** "Masseria Il Frantoio", or "Via Roma 12, Ostuni" for a street, or the town itself. */
function gpsName(hit: ReverseHit): string {
  if (hit.kind === 'poi') return hit.name
  if ((hit.kind === 'street' || hit.kind === 'address') && hit.locality) {
    const road = hit.road ?? hit.name
    return road.toLowerCase() === hit.locality.toLowerCase() ? road : `${road}, ${hit.locality}`
  }
  return hit.name
}
