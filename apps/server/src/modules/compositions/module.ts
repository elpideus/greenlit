import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Composition, describe, FORMAT_SIZES, newId, Op, OutputFormat } from '@greenlit/composition'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type Actor, actorUserId } from '../../core/actor.ts'
import { badRequest, HttpError, notFound } from '../../core/errors.ts'
import { IdParams, Ok, route } from '../../core/http.ts'
import { McpContent } from '../../core/mcp.ts'
import { defineModule } from '../../core/module.ts'
import type { RealtimeClient } from '../../core/realtime.ts'
import { exportFormats } from './export.ts'
import { autoReframe } from './reframe.ts'
import { Renderer } from './render.ts'
import { compositions } from './schema.ts'
import { CompositionsService } from './service.ts'
import { linkSources, outsideBrandKits } from './sources.ts'

declare module '../../core/services.ts' {
  interface Services {
    compositions: CompositionsService
  }
}

const GUIDE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'guide.md'), 'utf8')
const Preset = z.enum(['landscape', 'vertical', 'square', 'portrait'])
const FormatChoice = z.union([Preset, OutputFormat])

const CompositionView = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  name: z.string(),
  revision: z.number(),
  document: z.record(z.string(), z.unknown()),
  outputMediaId: z.string().nullable(),
  posterUrl: z.string().nullable(),
  createdBy: z
    .object({ id: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

interface ViewState {
  clientId: string
  user: { id: string; displayName: string } | null
  time: number
  playing: boolean
  selection: string[]
  formatId: string
  at: number
}

export default defineModule({
  id: 'compositions',
  name: 'Editor',
  description: 'Editing projects: live-preview compositions edited by people and Claude, rendered to media.',
  dependsOn: ['users', 'files', 'media', 'projects'],
  after: ['links'],
  permissions: {
    'compositions.read': { description: 'Open editing projects (watch, not edit)', roles: ['reviewer'] },
    'compositions.edit': { description: 'Create and edit editing projects', roles: [] },
    'compositions.render': { description: 'Export editing projects to media', roles: [] },
  },
  setup(ctx) {
    const svc = new CompositionsService(ctx)
    const renderer = new Renderer(ctx)
    ctx.services.provide('compositions', svc)
    ctx.onStop(() => renderer.close())
    const tags = ['Editor']
    const views = new Map<string, Map<string, ViewState>>() // compositionId → clientId → view

    ctx.versions.register('composition', {
      labels: { name: 'name', document: 'edit' },
      coalesceSeconds: 90,
      snapshot: async (id) => {
        const [r] = await ctx.db.select().from(compositions).where(eq(compositions.id, id))
        if (!r) return null
        const doc = r.document as Composition
        const blobIds: string[] = []
        return {
          name: r.name,
          document: doc as unknown as Record<string, unknown>,
          deletedAt: r.deletedAt?.toISOString() ?? null,
          blobIds,
        }
      },
      restore: async (id, d, actor) => {
        await ctx.db
          .update(compositions)
          .set({ name: d.name as string, deletedAt: d.deletedAt ? new Date(d.deletedAt as string) : null })
          .where(eq(compositions.id, id))
        await svc.apply(id, [{ op: 'replace', composition: d.document as Record<string, unknown> }], actor)
      },
    })
    ctx.entities.register('composition', {
      canView: (id, actor) => svc.canView(id, actor),
      summarize: async (ids, actor) => {
        const out = []
        for (const id of ids) {
          if (!(await svc.canView(id, actor))) continue
          const r = await svc.row(id).catch(() => null)
          if (r)
            out.push({
              type: 'composition',
              id,
              title: r.name,
              thumbnailUrl:
                r.posterRevision !== null ? `/api/compositions/${id}/poster.jpg?v=${r.posterRevision}` : null,
              kind: 'composition',
              href: `/edit/${id}`,
              projectId: r.projectId,
            })
        }
        return out
      },
    })
    ctx.hooks.add('projects.decorate', async ({ ids }) => {
      const counts = await svc.countByProject(ids)
      return Object.fromEntries(ids.map((id) => [id, { compositionCount: counts[id] ?? 0 }]))
    })

    // ── live collaboration ──────────────────────────────────────────────
    ctx.realtime.guard('composition', (actor, topic) => svc.canView(topic.split(':')[1]!, actor))
    ctx.realtime.onMessage('composition', (client: RealtimeClient, msg) => {
      const id = msg.topic.split(':')[1]!
      if (msg.event === 'view') {
        const d = msg.data as Partial<ViewState>
        const map = views.get(id) ?? new Map()
        map.set(client.id, {
          clientId: client.id,
          user:
            client.actor.kind === 'user'
              ? { id: client.actor.user.id, displayName: client.actor.user.displayName }
              : null,
          time: Number(d.time) || 0,
          playing: !!d.playing,
          selection: Array.isArray(d.selection) ? d.selection.slice(0, 50).map(String) : [],
          formatId: String(d.formatId ?? 'main'),
          at: Date.now(),
        })
        views.set(id, map)
        ctx.realtime.publish(msg.topic, 'presence', [...map.values()], { except: client.id })
      }
    })
    ctx.realtime.onDisconnect((client) => {
      for (const [id, map] of views)
        if (map.delete(client.id)) ctx.realtime.publish(`composition:${id}`, 'presence', [...map.values()])
    })

    // ── render jobs ─────────────────────────────────────────────────────
    /** "Made from" links on the exported item to the media the edit uses (not its brand kit files). */
    const relinkSources = async (mediaId: string, doc: Composition) => {
      const links = ctx.services.links
      if (!links) return []
      return linkSources({ links, material: (ids) => outsideBrandKits(ctx.db, ids) }, mediaId, doc)
    }
    ctx.jobs.define<{ compositionId: string; formats: string[]; userId: string | null }>(
      'compositions.render',
      {
        concurrency: 1,
        retryLimit: 0,
        expireInSeconds: 6 * 3600,
        handler: async ({ compositionId, formats, userId }, job) => {
          const r = await svc.row(compositionId)
          const doc = Composition.parse(r.document)
          const actor: Actor = userId
            ? ctx.services.users.actorFor(await ctx.services.users.get(userId), 'web')
            : { kind: 'system', source: 'system' }
          let mediaId = r.outputMediaId
          if (mediaId && !(await ctx.services.media.canView(mediaId, { kind: 'system', source: 'system' })))
            mediaId = null
          mediaId = await exportFormats(
            {
              render: (format, sub) => renderer.render(compositionId, doc, format, actor, sub),
              files: ctx.services.files,
              media: ctx.services.media,
              setOutputMedia: (id) => svc.setOutputMedia(compositionId, id),
            },
            r,
            doc,
            formats,
            mediaId,
            actor,
            job,
          )
          if (mediaId)
            await ctx.services.links?.link(
              { type: 'composition', id: compositionId },
              'rendered_to',
              { type: 'media', id: mediaId },
              { auto: true },
            )
          // The export itself is done: a link that fails must not fail it.
          if (mediaId)
            await relinkSources(mediaId, doc).catch((err) =>
              ctx.log.warn({ err, mediaId }, 'linking an export to its sources failed'),
            )
          ctx.realtime.publish(`composition:${compositionId}`, 'rendered', { mediaId })
          return { mediaId }
        },
      },
    )
    ctx.jobs.define('compositions.sweep', { handler: () => renderer.sweep() })
    ctx.onStart(() => ctx.jobs.schedule('compositions.sweep', '0 * * * *'))

    const startRender = async (id: string, formats: string[], actor: Actor) => {
      const r = await svc.row(id)
      const { taskId } = await ctx.jobs.send(
        'compositions.render',
        { compositionId: id, formats, userId: actorUserId(actor) },
        {
          task: {
            kind: 'compositions.render',
            title: `Exporting ${r.name}`,
            entityType: 'composition',
            entityId: id,
            createdBy: actorUserId(actor),
          },
        },
      )
      return { taskId }
    }

    const formatOf = (doc: Composition, formatId?: string) => {
      const f = doc.formats.find((x) => x.id === formatId) ?? doc.formats[0]
      if (!f) throw badRequest('No such format')
      return f
    }

    // ── API ─────────────────────────────────────────────────────────────
    route(ctx.api, {
      method: 'post',
      path: '/compositions/{id}/clips/{clipId}/auto-reframe',
      summary: 'Follow the subject: keyframe the framing of a video clip for one format (e.g. vertical)',
      tags,
      access: 'compositions.edit',
      params: IdParams.extend({ clipId: z.string() }),
      body: z.object({
        formatId: z.string(),
        interval: z.number().min(0.2).max(5).optional(),
        axis: z.enum(['x', 'y', 'both']).optional(),
      }),
      response: z.object({
        revision: z.number(),
        samples: z.number(),
        keyframes: z.object({ focusX: z.number(), focusY: z.number() }),
      }),
      handler: async ({ actor, params, body }) => {
        const c = await svc.get(params.id, actor)
        const r = await autoReframe(ctx, c.document, params.clipId, body.formatId, body)
        const applied = await svc.apply(params.id, r.ops, actor)
        return { revision: applied.revision, samples: r.samples, keyframes: r.keyframes }
      },
    })
    ctx.api.get('/compositions/guide', (c) =>
      c.text(GUIDE, 200, { 'content-type': 'text/markdown; charset=utf-8' }),
    )
    route(ctx.api, {
      method: 'get',
      path: '/compositions',
      summary: 'Editing projects (optionally of one project)',
      tags,
      access: 'compositions.read',
      query: z.object({ projectId: z.uuid().optional() }),
      response: z.array(CompositionView),
      handler: async ({ actor, query }) => (await svc.list(actor, query.projectId)) as never,
    })
    route(ctx.api, {
      method: 'post',
      path: '/compositions',
      summary: 'Create an editing project',
      tags,
      access: 'compositions.edit',
      body: z.object({
        projectId: z.uuid().nullable().default(null),
        name: z.string().min(1).max(200),
        formats: z.array(FormatChoice).optional(),
        fps: z.number().min(1).max(120).optional(),
        duration: z.number().min(0.1).optional(),
        document: z.record(z.string(), z.unknown()).optional(),
      }),
      response: CompositionView,
      status: 201,
      handler: async ({ actor, body }) => (await svc.create(body, actor)) as never,
    })
    route(ctx.api, {
      method: 'get',
      path: '/compositions/{id}',
      summary: 'An editing project with its document',
      tags,
      access: 'compositions.read',
      params: IdParams,
      response: CompositionView,
      handler: async ({ actor, params }) => (await svc.get(params.id, actor)) as never,
    })
    route(ctx.api, {
      method: 'patch',
      path: '/compositions/{id}',
      summary: 'Rename an editing project',
      tags,
      access: 'compositions.edit',
      params: IdParams,
      body: z.object({ name: z.string().min(1).max(200) }),
      response: CompositionView,
      handler: async ({ actor, params, body }) => (await svc.rename(params.id, body.name, actor)) as never,
    })
    route(ctx.api, {
      method: 'delete',
      path: '/compositions/{id}',
      summary: 'Delete an editing project',
      tags,
      access: 'compositions.edit',
      params: IdParams,
      response: Ok,
      handler: async ({ actor, params }) => {
        await svc.remove(params.id, actor)
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/compositions/{id}/duplicate',
      summary: 'Duplicate an editing project',
      tags,
      access: 'compositions.edit',
      params: IdParams,
      response: CompositionView,
      handler: async ({ actor, params }) => (await svc.duplicate(params.id, actor)) as never,
    })
    route(ctx.api, {
      method: 'post',
      path: '/compositions/{id}/ops',
      summary: 'Apply edits (see the editor guide at /api/compositions/guide)',
      tags,
      access: 'compositions.edit',
      params: IdParams,
      body: z.object({
        ops: z.array(Op).min(1).max(500),
        baseRevision: z.number().int().optional(),
        clientId: z.string().optional(),
      }),
      response: z.object({ revision: z.number() }),
      handler: async ({ actor, params, body }) => {
        const r = await svc.apply(params.id, body.ops, actor, {
          clientId: body.clientId,
          baseRevision: body.baseRevision,
        })
        return { revision: r.revision }
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/compositions/{id}/ops',
      summary: 'Edits after a revision (to catch up after a reconnect)',
      tags,
      access: 'compositions.read',
      params: IdParams,
      query: z.object({ since: z.coerce.number().int().min(0) }),
      response: z.array(
        z.object({ revision: z.number(), ops: z.unknown(), clientId: z.string().nullable() }),
      ),
      handler: async ({ actor, params, query }) => {
        if (!(await svc.canView(params.id, actor))) throw notFound()
        return (await svc.opsSince(params.id, query.since)).map((o) => ({
          revision: o.revision,
          ops: o.ops,
          clientId: o.clientId,
        }))
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/compositions/{id}/assets',
      summary: 'Turn library media into assets (returns asset entries to add with add_asset)',
      description:
        'Each item may name one of its versions (`version`: its key or name; absent = the main version) and a format of that version (`formatKey`; absent = its main format).',
      tags,
      access: 'compositions.edit',
      params: IdParams,
      body: z.object({
        media: z
          .array(
            z.object({
              mediaId: z.uuid(),
              formatKey: z.string().optional(),
              version: z.string().max(120).optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
      response: z.array(z.record(z.string(), z.unknown())),
      handler: async ({ actor, body }) => Promise.all(body.media.map((m) => svc.assetFor(m, actor))),
    })
    route(ctx.api, {
      method: 'post',
      path: '/compositions/{id}/render',
      summary: 'Export to media (each format becomes a format of the output media item)',
      tags,
      access: 'compositions.render',
      params: IdParams,
      body: z.object({ formats: z.array(z.string()).default([]) }),
      response: z.object({ taskId: z.string().nullable() }),
      status: 202,
      handler: ({ actor, params, body }) => startRender(params.id, body.formats, actor),
    })
    route(ctx.api, {
      method: 'post',
      path: '/compositions/{id}/source-links',
      summary:
        'Link the exported item to the media the edit uses now, as on every export (for items exported before exports did this)',
      tags,
      access: 'compositions.render',
      params: IdParams,
      response: z.object({ mediaId: z.string().nullable(), sources: z.array(z.string()) }),
      handler: async ({ actor, params }) => {
        const c = await svc.get(params.id, actor)
        const mediaId = c.outputMediaId
        if (!mediaId || !(await ctx.services.media.canView(mediaId, actor)))
          return { mediaId: null, sources: [] }
        return { mediaId, sources: await relinkSources(mediaId, c.document) }
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/compositions/{id}/presence',
      summary: 'Who has the editor open and where their playhead is',
      tags,
      access: 'compositions.read',
      params: IdParams,
      response: z.array(z.unknown()),
      handler: ({ params }) => [...(views.get(params.id)?.values() ?? [])],
    })

    // A frame exactly as the export would draw it.
    ctx.api.get('/compositions/:id/frame.jpg', async (c) => {
      const actor = c.get('actor')
      const id = c.req.param('id')
      if (!actor || !(await svc.canView(id, actor))) throw new HttpError('forbidden')
      const r = await svc.row(id)
      const doc = Composition.parse(r.document)
      const t = Number(c.req.query('t') ?? 0)
      const [buf] = await renderer.stills(id, doc, formatOf(doc, c.req.query('format')), [t], actor)
      return new Response(new Uint8Array(buf!), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
      })
    })
    ctx.api.get('/compositions/:id/poster.jpg', async (c) => {
      const actor = c.get('actor')
      const id = c.req.param('id')
      if (!actor || !(await svc.canView(id, actor))) throw new HttpError('forbidden')
      const file = join(ctx.services.files.dir('derived'), 'compositions', `${id}.jpg`)
      try {
        return new Response(await readFile(file), {
          headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300' },
        })
      } catch {
        throw notFound()
      }
    })

    // A media item's main version changed: edits keep the files they chose, as posts do.
    ctx.events.on('media.mainVersionChanged', async ({ id, promoted, demoted }) => {
      await svc
        .keepVersions(id, promoted, demoted)
        .catch((err) => ctx.log.warn({ err, mediaId: id }, 'could not keep edits on their versions'))
    })

    // Posters: refreshed a little after edits stop.
    const posterTimers = new Map<string, ReturnType<typeof setTimeout>>()
    ctx.events.on('composition.changed', ({ id, revision }) => {
      clearTimeout(posterTimers.get(id))
      posterTimers.set(
        id,
        setTimeout(async () => {
          try {
            const r = await svc.row(id)
            const doc = Composition.parse(r.document)
            if (!doc.tracks.some((t) => t.clips.length)) return
            const [buf] = await renderer.stills(id, doc, doc.formats[0]!, [Math.min(doc.duration * 0.3, 3)], {
              kind: 'system',
              source: 'system',
            })
            const dir = join(ctx.services.files.dir('derived'), 'compositions')
            const fs = await import('node:fs/promises')
            await fs.mkdir(dir, { recursive: true })
            const sharp = (await import('sharp')).default
            await sharp(buf!)
              .resize(960, 960, { fit: 'inside' })
              .jpeg({ quality: 80 })
              .toFile(join(dir, `${id}.jpg`))
            await svc.setPosterRevision(id, revision)
            if (r.projectId) ctx.realtime.publish(`project:${r.projectId}`, 'composition.updated', { id })
          } catch (err) {
            ctx.log.debug({ err }, 'poster failed')
          }
        }, 8000),
      )
    })

    // ── headless render page data (token-authenticated) ─────────────────
    ctx.api.get('/render-sessions/:id', (c) => {
      const s = renderer.get(c.req.param('id'), c.req.query('token') ?? '')
      if (!s) throw notFound()
      return c.json({ id: s.id, document: s.doc, format: s.format, assets: s.assets })
    })
    ctx.api.get('/render-sessions/:id/frames/:clip/:n', async (c) => {
      const s = renderer.get(c.req.param('id'), c.req.query('token') ?? '')
      if (!s) throw notFound()
      const path = renderer.framePath(s, c.req.param('clip'), Number(c.req.param('n')))
      if (!path) return c.body(null, 404)
      return new Response(await readFile(path), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=600' },
      })
    })

    // ── MCP ─────────────────────────────────────────────────────────────
    ctx.mcp.resource({
      uri: 'greenlit://editor/guide',
      name: 'editor-guide',
      description: 'How editing projects, clips, keyframes, code layers and ops work',
      read: () => GUIDE,
    })
    ctx.mcp.instruct(
      'To make or edit a video: read editor_guide once, create or open an editing project (editor_create / editor_list), add library media with editor_add_media, change things with editor_apply (ops), look at the result with editor_frame / editor_frames (no render needed — open editors update live), then export with editor_render.',
    )
    ctx.mcp.tool({
      name: 'editor_guide',
      description:
        'The full reference for editing projects: document model, clip types, keyframes, transitions, code (HTML) layers for motion graphics, and every op. Read it before editing.',
      input: {},
      access: 'compositions.read',
      readOnly: true,
      handler: async () => GUIDE,
    })
    ctx.mcp.tool({
      name: 'editor_list',
      description: 'Editing projects (optionally of one project): id, name, formats, duration, revision.',
      input: { projectId: z.uuid().optional() },
      access: 'compositions.read',
      readOnly: true,
      handler: async ({ projectId }, { actor }) =>
        (await svc.list(actor, projectId)).map((c) => ({
          id: c.id,
          name: c.name,
          projectId: c.projectId,
          revision: c.revision,
          duration: c.document.duration,
          formats: c.document.formats.map((f) => f.id),
          editor: `/edit/${c.id}`,
        })),
    })
    ctx.mcp.tool({
      name: 'editor_create',
      description:
        'Create an editing project. formats: any of landscape (16:9), vertical (9:16), square, portrait (4:5), or custom {id,name,width,height}. The first is the design format.',
      input: {
        projectId: z.uuid().optional(),
        name: z.string(),
        formats: z.array(FormatChoice).optional(),
        fps: z.number().optional(),
        duration: z.number().optional(),
      },
      access: 'compositions.edit',
      handler: async (i, { actor }) => {
        const c = await svc.create(
          {
            projectId: i.projectId ?? null,
            name: i.name,
            formats: i.formats,
            fps: i.fps,
            duration: i.duration,
          },
          actor,
        )
        return { id: c.id, revision: c.revision, outline: describe(c.document), editor: `/edit/${c.id}` }
      },
    })
    ctx.mcp.tool({
      name: 'editor_get',
      description: 'Read an editing project: a readable outline, and the full JSON document when full=true.',
      input: { id: z.uuid(), full: z.boolean().optional() },
      access: 'compositions.read',
      readOnly: true,
      handler: async ({ id, full }, { actor }) => {
        const c = await svc.get(id, actor)
        return {
          id: c.id,
          name: c.name,
          revision: c.revision,
          outline: describe(c.document),
          ...(full ? { document: c.document } : {}),
        }
      },
    })
    ctx.mcp.tool({
      name: 'editor_apply',
      description:
        'Apply ops to an editing project (all or nothing). Open editors update instantly. See editor_guide for the op list. Returns the new revision and outline.',
      input: { id: z.uuid(), ops: z.array(Op).min(1).max(500) },
      access: 'compositions.edit',
      handler: async ({ id, ops }, { actor }) => {
        const r = await svc.apply(id, ops, actor)
        return { revision: r.revision, outline: describe(r.document) }
      },
    })
    ctx.mcp.tool({
      name: 'editor_add_media',
      description:
        "Add library media to an editing project: creates the asset and (unless asClip=false) a clip. `version` picks one of the item's versions (its key or name, as media_get lists them; absent = the main version) and `formatKey` a format of that version (absent = its main format). For video/audio, duration defaults to the source length from `in`; images default to 5 s. Visual clips go on a new top track unless trackId is given.",
      input: {
        id: z.uuid(),
        mediaId: z.uuid(),
        version: z
          .string()
          .max(120)
          .optional()
          .describe('A version of the item: its key or name (absent, "" or "main" = the main version)'),
        formatKey: z.string().optional(),
        asClip: z.boolean().optional(),
        trackId: z.string().optional(),
        start: z.number().min(0).optional(),
        in: z.number().min(0).optional(),
        duration: z.number().min(0.01).optional(),
        clip: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Extra clip fields (transform, fit, focusX...)'),
      },
      access: 'compositions.edit',
      handler: async (i, { actor }) => {
        const asset = await svc.assetFor(i, actor)
        const ops: Op[] = [{ op: 'add_asset', asset }]
        let clipId: string | null = null
        if (i.asClip !== false) {
          clipId = newId()
          const srcDur = asset.duration ? Math.max(0.1, asset.duration - (i.in ?? 0)) : 5
          ops.push({
            op: 'add_clip',
            trackId: i.trackId,
            clip: {
              id: clipId,
              type: asset.kind,
              assetId: asset.id,
              start: i.start ?? 0,
              in: i.in ?? 0,
              duration: i.duration ?? srcDur,
              name: asset.name,
              ...(i.clip ?? {}),
            },
          })
        }
        const r = await svc.apply(i.id, ops, actor)
        return { assetId: asset.id, clipId, revision: r.revision, outline: describe(r.document) }
      },
    })
    ctx.mcp.tool({
      name: 'editor_auto_reframe',
      description:
        'Make a video clip follow its subject in one format (typically "vertical" from 16:9 footage): samples the clip, finds the person/most important region and writes smoothed focusX (or focusY) keyframes. For the design format (the first) they go on the clip itself, which every format without its own also uses; for any other format, into clip.formats[formatId]. Check the result with editor_frames on that format; refine keyframes by hand with editor_apply if needed.',
      input: {
        id: z.uuid(),
        clipId: z.string(),
        formatId: z.string(),
        interval: z.number().min(0.2).max(5).optional(),
      },
      access: 'compositions.edit',
      handler: async ({ id, clipId, formatId, interval }, { actor }) => {
        const c = await svc.get(id, actor)
        const r = await autoReframe(ctx, c.document, clipId, formatId, { interval })
        const applied = await svc.apply(id, r.ops, actor)
        return { revision: applied.revision, samples: r.samples, keyframes: r.keyframes }
      },
    })
    ctx.mcp.tool({
      name: 'editor_frame',
      description:
        'See one frame of an editing project, drawn exactly as the export will look (no render needed). time in seconds; format id (default the first).',
      input: { id: z.uuid(), time: z.number().min(0), format: z.string().optional() },
      access: 'compositions.read',
      readOnly: true,
      handler: async ({ id, time, format }, { actor }) => {
        const c = await svc.get(id, actor)
        const f = formatOf(c.document, format)
        const [buf] = await renderer.stills(id, c.document, f, [time], actor)
        const sharp = (await import('sharp')).default
        const small = await sharp(buf!).resize(1280, 1280, { fit: 'inside' }).jpeg({ quality: 84 }).toBuffer()
        return new McpContent([
          {
            type: 'text',
            text: `${c.name} — ${f.id} ${f.width}×${f.height} at ${time}s (revision ${c.revision})`,
          },
          { type: 'image', data: small.toString('base64'), mimeType: 'image/jpeg' },
        ])
      },
    })
    ctx.mcp.tool({
      name: 'editor_frames',
      description:
        'See several moments at once as a contact sheet (e.g. times [0, 1.5, 3, 6]). Up to 12 frames.',
      input: {
        id: z.uuid(),
        times: z.array(z.number().min(0)).min(1).max(12),
        format: z.string().optional(),
      },
      access: 'compositions.read',
      readOnly: true,
      handler: async ({ id, times, format }, { actor }) => {
        const c = await svc.get(id, actor)
        const f = formatOf(c.document, format)
        const sheet = await renderer.contactSheet(id, c.document, f, times, actor)
        return new McpContent([
          { type: 'text', text: `${c.name} — ${f.id}, frames at ${times.join(', ')} s` },
          { type: 'image', data: sheet.toString('base64'), mimeType: 'image/jpeg' },
        ])
      },
    })
    ctx.mcp.tool({
      name: 'editor_state',
      description:
        "What the people with this editor open are looking at: playhead time, playing, selected clips, format. Use it to understand what the user means by 'this' or 'here'.",
      input: { id: z.uuid() },
      access: 'compositions.read',
      readOnly: true,
      handler: async ({ id }, { actor }) => {
        if (!(await svc.canView(id, actor))) throw notFound()
        const list = [...(views.get(id)?.values() ?? [])].filter((v) => Date.now() - v.at < 10 * 60_000)
        return list.length ? list : 'Nobody has this editor open right now.'
      },
    })
    ctx.mcp.tool({
      name: 'editor_control',
      description:
        "Drive the user's open editor: seek to a time, play, pause, select clips, or switch format — e.g. to show them what you changed.",
      input: {
        id: z.uuid(),
        action: z.enum(['seek', 'play', 'pause', 'select', 'format']),
        time: z.number().min(0).optional(),
        clipIds: z.array(z.string()).optional(),
        formatId: z.string().optional(),
      },
      access: 'compositions.edit',
      handler: async ({ id, ...cmd }, { actor }) => {
        if (!(await svc.canView(id, actor))) throw notFound()
        ctx.realtime.publish(`composition:${id}`, 'command', cmd)
        return { sent: true, editors: views.get(id)?.size ?? 0 }
      },
    })
    ctx.mcp.tool({
      name: 'editor_render',
      description:
        'Export an editing project. Each format (default: all) becomes a format of one media item in the same project, linked as "rendered to": the format with id main (or, without one, the first) as its main format, every other one under its own id. Returns a taskId; check it with task_status.',
      input: { id: z.uuid(), formats: z.array(z.string()).optional() },
      access: 'compositions.render',
      handler: ({ id, formats }, { actor }) => startRender(id, formats ?? [], actor),
    })
    void FORMAT_SIZES
  },
})
