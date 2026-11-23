import { GeocodeResult, Place, PlaceInput, PlaceRef } from '@greenlit/shared'
import {
  MapPointsQuery,
  MapPointView,
  PlaceAssignInput,
  PlaceEntityType,
  PlaceSearchResponse,
  PlaceUpdateInput,
} from '@greenlit/shared/areas/geo'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type Actor, can } from '../../core/actor.ts'
import { IdParams, Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import type { GeoLang } from './geocode.ts'
import { places } from './schema.ts'
import { PlacesService } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    places?: PlacesService
  }
}

const EntityParams = z.object({ entityType: PlaceEntityType, entityId: z.uuid() })
const Lang = z.enum(['en', 'it']).optional()
const langOf = (actor: Actor, lang?: 'en' | 'it'): GeoLang =>
  lang ?? (actor.kind === 'user' ? actor.user.locale : 'en')

export default defineModule({
  id: 'places',
  name: 'Places & map',
  description:
    'Places for projects and media (picked from OpenStreetMap, typed by hand or read from GPS tags) and the map.',
  dependsOn: ['users', 'projects'],
  after: ['media'],
  permissions: {
    'places.read': { description: 'See places and the map', roles: ['reviewer'] },
    'places.manage': {
      description: 'Add, rename, move and delete places, and assign them to projects and media',
      roles: [],
    },
  },
  setup(ctx) {
    const svc = new PlacesService(ctx)
    ctx.services.provide('places', svc)

    // ── versioning: edits of a place and what it is assigned to ─────────
    ctx.versions.register('place', {
      labels: {
        name: 'name',
        address: 'address',
        location: 'location',
        kind: 'kind',
        country: 'country',
        links: 'assignments',
      },
      ignore: ['source', 'sourceId'],
      coalesceSeconds: 30,
      snapshot: async (id) => {
        const [p] = await ctx.db.select().from(places).where(eq(places.id, id))
        if (!p) return null
        const links = await svc.linksOf(id)
        return {
          name: p.name,
          address: p.address,
          location: { lat: p.lat, lng: p.lng },
          kind: p.kind,
          country: p.country,
          source: p.source,
          sourceId: p.sourceId,
          links: links.map((l) => `${l.entityType}:${l.entityId}`),
        }
      },
      restore: async (id, d, actor) => {
        const loc = d.location as { lat: number; lng: number }
        await svc.update(
          id,
          {
            name: d.name as string,
            address: d.address as string,
            lat: loc.lat,
            lng: loc.lng,
            kind: (d.kind as string) ?? null,
            country: (d.country as string) ?? null,
          },
          actor,
          { record: false },
        )
        const refs = ((d.links as string[]) ?? []).map((s) => {
          const [type, entityId] = s.split(':') as [PlaceEntityType, string]
          return { type, id: entityId }
        })
        await svc.setLinks(id, refs, actor)
      },
    })

    // ── directory, realtime ─────────────────────────────────────────────
    ctx.entities.register('place', {
      canView: async (id, actor) => can(actor, 'places.read') && !!(await svc.row(id).catch(() => null)),
      summarize: async (ids, actor) => {
        if (!can(actor, 'places.read')) return []
        return (await svc.list(actor, { ids, limit: ids.length })).map((p) => ({
          type: 'place',
          id: p.id,
          title: p.name,
          thumbnailUrl: null,
          kind: p.kind ?? 'place',
          href: `/map?focus=place:${p.id}`,
          projectId: null,
        }))
      },
    })
    ctx.realtime.guard('places', (actor) => can(actor, 'places.read'))
    ctx.realtime.guard('place', (actor) => can(actor, 'places.read'))

    // ── hooks & events from media / projects ────────────────────────────
    ctx.hooks.add('media.decorate', ({ ids }) => svc.refsFor('media', ids))
    ctx.hooks.add('projects.decorate', ({ ids }) => svc.refsFor('project', ids))
    ctx.hooks.add('media.searchFilter', async ({ key, values }) => {
      if (key !== 'place' && key !== 'places' && key !== 'luogo') return undefined
      return svc.mediaIdsAt(values)
    })
    ctx.events.on('media.located', async ({ id, lat, lng }) => {
      await svc.autoLocate(id, lat, lng)
    })
    ctx.events.on('media.deleted', async ({ id }) => {
      // Trashed items keep their places; purged ones (row gone) lose them.
      if (!ctx.has('media')) return
      const exists = await ctx.services.media.row(id).then(
        () => true,
        () => false,
      )
      if (!exists) await svc.forgetEntity('media', id)
    })

    // ── API ─────────────────────────────────────────────────────────────
    const tags = ['Places']
    // Static paths first: /places/{id} would otherwise swallow them.
    route(ctx.api, {
      method: 'get',
      path: '/places/search',
      summary: 'Search existing places and OpenStreetMap together',
      description:
        'Existing places come first (reuse them); `geocoded` holds OpenStreetMap results that are not in Greenlit yet.',
      tags,
      access: 'places.read',
      query: z.object({
        q: z.string().min(1).max(200),
        limit: z.coerce.number().int().min(1).max(15).optional(),
        lang: Lang,
        geocode: z.enum(['0', '1']).optional(),
      }),
      response: PlaceSearchResponse,
      handler: ({ actor, query }) =>
        svc.search(actor, query.q, {
          limit: query.limit,
          lang: langOf(actor, query.lang),
          geocode: query.geocode !== '0',
        }),
    })
    route(ctx.api, {
      method: 'get',
      path: '/places/links/{entityType}/{entityId}',
      summary: 'Places of a project or media item',
      tags,
      access: 'places.read',
      params: EntityParams,
      response: z.array(PlaceRef),
      handler: async ({ actor, params }) => {
        if (!(await ctx.entities.canView(params.entityType, params.entityId, actor))) return []
        return svc.placesOf(params.entityType, params.entityId)
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/places/links/{entityType}/{entityId}',
      summary: 'Put a project or media item at a place',
      description:
        'Pass `placeId` for an existing place, or `place` (e.g. a geocoding result with source "osm" and its sourceId) to add it.',
      tags,
      access: 'places.manage',
      params: EntityParams,
      body: PlaceAssignInput,
      response: z.array(PlaceRef),
      status: 201,
      handler: ({ actor, params, body }) => svc.assign(params.entityType, params.entityId, body, actor),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/places/links/{entityType}/{entityId}/{placeId}',
      summary: 'Take a project or media item off a place',
      tags,
      access: 'places.manage',
      params: EntityParams.extend({ placeId: z.uuid() }),
      response: z.array(PlaceRef),
      handler: ({ actor, params }) => svc.unassign(params.entityType, params.entityId, params.placeId, actor),
    })
    route(ctx.api, {
      method: 'get',
      path: '/places',
      summary: 'Places in use, with how many things you can see at each',
      tags,
      access: 'places.read',
      query: z.object({
        q: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }),
      response: z.array(Place),
      handler: ({ actor, query }) => svc.list(actor, query),
    })
    route(ctx.api, {
      method: 'post',
      path: '/places',
      summary: 'Add a place (returns the existing one for the same OpenStreetMap object)',
      tags,
      access: 'places.manage',
      body: PlaceInput,
      response: Place,
      status: 201,
      handler: async ({ actor, body }) => svc.get((await svc.create(body, actor)).id, actor),
    })
    route(ctx.api, {
      method: 'get',
      path: '/places/{id}',
      summary: 'One place',
      tags,
      access: 'places.read',
      params: IdParams,
      response: Place,
      handler: ({ actor, params }) => svc.get(params.id, actor),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/places/{id}',
      summary: 'Rename or move a place (creates a version)',
      tags,
      access: 'places.manage',
      params: IdParams,
      body: PlaceUpdateInput,
      response: Place,
      handler: async ({ actor, params, body }) => {
        await svc.update(params.id, body, actor)
        return svc.get(params.id, actor)
      },
    })
    route(ctx.api, {
      method: 'delete',
      path: '/places/{id}',
      summary: 'Delete a place (projects and media stay, without it)',
      tags,
      access: 'places.manage',
      params: IdParams,
      response: Ok,
      handler: async ({ actor, params }) => {
        await svc.remove(params.id, actor)
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/geocode/search',
      summary: 'Find places on OpenStreetMap (proxied, cached)',
      tags,
      access: 'places.read',
      query: z.object({
        q: z.string().min(1).max(200),
        limit: z.coerce.number().int().min(1).max(15).optional(),
        lang: Lang,
      }),
      response: z.array(GeocodeResult),
      handler: ({ actor, query }) =>
        svc.geo.search(query.q, { limit: query.limit, lang: langOf(actor, query.lang) }),
    })
    route(ctx.api, {
      method: 'get',
      path: '/geocode/reverse',
      summary: 'What is at these coordinates (proxied, cached, at most one upstream request per second)',
      tags,
      access: 'places.read',
      query: z.object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        lang: Lang,
        zoom: z.coerce.number().int().min(3).max(18).optional(),
      }),
      response: GeocodeResult.nullable(),
      handler: async ({ c, actor, query }) => {
        const hit = await svc.geo.reverse(query.lat, query.lng, {
          lang: langOf(actor, query.lang),
          zoom: query.zoom,
        })
        if (!hit) return c.json(null) // (a plain null would become { ok: true })
        const { locality: _l, road: _r, ...result } = hit
        return result
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/map/points',
      summary: 'Projects and media with a place that you can see, one point per place',
      tags: ['Map'],
      access: 'places.read',
      query: MapPointsQuery,
      response: z.array(MapPointView),
      handler: ({ actor, query }) => svc.mapPoints(actor, query),
    })

    // ── MCP ─────────────────────────────────────────────────────────────
    ctx.mcp.instruct(
      'Projects and media items can be at one or more places. To place something: call places_search, reuse an entry from `places` when one matches (pass its id as placeId), otherwise pass a `geocoded` result as `place` to places_assign. Photos and videos with GPS tags are placed automatically. map_points lists what is on the map; the library search understands place:"Ostuni".',
    )
    const PlaceArg = z
      .object({
        name: z.string().min(1).max(200),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        address: z.string().max(500).optional(),
        kind: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
        sourceId: z
          .string()
          .nullable()
          .optional()
          .describe('The sourceId of a geocoded result ("osm:R40666"); leave out for a hand-made place'),
      })
      .describe('A new place: copy a `geocoded` result from places_search, or give a name and coordinates')
    ctx.mcp.tool({
      name: 'places_search',
      title: 'Search places',
      description:
        'Find a place by name or address. Returns `places` (already in Greenlit, with ids and how many things are there; reuse these) and `geocoded` (OpenStreetMap results not in Greenlit yet, with coordinates, kind and sourceId). Set geocode:false to only search existing places.',
      input: {
        q: z.string().min(1),
        limit: z.number().int().min(1).max(15).optional(),
        geocode: z.boolean().optional(),
        lang: Lang,
      },
      access: 'places.read',
      readOnly: true,
      handler: ({ q, limit, geocode, lang }, { actor }) =>
        svc.search(actor, q, { limit, geocode, lang: langOf(actor, lang) }),
    })
    ctx.mcp.tool({
      name: 'places_assign',
      title: 'Put something at a place',
      description:
        'Assign a place to a project or media item (they can have several). Give placeId for an existing place, or place for a new one (e.g. a geocoded result from places_search — it is reused if it already exists). Returns all places of that item.',
      input: {
        entityType: PlaceEntityType,
        entityId: z.uuid(),
        placeId: z.uuid().optional(),
        place: PlaceArg.optional(),
      },
      access: 'places.manage',
      handler: async ({ entityType, entityId, placeId, place }, { actor }) => {
        const input = place
          ? PlaceInput.parse({
              ...place,
              source: place.sourceId ? 'osm' : 'manual',
              address: place.address ?? '',
              kind: place.kind ?? null,
              country: place.country ?? null,
              sourceId: place.sourceId ?? null,
            })
          : undefined
        return { places: await svc.assign(entityType, entityId, { placeId, place: input }, actor) }
      },
    })
    ctx.mcp.tool({
      name: 'places_unassign',
      title: 'Take something off a place',
      description:
        'Remove a place from a project or media item. The place itself stays for other items. Returns the places left.',
      input: { entityType: PlaceEntityType, entityId: z.uuid(), placeId: z.uuid() },
      access: 'places.manage',
      destructive: true,
      handler: async ({ entityType, entityId, placeId }, { actor }) => ({
        places: await svc.unassign(entityType, entityId, placeId, actor),
      }),
    })
    ctx.mcp.tool({
      name: 'map_points',
      title: 'What is on the map',
      description:
        'Projects and media items that have a place, one point per item and place: type, id, title, project, place name and coordinates. Filter with q (title or place name), type (project|media), placeId, or bbox "minLng,minLat,maxLng,maxLat".',
      input: {
        q: z.string().optional(),
        type: PlaceEntityType.optional(),
        placeId: z.uuid().optional(),
        bbox: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
      access: 'places.read',
      readOnly: true,
      handler: async (input, { actor }) => {
        const points = await svc.mapPoints(actor, { ...input, limit: input.limit ?? 200 })
        return points.map((p) => ({
          type: p.type,
          id: p.id,
          title: p.title,
          ...(p.type === 'media'
            ? { kind: p.kind, projectId: p.projectId, project: p.projectName }
            : { media: p.mediaCount }),
          place: {
            id: p.place.id,
            name: p.place.name,
            lat: Number(p.place.lat.toFixed(6)),
            lng: Number(p.place.lng.toFixed(6)),
          },
        }))
      },
    })
  },
})
