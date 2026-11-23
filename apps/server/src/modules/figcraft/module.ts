import { accessSync, constants, existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import {
  DesignFont,
  DesignInfo,
  FIGCRAFT_MIME,
  FigcraftStatus,
  type Media,
  type MediaFormat,
} from '@greenlit/shared'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Actor, can } from '../../core/actor.ts'
import { badRequest, HttpError, notFound } from '../../core/errors.ts'
import { type Ctx, IdParams, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { mediaFormats } from '../media/schema.ts'
import {
  cleanRenderTmp,
  exportDir,
  exportNodes,
  NotADesign,
  processDesign,
  type Renderer,
  soleFrame,
} from './design.ts'
import { extOf, FONT_EXTENSIONS, readFontNames, type StoredFont, syncFontDir } from './fonts.ts'
import { FIGCRAFT_WEB, FigcraftWebApp } from './webapp.ts'

const StoredFontSchema = z.object({
  id: z.string(),
  blobId: z.string(),
  family: z.string(),
  style: z.string(),
  filename: z.string(),
  size: z.number(),
  createdAt: z.string(),
})

const ExportInput = z.object({
  /** Which design file (default: the item's main one). */
  formatId: z.uuid().optional(),
  /** Layer ids of top-level frames; default every frame of the first page. */
  frames: z.array(z.number().int()).max(200).optional(),
  format: z.enum(['png', 'jpg', 'webp', 'pdf']).default('png'),
  scale: z.number().min(0.25).max(4).default(1),
})

const EXPORT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
} as const

export default defineModule({
  id: 'figcraft',
  name: 'FigCraft designs',
  description:
    'FigCraft design documents (.figcraft) in the library: thumbnails, pages and frames, the fonts they use, the ' +
    'FigCraft browser build that shows and edits them in the viewer, and frame exports to pictures.',
  dependsOn: ['files', 'media'],
  permissions: {
    'designs.fonts': { description: 'Add and remove the fonts design documents use', roles: [] },
  },
  setup(ctx) {
    const files = ctx.services.files
    const media = ctx.services.media
    // figcraft-cli's home: XDG_DATA_HOME, so it finds Greenlit's fonts in fonts/ and nothing of the computer's.
    const home = join(ctx.config.dataDir, 'figcraft')
    const fontDir = join(home, 'fonts')
    const web = new FigcraftWebApp(
      ctx.config.figcraftWebDir ?? join(ctx.config.dataDir, 'vendor', `figcraft-web-${FIGCRAFT_WEB.version}`),
    )
    const cli = findCli(ctx.config.figcraftCli)
    const renderer: Renderer | null = cli ? { cli, xdgDataHome: home } : null
    const fonts = ctx.settings.define('figcraft.fonts', {
      schema: z.array(StoredFontSchema),
      default: () => [],
    })

    const fontView = (f: StoredFont): DesignFont => ({
      id: f.id,
      family: f.family,
      style: f.style,
      filename: f.filename,
      size: f.size,
      url: `/api/files/${f.blobId}`,
      createdAt: f.createdAt,
    })
    const syncFonts = () =>
      syncFontDir(fontDir, fonts.get(), (blobId) => join(ctx.config.dataDir, blobPath(blobId))).catch((err) =>
        ctx.log.warn({ err: (err as Error).message }, 'could not update the design fonts folder'),
      )
    // Blob paths are blobs/<first two>/<id> (files service); the font folder links to them.
    const blobPath = (id: string) => join('blobs', id.slice(0, 2), id)

    // ── processing ──────────────────────────────────────────────────────
    ctx.hooks.add('media.processFile', async ({ src, out, mime, signal }) => {
      if (mime !== FIGCRAFT_MIME) return undefined
      try {
        const { info, derived } = await processDesign(src, out, renderer, signal)
        const sole = soleFrame(info)
        return {
          kind: 'design',
          width: sole ? Math.round(sole.width) : null,
          height: sole ? Math.round(sole.height) : null,
          derived,
          meta: {
            design: 'figcraft',
            pages: info.pages.length,
            frames: info.pages.reduce((n, p) => n + p.frames.length, 0),
            fonts: info.fonts,
          },
        }
      } catch (err) {
        if (err instanceof NotADesign) throw new Error(err.message)
        throw err
      }
    })

    /** The DesignInfo processing wrote for a format, or null while it hasn't run. */
    const infoOf = async (f: Pick<MediaFormat, 'urls'> | { blobId: string }) => {
      const blobId = 'blobId' in f ? f.blobId : f.urls.original.split('/').pop()!
      const raw = await readFile(files.derivedPath(blobId, 'design.json'), 'utf8').catch(() => null)
      const parsed = raw ? DesignInfo.safeParse(JSON.parse(raw)) : null
      return parsed?.success ? parsed.data : null
    }
    const designFormat = (m: Media, formatId?: string) => {
      const all = [...m.formats, ...m.versions.flatMap((v) => v.formats)]
      const f = formatId
        ? all.find((x) => x.id === formatId)
        : (m.formats.find((x) => x.isPrimary) ?? m.formats[0])
      if (!f) throw notFound('No such file on this item')
      if (f.mime !== FIGCRAFT_MIME) throw badRequest('This file is not a FigCraft design')
      return f
    }

    // ── fonts ───────────────────────────────────────────────────────────
    ctx.hooks.add('files.access', ({ blobId, actor }) =>
      fonts.get().some((f) => f.blobId === blobId) ? can(actor, 'media.read') : undefined,
    )
    files.purpose('figcraft.font', {
      access: 'designs.fonts',
      maxBytes: 64 * 1024 * 1024,
      usage: 'font',
      handle: async (blob, _target, actor) => {
        const names = await readFontNames(files.absPath(blob)).catch(() => null)
        if (!names) {
          await files.remove(blob.id).catch(() => {})
          throw badRequest(`${blob.filename} is not a font FigCraft can read (${FONT_EXTENSIONS.join(', ')})`)
        }
        const font: StoredFont = {
          id: crypto.randomUUID(),
          blobId: blob.id,
          family: names.family,
          style: names.style,
          filename: blob.filename.endsWith(extOf(blob.filename)) ? blob.filename : `${blob.filename}.ttf`,
          size: blob.size,
          createdAt: new Date().toISOString(),
        }
        // The same face again replaces the one kept before.
        const same = (f: StoredFont) =>
          f.family.toLowerCase() === font.family.toLowerCase() &&
          f.style.toLowerCase() === font.style.toLowerCase()
        const before = fonts.get()
        await fonts.set(
          [...before.filter((f) => !same(f)), font],
          actor.kind === 'user' ? actor.user.id : null,
        )
        await syncFonts()
        ctx.realtime.publish('library', 'figcraft.fonts', {})
        await rerenderUsing([font.family])
        return fontView(font)
      },
    })

    /** Designs whose text uses these families get new thumbnails (only figcraft-cli renders text). */
    const rerenderUsing = async (families: string[]) => {
      if (!renderer || !families.length) return
      const rows = await ctx.db
        .select({ id: mediaFormats.id, mediaId: mediaFormats.mediaId })
        .from(mediaFormats)
        .where(
          and(
            eq(mediaFormats.mime, FIGCRAFT_MIME),
            sql`exists (select 1 from jsonb_array_elements_text(${mediaFormats.meta}->'fonts') f where lower(f) in (${sql.join(
              families.map((f) => sql`${f.toLowerCase()}`),
              sql`, `,
            )}))`,
          ),
        )
      for (const r of rows) await media.enqueueProcessing(r.mediaId, r.id)
    }

    const tags = ['Designs']
    route(ctx.api, {
      method: 'get',
      path: '/figcraft/status',
      summary: 'Is the FigCraft browser build installed, and where it is served',
      tags,
      access: 'signed-in',
      response: FigcraftStatus,
      handler: () => ({
        version: FIGCRAFT_WEB.version,
        state: web.state,
        appUrl: web.state === 'ready' ? `/api/figcraft/app/${FIGCRAFT_WEB.version}/` : null,
        error: web.error,
        renderer: !!renderer,
      }),
    })
    route(ctx.api, {
      method: 'get',
      path: '/figcraft/fonts',
      summary: 'The fonts Greenlit keeps for design documents',
      tags,
      access: 'media.read',
      response: z.array(DesignFont),
      handler: () =>
        fonts
          .get()
          .map(fontView)
          .sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style)),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/figcraft/fonts/{id}',
      summary: 'Remove a font',
      tags,
      access: 'designs.fonts',
      params: z.object({ id: z.string() }),
      handler: async ({ params, actor }) => {
        const all = fonts.get()
        const gone = all.find((f) => f.id === params.id)
        if (!gone) throw notFound('Font not found')
        await fonts.set(
          all.filter((f) => f.id !== params.id),
          actor.kind === 'user' ? actor.user.id : null,
        )
        await syncFonts()
        await files.remove(gone.blobId).catch(() => {})
        ctx.realtime.publish('library', 'figcraft.fonts', {})
        await rerenderUsing([gone.family])
        return { ok: true }
      },
    })

    route(ctx.api, {
      method: 'get',
      path: '/media/{id}/design',
      summary: 'What a design document holds: pages, their frames, the fonts its text uses',
      tags,
      access: 'media.read',
      params: IdParams,
      query: z.object({ formatId: z.uuid().optional() }),
      response: DesignInfo.nullable(),
      handler: async ({ params, query, actor }) =>
        infoOf(designFormat(await media.get(params.id, actor), query.formatId)),
    })

    // ── exporting frames as pictures ─────────────────────────────────────
    const exportFrames = async (mediaId: string, input: z.infer<typeof ExportInput>, actor: Actor) => {
      if (!renderer) throw new HttpError('unavailable', 'figcraft-cli is not installed on the server')
      const m = await media.get(mediaId, actor)
      const f = designFormat(m, input.formatId)
      const info = await infoOf(f)
      if (!info) throw badRequest('The design is still being read; try again in a moment')
      const all = info.pages.flatMap((p) => p.frames.map((fr) => ({ ...fr, page: p.name })))
      const wanted = input.frames?.length
        ? all.filter((fr) => input.frames!.includes(fr.id))
        : info.pages[0]
          ? all.filter((fr) => fr.page === info.pages[0]!.name)
          : []
      if (!wanted.length) throw badRequest('No such frames in the design')
      const blob = await files.get(f.urls.original.split('/').pop()!)
      const src = await files.readablePath(blob)
      const made = await exportNodes(
        renderer,
        src,
        wanted,
        { format: input.format, scale: input.scale },
        AbortSignal.timeout(10 * 60_000),
      )
      const ids: string[] = []
      try {
        for (const out of made) {
          const name = `${out.name || `Frame ${out.id}`}.${input.format}`.replace(/[/\\]/g, '-')
          const b = await files.ingest(out.file, {
            filename: name,
            mime: EXPORT_MIME[input.format],
            createdBy: actor.kind === 'user' ? actor.user.id : null,
          })
          const id = await media.createFromBlob(
            b,
            { projectId: m.projectId, title: out.name || m.title, origin: 'render', tags: m.tags },
            actor,
          )
          ids.push(id)
          await ctx.services.links
            ?.link({ type: 'media', id: m.id }, 'rendered_to', { type: 'media', id }, { auto: true, actor })
            .catch(() => {})
        }
      } finally {
        const dir = exportDir(made)
        if (dir) await rm(dir, { recursive: true, force: true })
      }
      return { mediaIds: ids }
    }
    route(ctx.api, {
      method: 'post',
      path: '/media/{id}/design/export',
      summary: 'Export frames of a design as new pictures (or PDFs) in the same project',
      description:
        'Needs figcraft-cli on the server. Each exported item links back to the design ("Rendered from").',
      tags,
      access: 'media.upload',
      params: IdParams,
      body: ExportInput,
      response: z.object({ mediaIds: z.array(z.string()) }),
      handler: ({ params, body, actor }) => exportFrames(params.id, body, actor),
    })

    // ── the browser build ──────────────────────────────────────────────
    const serveApp = async (c: Ctx) => {
      const version = c.req.param('version')
      if (version !== FIGCRAFT_WEB.version) throw notFound('No such FigCraft version here')
      const prefix = `/api/figcraft/app/${version}`
      const path = decodeURIComponent(new URL(c.req.url).pathname)
      if (path === prefix) return c.redirect(`${prefix}/`, 308)
      const res = await web.serve(path.slice(prefix.length), c.req.header('accept-encoding') ?? '')
      if (!res) throw notFound(web.state === 'ready' ? 'No such file' : 'FigCraft is not installed yet')
      return res
    }
    ctx.api.on(['GET', 'HEAD'], '/figcraft/app/:version', serveApp)
    ctx.api.on(['GET', 'HEAD'], '/figcraft/app/:version/*', serveApp)

    // ── MCP ─────────────────────────────────────────────────────────────
    ctx.mcp.tool({
      name: 'design_info',
      description:
        'What a FigCraft design (a media item of kind "design") holds: its pages, the top-level frames on each ' +
        '(id, name, size), the fonts its text uses and counts of layers, components, styles and variables.',
      input: { mediaId: z.uuid(), formatId: z.uuid().optional() },
      access: 'media.read',
      readOnly: true,
      handler: async ({ mediaId, formatId }, { actor }) =>
        (await infoOf(designFormat(await media.get(mediaId, actor), formatId))) ?? {
          pending: 'The design is still being read; try again in a moment.',
        },
    })
    ctx.mcp.tool({
      name: 'design_export_frames',
      description:
        'Export frames of a FigCraft design as new media items (pictures, or PDF) in the same project, each linked ' +
        'to the design as "Rendered from". `frames` are frame ids from design_info; default: every frame of the ' +
        'first page. Needs figcraft-cli on the server.',
      input: {
        mediaId: z.uuid(),
        frames: z.array(z.number().int()).max(200).optional(),
        format: z.enum(['png', 'jpg', 'webp', 'pdf']).optional(),
        scale: z.number().min(0.25).max(4).optional(),
      },
      access: 'media.upload',
      handler: ({ mediaId, frames, format, scale }, { actor }) =>
        exportFrames(mediaId, ExportInput.parse({ frames, format, scale }), actor),
    })

    ctx.onStart(async () => {
      await cleanRenderTmp(home)
      await syncFonts()
      if (ctx.config.role !== 'worker') void web.ensure(ctx.log)
      if (!renderer)
        ctx.log.info('figcraft-cli not found: design thumbnails come from the small preview inside each file')
    })
  },
})

/** figcraft-cli from the setting, else from the PATH. */
function findCli(configured: string | null) {
  const runnable = (p: string) => {
    try {
      accessSync(p, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  if (configured) return existsSync(configured) && runnable(configured) ? configured : null
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const p = join(dir, 'figcraft-cli')
    if (dir && existsSync(p) && runnable(p)) return p
  }
  return null
}
