import { existsSync, readdirSync } from 'node:fs'
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import {
  FormatKey,
  Media,
  MediaKind,
  MediaListQuery,
  MediaStatus,
  NewVersionInput,
  Paginated,
  RenameVersionPartInput,
  type StoredVersion,
  UpdateFormatInput,
  UpdateMediaInput,
  UpdateVersionInput,
  type VersionGroupDef,
  versionFormats,
} from '@greenlit/shared'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { type Actor, assertCan, can, isAdmin } from '../../core/actor.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import { IdParams, Ok, route } from '../../core/http.ts'
import { McpContent } from '../../core/mcp.ts'
import { defineModule } from '../../core/module.ts'
import { MIME } from '../../core/static.ts'
import { ffmpeg } from '../../lib/ffmpeg.ts'
import { blobs } from '../files/schema.ts'
import { projects } from '../projects/schema.ts'
import { processFormat } from './processing.ts'
import { media, mediaFiles, mediaFormats } from './schema.ts'
import { cleanTags, fold, MediaService } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    media: MediaService
  }
}

/** A version's key in URLs: `main` stands for the main version (''). */
const VersionKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
  .refine((k) => k !== 'main', 'The key "main" is reserved for the main version')
const VersionParams = IdParams.extend({ version: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/) })
const versionKeyOf = (v: string) => (v === 'main' ? '' : v)
const PartKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
const GroupParams = IdParams.extend({ group: PartKey })
const OptionParams = GroupParams.extend({ option: PartKey })

const UploadTarget = z.object({
  projectId: z.uuid().nullable().optional(),
  mediaId: z.uuid().optional(),
  formatKey: FormatKey.optional(),
  label: z.string().optional(),
  title: z.string().optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** Upload into this version of `mediaId`. */
  version: VersionKey.optional(),
  /** Upload as a new version of `mediaId` (another language, without the watermark...). */
  newVersion: NewVersionInput.optional(),
  /** Add the file to `mediaId` as an audio track (`formatKey` = the track's key). */
  audio: z.boolean().optional(),
  /** New items: the file's path inside a folder dropped as a whole ("01 Logos/white.svg"). */
  path: z.string().max(1000).optional(),
})

const BulkInput = z.object({
  ids: z.array(z.uuid()).min(1).max(1000),
  action: z.enum(['trash', 'restore', 'purge', 'move', 'tag', 'untag', 'status', 'hide', 'unhide']),
  projectId: z.uuid().nullable().optional(),
  tags: z.array(z.string()).optional(),
  status: MediaStatus.optional(),
  userIds: z.array(z.uuid()).optional(),
})

const FileVersion = z.object({
  id: z.string(),
  formatId: z.string(),
  blobId: z.string(),
  fileRevision: z.number(),
  filename: z.string(),
  size: z.number(),
  note: z.string().nullable(),
  createdBy: z
    .object({ id: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
  createdAt: z.string(),
  url: z.string(),
})

export default defineModule({
  id: 'media',
  name: 'Media library',
  description:
    'Media items with formats, file versions, processing (thumbnails, previews, waveforms) and search.',
  dependsOn: ['users', 'files', 'projects'],
  permissions: {
    'media.read': { description: 'See media (except what is hidden from you)', roles: ['reviewer'] },
    'media.upload': { description: 'Upload media and new versions', roles: [] },
    'media.edit': { description: 'Change titles, notes, tags, formats', roles: [] },
    'media.delete': { description: 'Move media to the trash and empty it', roles: [] },
    'media.status': { description: 'Change the review status of media', roles: [] },
    'media.import': { description: 'Import files from the server disk or a URL', roles: [] },
  },
  setup(ctx) {
    const svc = new MediaService(ctx)
    ctx.services.provide('media', svc)
    const files = ctx.services.files

    ctx.jobs.define<{ formatId: string }>('media.process', {
      concurrency: Math.max(1, Math.floor(ctx.config.workers)),
      retryLimit: 1,
      handler: ({ formatId }, job) => processFormat(ctx, formatId, job),
    })

    // ── versioning ───────────────────────────────────────────────────────
    ctx.versions.register('media', {
      labels: {
        title: 'title',
        description: 'notes',
        tags: 'tags',
        status: 'status',
        projectId: 'project',
        takenAt: 'date',
        hiddenFrom: 'visibility',
        formats: 'formats',
        versions: 'versions',
        versionGroups: 'versions',
        deletedAt: 'trash',
      },
      ignore: ['blobIds'],
      coalesceSeconds: 45,
      snapshot: async (id) => {
        const [m] = await ctx.db.select().from(media).where(eq(media.id, id))
        if (!m) return null
        const fs = await svc.formatsOf(id, { all: true })
        return {
          title: m.title,
          versions: m.versions,
          versionGroups: m.versionGroups,
          description: m.description,
          tags: m.tags,
          status: m.status,
          projectId: m.projectId,
          takenAt: m.takenAt?.toISOString() ?? null,
          hiddenFrom: m.hiddenFrom,
          deletedAt: m.deletedAt?.toISOString() ?? null,
          formats: fs.map((f) => ({
            id: f.id,
            key: f.key,
            label: f.label,
            role: f.role,
            version: f.version,
            isPrimary: f.isPrimary,
            position: f.position,
            blobId: f.blobId,
            fileRevision: f.fileRevision,
            filename: f.filename,
            mime: f.mime,
            size: f.size,
            kind: f.kind,
          })),
          blobIds: fs.map((f) => f.blobId),
        }
      },
      restore: async (id, d) => {
        const tags = cleanTags((d.tags as string[]) ?? [])
        await ctx.db
          .update(media)
          .set({
            title: d.title as string,
            description: d.description as string,
            tags,
            status: d.status as string,
            projectId: (d.projectId as string) ?? null,
            takenAt: d.takenAt ? new Date(d.takenAt as string) : null,
            hiddenFrom: (d.hiddenFrom as string[]) ?? [],
            versions: (d.versions as StoredVersion[]) ?? [],
            versionGroups: (d.versionGroups as VersionGroupDef[]) ?? [],
            deletedAt: d.deletedAt ? new Date(d.deletedAt as string) : null,
            searchText: fold([d.title as string, d.description as string, ...tags].join(' \u2022 ')),
            updatedAt: new Date(),
          })
          .where(eq(media.id, id))
        type Snap = {
          id: string
          key: string
          label: string
          role?: string
          version?: string
          isPrimary: boolean
          position: number
          blobId: string
          fileRevision: number
          filename: string
          mime: string
          size: number
          kind: string
        }
        const snap = (d.formats as Snap[]) ?? []
        const current = await svc.formatsOf(id, { all: true })
        for (const f of current)
          if (!snap.some((s) => s.id === f.id))
            await ctx.db.delete(mediaFormats).where(eq(mediaFormats.id, f.id))
        for (const s of snap) {
          const derivedDir = files.derivedDir(s.blobId)
          const derived = existsSync(derivedDir) ? readdirSync(derivedDir) : []
          const existing = current.find((f) => f.id === s.id)
          const values = {
            key: s.key,
            label: s.label,
            role: s.role ?? 'format',
            version: s.version ?? '',
            isPrimary: s.isPrimary,
            position: s.position,
            blobId: s.blobId,
            filename: s.filename,
            mime: s.mime,
            size: s.size,
            kind: s.kind,
            derived,
            updatedAt: new Date(),
          }
          if (existing) {
            const changedFile = existing.blobId !== s.blobId
            await ctx.db
              .update(mediaFormats)
              .set({ ...values, ...(changedFile ? { fileRevision: existing.fileRevision + 1 } : {}) })
              .where(eq(mediaFormats.id, s.id))
            if (changedFile) {
              await ctx.db.insert(mediaFiles).values({
                mediaId: id,
                formatId: s.id,
                blobId: s.blobId,
                fileRevision: existing.fileRevision + 1,
                filename: s.filename,
                size: s.size,
                note: `Restored file version ${s.fileRevision}`,
              })
              await svc.enqueueProcessing(id, s.id)
            }
          } else {
            await ctx.db.insert(mediaFormats).values({
              id: s.id,
              mediaId: id,
              fileRevision: s.fileRevision,
              processingState: 'pending',
              ...values,
            })
            await svc.enqueueProcessing(id, s.id)
          }
        }
      },
    })

    // ── directory, access, realtime ─────────────────────────────────────
    ctx.entities.register('media', {
      canView: (id, actor) => svc.canView(id, actor),
      summarize: async (ids, actor) =>
        (await svc.many(ids, actor)).map((m) => ({
          type: 'media',
          id: m.id,
          title: m.title || 'Untitled',
          thumbnailUrl: m.thumbnailUrl,
          kind: m.kind,
          href: `/media/${m.id}`,
          projectId: m.projectId,
        })),
    })
    ctx.hooks.add('files.access', async ({ blobId, actor }) => {
      const mediaId = await svc.mediaIdForBlob(blobId)
      if (!mediaId) return undefined
      return svc.canView(mediaId, actor)
    })
    ctx.realtime.guard('media', (actor, topic) => svc.canView(topic.split(':')[1]!, actor))
    ctx.realtime.guard('library', (actor) => can(actor, 'media.read'))

    ctx.hooks.add('projects.decorate', async ({ ids, actor }) => {
      const visible = await svc.visibleWhere(actor)
      const rows = await ctx.db
        .select({
          projectId: media.projectId,
          count: sql<number>`count(distinct ${media.id})::int`,
          size: sql<number>`coalesce(sum(${mediaFormats.size}),0)::float8`,
        })
        .from(media)
        .leftJoin(mediaFormats, eq(mediaFormats.mediaId, media.id))
        .where(and(inArray(media.projectId, ids), visible))
        .groupBy(media.projectId)
      const covers = await ctx.db.execute<{ project_id: string; blob_id: string; rev: number }>(sql`
        select distinct on (p.id) p.id as project_id, f.blob_id, f.file_revision as rev
        from ${projects} p
        join ${media} m on m.project_id = p.id and m.deleted_at is null
        join ${mediaFormats} f on f.media_id = m.id and f.is_primary and 'thumb.webp' = any(f.derived)
        where p.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        order by p.id, (m.id = p.cover_media_id) desc, m.created_at desc`)
      const out: Record<string, { mediaCount: number; sizeBytes: number; coverUrl: string | null }> = {}
      for (const id of ids) out[id] = { mediaCount: 0, sizeBytes: 0, coverUrl: null }
      for (const r of rows)
        if (r.projectId) Object.assign(out[r.projectId]!, { mediaCount: r.count, sizeBytes: r.size })
      for (const c of covers) out[c.project_id]!.coverUrl = `/api/files/${c.blob_id}/d/thumb.webp?v=${c.rev}`
      return out
    })

    // ── uploads ─────────────────────────────────────────────────────────
    files.purpose('media.upload', {
      access: 'media.upload',
      handle: async (blob, rawTarget, actor) => {
        const target = UploadTarget.parse(rawTarget)
        if (target.mediaId) {
          const formatId = await svc.attachFile(
            target.mediaId,
            blob,
            {
              formatKey: target.formatKey ?? 'main',
              label: target.label,
              note: target.note,
              version: target.version,
              newVersion: target.newVersion,
              audio: target.audio,
            },
            actor,
          )
          const { version } = await svc.formatRow(formatId)
          return { mediaId: target.mediaId, formatId, version }
        }
        const mediaId = await svc.createFromBlob(
          blob,
          {
            projectId: target.projectId ?? null,
            title: target.title,
            formatKey: target.formatKey,
            tags: target.tags,
            path: target.path,
          },
          actor,
        )
        return { mediaId }
      },
    })

    // ── API ─────────────────────────────────────────────────────────────
    const tags = ['Media']
    route(ctx.api, {
      method: 'get',
      path: '/media',
      summary: 'Search and list media',
      description:
        'The `q` parameter understands words, "exact phrases", #tags, kind:video, status:approved, project:"name" and -excluded words.',
      tags,
      access: 'media.read',
      query: MediaListQuery,
      response: Paginated(Media),
      handler: ({ actor, query }) => {
        if (query.trash) assertCan(actor, 'media.delete')
        return svc.list(actor, query)
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/media/{id}',
      summary: 'One media item with all its formats',
      tags,
      access: 'media.read',
      params: IdParams,
      response: Media,
      handler: ({ actor, params }) => svc.get(params.id, actor),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/media/{id}',
      summary: 'Change title, notes, tags, status, project or visibility (creates a version)',
      tags,
      access: 'media.read',
      params: IdParams,
      body: UpdateMediaInput,
      response: Media,
      handler: ({ actor, params, body }) => {
        const { status, ...rest } = body
        if (Object.values(rest).some((v) => v !== undefined)) assertCan(actor, 'media.edit')
        if (status !== undefined) assertCan(actor, 'media.status')
        return svc.update(params.id, body, actor)
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/media/bulk',
      summary: 'Do something with many media items at once',
      tags,
      access: 'media.read',
      body: BulkInput,
      response: z.object({ ok: z.literal(true), count: z.number() }),
      handler: async ({ actor, body }) => {
        const { ids } = body
        switch (body.action) {
          case 'trash':
            assertCan(actor, 'media.delete')
            await svc.trash(ids, actor)
            break
          case 'restore':
            assertCan(actor, 'media.delete')
            await svc.untrash(ids, actor)
            break
          case 'purge':
            assertCan(actor, 'media.delete')
            await svc.purge(ids)
            break
          case 'move':
            assertCan(actor, 'media.edit')
            for (const id of ids) await svc.update(id, { projectId: body.projectId ?? null }, actor)
            break
          case 'tag':
          case 'untag': {
            assertCan(actor, 'media.edit')
            const change = cleanTags(body.tags ?? [])
            const keys = new Set(change.map((t) => t.toLowerCase()))
            for (const m of await svc.many(ids, actor)) {
              const next =
                body.action === 'tag'
                  ? [...m.tags, ...change]
                  : m.tags.filter((t) => !keys.has(t.toLowerCase()))
              await svc.update(m.id, { tags: next }, actor)
            }
            break
          }
          case 'status':
            assertCan(actor, 'media.status')
            if (!body.status) throw badRequest('status missing')
            for (const id of ids) await svc.setStatus(id, body.status, actor)
            break
          case 'hide':
          case 'unhide': {
            if (!isAdmin(actor)) throw badRequest('Only admins change visibility')
            const users = new Set(body.userIds ?? [])
            for (const m of await svc.many(ids, actor)) {
              const cur = new Set(m.hiddenFrom ?? [])
              for (const u of users) body.action === 'hide' ? cur.add(u) : cur.delete(u)
              await svc.update(m.id, { hiddenFrom: [...cur] }, actor)
            }
            break
          }
        }
        return { ok: true as const, count: ids.length }
      },
    })
    route(ctx.api, {
      method: 'patch',
      path: '/media/{id}/formats/{formatId}',
      summary: 'Rename a format or make it the main one',
      tags,
      access: 'media.edit',
      params: IdParams.extend({ formatId: z.uuid() }),
      body: UpdateFormatInput,
      response: Media,
      handler: async ({ actor, params, body }) => {
        await svc.updateFormat(params.formatId, body, actor)
        return svc.get(params.id, actor)
      },
    })
    route(ctx.api, {
      method: 'delete',
      path: '/media/{id}/formats/{formatId}',
      summary: 'Remove a format (its files stay in the version history)',
      tags,
      access: 'media.edit',
      params: IdParams.extend({ formatId: z.uuid() }),
      response: Media,
      handler: async ({ actor, params }) => {
        await svc.removeFormat(params.formatId, actor)
        return svc.get(params.id, actor)
      },
    })
    route(ctx.api, {
      method: 'patch',
      path: '/media/{id}/versions/{version}',
      summary:
        'Make a version the main one, or rename it while versions differ in one way only (`main` = the main version)',
      tags,
      access: 'media.edit',
      params: VersionParams,
      body: UpdateVersionInput,
      response: Media,
      handler: ({ actor, params, body }) =>
        svc.updateVersion(params.id, versionKeyOf(params.version), body, actor),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/media/{id}/versions/{version}',
      summary: 'Remove a version and its formats (not the main one)',
      tags,
      access: 'media.edit',
      params: VersionParams,
      response: Media,
      handler: async ({ actor, params }) => {
        await svc.removeVersion(params.id, versionKeyOf(params.version), actor)
        return svc.get(params.id, actor)
      },
    })
    route(ctx.api, {
      method: 'patch',
      path: '/media/{id}/version-groups/{group}',
      summary: 'Rename what tells versions apart ("Language", "Watermark")',
      tags,
      access: 'media.edit',
      params: GroupParams,
      body: RenameVersionPartInput,
      response: Media,
      handler: ({ actor, params, body }) =>
        svc.renameVersionGroup(params.id, params.group, body.label, actor),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/media/{id}/version-groups/{group}/options/{option}',
      summary: 'Rename an option of a version group: every version with it changes name',
      tags,
      access: 'media.edit',
      params: OptionParams,
      body: RenameVersionPartInput,
      response: Media,
      handler: ({ actor, params, body }) =>
        svc.renameVersionOption(params.id, params.group, params.option, body.label, actor),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/media/{id}/version-groups/{group}/options/{option}',
      summary: 'Remove an option of a version group with every version that has it (not the main one)',
      tags,
      access: 'media.edit',
      params: OptionParams,
      response: Media,
      handler: ({ actor, params }) => svc.removeVersionOption(params.id, params.group, params.option, actor),
    })
    route(ctx.api, {
      method: 'get',
      path: '/media/{id}/files',
      summary: 'Every file version of every format',
      tags,
      access: 'media.read',
      params: IdParams,
      response: z.array(FileVersion),
      handler: async ({ actor, params }) => {
        if (!(await svc.canView(params.id, actor))) throw notFound()
        return svc.fileHistory(params.id)
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/media/files/{id}/restore',
      summary: 'Make an older file the current file of its format again',
      tags,
      access: 'media.upload',
      params: IdParams,
      response: Ok,
      handler: async ({ actor, params }) => {
        await svc.restoreFile(params.id, actor)
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/media/{id}/reprocess',
      summary: 'Make thumbnails and previews again',
      tags,
      access: 'media.upload',
      params: IdParams,
      response: Ok,
      handler: async ({ params }) => {
        await svc.enqueueProcessing(params.id)
        return { ok: true as const }
      },
    })

    const ImportInput = z.object({
      path: z.string().optional().describe('Absolute path of a file on the Greenlit server'),
      url: z.url().optional().describe('http(s) URL to download'),
      projectId: z.uuid().nullable().optional(),
      mediaId: z.uuid().optional().describe('Add as a format / new file version of this media item'),
      formatKey: FormatKey.optional(),
      title: z.string().optional(),
      tags: z.array(z.string()).optional(),
      note: z.string().optional(),
    })
    const importFile = async (input: z.infer<typeof ImportInput>, actor: Actor) => {
      if (!input.path && !input.url) throw badRequest('Give a path or a url')
      const tmp = await files.tmpPath()
      let filename: string
      let mime: string
      if (input.path) {
        const abs = resolve(input.path)
        const st = await stat(abs).catch(() => null)
        if (!st?.isFile()) throw badRequest(`No file at ${abs}`)
        await copyFile(abs, tmp)
        filename = basename(abs)
        mime = MIME[extname(abs).toLowerCase()]?.split(';')[0] ?? guessMime(abs)
      } else {
        const res = await fetch(input.url!)
        if (!res.ok || !res.body) throw badRequest(`Download failed (${res.status})`)
        await writeFile(tmp, Buffer.from(await res.arrayBuffer()))
        filename = decodeURIComponent(new URL(input.url!).pathname.split('/').pop() || 'download')
        mime = res.headers.get('content-type')?.split(';')[0] ?? guessMime(filename)
      }
      const blob = await files.ingest(tmp, {
        filename,
        mime,
        createdBy: actor.kind === 'user' ? actor.user.id : null,
      })
      if (input.mediaId) {
        const formatId = await svc.attachFile(
          input.mediaId,
          blob,
          { formatKey: input.formatKey ?? 'main', note: input.note },
          actor,
        )
        return { mediaId: input.mediaId, formatId }
      }
      return {
        mediaId: await svc.createFromBlob(
          blob,
          {
            projectId: input.projectId ?? null,
            title: input.title,
            formatKey: input.formatKey,
            tags: input.tags,
          },
          actor,
        ),
      }
    }
    route(ctx.api, {
      method: 'post',
      path: '/media/import',
      summary: 'Import a file from the server disk or from a URL',
      tags,
      access: 'media.import',
      body: ImportInput,
      response: z.object({ mediaId: z.string(), formatId: z.string().optional() }),
      status: 201,
      handler: ({ actor, body }) => importFile(body, actor),
    })

    // ── MCP ─────────────────────────────────────────────────────────────
    const compact = (m: Media) => ({
      id: m.id,
      title: m.title,
      kind: m.kind,
      status: m.status,
      projectId: m.projectId,
      tags: m.tags,
      formats: m.formats.map((f) => ({
        id: f.id,
        key: f.key,
        width: f.width,
        height: f.height,
        duration: f.duration,
        ready: f.processing.state === 'ready',
      })),
      ...(m.versions.length
        ? {
            versionGroups: m.versionGroups.map((g) => ({
              label: g.label || 'Version',
              options: g.options.map((o) => o.label),
            })),
            versions: m.versions.map((v) => ({ key: v.key || 'main', label: v.label })),
          }
        : {}),
      ...(m.audioTracks.length
        ? { audioTracks: m.audioTracks.map((a) => ({ key: a.key, label: a.label, duration: a.duration })) }
        : {}),
      openComments: m.openCommentCount,
      createdAt: m.createdAt,
    })
    ctx.mcp.instruct(
      'Greenlit is a media library, review and publishing platform with a video editor. Media items have formats (main 16:9, vertical 9:16, square...) of the same content, can have versions that combine (the same video with Italian or English text, with or without the watermark: each version is one combination and has its own formats) and extra audio tracks (a voice-over in another language...) that a post can use in place of the sound of the video. Use media_search to find things, media_view to look at a picture or a video frame, and the editor_* tools to make videos and motion graphics that preview live without rendering.',
    )
    ctx.mcp.tool({
      name: 'media_search',
      description:
        'Search the library. q understands words, "phrases", #tag, kind:video|image|audio|document|design, status:draft|in_review|changes_requested|approved, project:"name", place:"name", -exclude.',
      input: {
        q: z.string().optional(),
        projectId: z.uuid().optional(),
        kind: MediaKind.optional(),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      },
      access: 'media.read',
      readOnly: true,
      handler: async (i, { actor }) => {
        const r = await svc.list(actor, MediaListQuery.parse({ ...i, limit: i.limit ?? 30 }))
        return { total: r.total, nextCursor: r.nextCursor, items: r.items.map(compact) }
      },
    })
    ctx.mcp.tool({
      name: 'media_get',
      description:
        'Everything about one media item: notes, tags, formats with sizes and URLs, places, counts.',
      input: { id: z.uuid() },
      access: 'media.read',
      readOnly: true,
      handler: ({ id }, { actor }) => svc.get(id, actor),
    })
    ctx.mcp.tool({
      name: 'media_view',
      description:
        'Look at a media item: returns the picture, or the video frame at `time` seconds (default: the poster), as an image you can see. Use it to check what is in a file before using it.',
      input: {
        id: z.uuid(),
        time: z.number().min(0).optional(),
        format: FormatKey.optional(),
        version: z.string().optional().describe('A version key from media_get (default: the main version)'),
        width: z.number().int().min(160).max(1920).optional(),
      },
      access: 'media.read',
      readOnly: true,
      handler: async ({ id, time, format, version, width }, { actor }) => {
        const m = await svc.get(id, actor)
        const fs = versionFormats(m, version === 'main' ? '' : version)
        const f = fs.find((x) => x.key === format) ?? fs.find((x) => x.isPrimary) ?? fs[0]
        if (!f) throw notFound('No file')
        const blob = await files.get((await svc.formatRow(f.id)).blobId)
        let image: Buffer
        if (f.kind === 'video' && time !== undefined) {
          const out = await files.tmpPath('.jpg')
          await ffmpeg([
            '-ss',
            String(time),
            '-i',
            await files.readablePath(blob),
            '-frames:v',
            '1',
            '-q:v',
            '3',
            out,
          ])
          image = await readFile(out)
        } else if (files.hasDerived(blob.id, 'poster.webp'))
          image = await readFile(files.derivedPath(blob.id, 'poster.webp'))
        else if (f.kind === 'image') image = await readFile(await files.readablePath(blob))
        else return `${m.title}: ${f.kind} without a picture`
        const jpg = await sharp(image)
          .resize(width ?? 1024, width ?? 1024, { fit: 'inside' })
          .jpeg({ quality: 82 })
          .toBuffer()
        return new McpContent([
          {
            type: 'text',
            text: `${m.title} — ${f.key} ${f.width}×${f.height}${f.duration ? `, ${f.duration.toFixed(2)} s` : ''}${time !== undefined ? ` @ ${time}s` : ''}`,
          },
          { type: 'image', data: jpg.toString('base64'), mimeType: 'image/jpeg' },
        ])
      },
    })
    ctx.mcp.tool({
      name: 'media_update',
      description:
        'Change a media item: title, description (notes), tags (replaces the list), status, projectId. Every change is versioned.',
      input: {
        id: z.uuid(),
        title: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: MediaStatus.optional(),
        projectId: z.uuid().nullable().optional(),
        versionName: z.string().optional(),
      },
      access: 'media.edit',
      handler: async ({ id, ...patch }, { actor }) => compact(await svc.update(id, patch, actor)),
    })
    ctx.mcp.tool({
      name: 'media_import',
      description:
        'Add a file to the library from a path on the Greenlit machine or from a URL. With mediaId it becomes a new format (formatKey e.g. "vertical", "square") or a new file version of that media item.',
      input: ImportInput.shape,
      access: 'media.import',
      handler: async (input, { actor }) => importFile(input, actor),
    })
    ctx.mcp.tool({
      name: 'media_trash',
      description: 'Move media items to the trash (they can be restored).',
      input: { ids: z.array(z.uuid()).min(1) },
      access: 'media.delete',
      destructive: true,
      handler: async ({ ids }, { actor }) => {
        await svc.trash(ids, actor)
        return { trashed: ids.length }
      },
    })

    // Keep formats truthful when archival changes the file on disk (AV1/FLAC restores) or drops previews.
    ctx.events.on(
      'storage.restored' as never,
      (async (e: { blobId: string; exact: boolean; mime: string; size: number; filename: string }) => {
        if (e.exact) return
        await ctx.db
          .update(mediaFormats)
          .set({ mime: e.mime, size: e.size, filename: e.filename, updatedAt: new Date() })
          .where(eq(mediaFormats.blobId, e.blobId))
      }) as never,
    )
    ctx.events.on(
      'storage.archived' as never,
      (async (e: { blobId: string; removedDerived: string[] }) => {
        if (!e.removedDerived?.length) return
        const rows = await ctx.db.select().from(mediaFormats).where(eq(mediaFormats.blobId, e.blobId))
        for (const r of rows)
          await ctx.db
            .update(mediaFormats)
            .set({ derived: r.derived.filter((d) => !e.removedDerived.includes(d)) })
            .where(eq(mediaFormats.id, r.id))
      }) as never,
    )

    // Media without a project but trashed > 30 days ago are purged automatically.
    ctx.jobs.define('media.purgeTrash', {
      handler: async () => {
        const old = await ctx.db
          .select({ id: media.id })
          .from(media)
          .where(sql`${media.deletedAt} < now() - interval '30 days'`)
        if (old.length) await svc.purge(old.map((r) => r.id))
        return { purged: old.length }
      },
    })
    ctx.onStart(() =>
      ctx.jobs.schedule('media.purgeTrash', '15 4 * * *', {}, ctx.services.platform?.timeZone() ?? 'UTC'),
    )

    // Re-queue formats that never finished processing (e.g. after a crash).
    ctx.onStart(async () => {
      const stuck = await ctx.db
        .select({ id: mediaFormats.id, mediaId: mediaFormats.mediaId })
        .from(mediaFormats)
        .innerJoin(blobs, eq(blobs.id, mediaFormats.blobId))
        .innerJoin(media, eq(media.id, mediaFormats.mediaId))
        .where(and(inArray(mediaFormats.processingState, ['pending', 'processing']), isNull(media.deletedAt)))
      for (const s of stuck) await svc.enqueueProcessing(s.mediaId, s.id)
    })
  },
})

function guessMime(name: string): string {
  const ext = extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mxf': 'application/mxf',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.dng': 'image/x-adobe-dng',
    '.psd': 'image/vnd.adobe.photoshop',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
  }
  return map[ext] ?? 'application/octet-stream'
}
