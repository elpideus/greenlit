import { Readable } from 'node:stream'
import {
  BrandKit,
  BrandSectionType,
  BrandSummary,
  Id,
  MoveBrandAssetInput,
  UpdateBrandKitInput,
} from '@greenlit/shared'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { can } from '../../core/actor.ts'
import { badRequest, HttpError, notFound } from '../../core/errors.ts'
import { type Ctx, IdParams, Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { zipStream } from '../../lib/zip-writer.ts'
import { brandKits } from './schema.ts'
import { BrandsService } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    brands: BrandsService
  }
}

export default defineModule({
  id: 'brands',
  name: 'Brand kits',
  description:
    'Brand kits: projects of kind "brand" whose files are a brand\'s logos, colours, fonts, graphics, templates, ' +
    'looks and guidelines. Sorts a kit dropped as a folder or a .zip into sections, reads its palettes and fonts, ' +
    'gives its fonts to design documents and its rules to Claude.',
  dependsOn: ['files', 'media', 'projects'],
  setup(ctx) {
    const svc = new BrandsService(ctx)
    ctx.services.provide('brands', svc)
    const abs = (url: string | null | undefined) =>
      url ? new URL(url, ctx.config.publicUrl).toString() : null

    // ── files arriving, changing, leaving ───────────────────────────────
    ctx.events.on('media.created', ({ id, projectId, path }) => svc.placeNew(id, projectId, path))
    ctx.events.on('media.processed', ({ id }) => svc.processed(id))
    const changed = async ({ projectId }: { projectId: string | null }) => {
      if (!(await svc.isKit(projectId))) return
      svc.announce(projectId!)
      ctx.events.emit('designs.fontsChanged', { families: [] })
    }
    ctx.events.on('media.updated', changed)
    ctx.events.on('media.deleted', changed)
    ctx.events.on('project.deleted', async ({ id }) => {
      if (await svc.trashKitFiles(id)) ctx.events.emit('designs.fontsChanged', { families: [] })
    })
    ctx.jobs.define<{ mediaId: string; projectId: string }>('brands.unpack', {
      concurrency: 1,
      retryLimit: 0,
      expireInSeconds: 60 * 60,
      handler: (data, job) => svc.unpack(data, job),
    })

    ctx.hooks.add('projects.decorate', async ({ ids }) => {
      const s = await svc.summaries(ids)
      return Object.fromEntries(Object.entries(s).map(([id, brand]) => [id, { brand }]))
    })
    ctx.hooks.add('designs.extraFonts', () => svc.designFonts())

    // A kit's own history (guide, colours, fonts, main logo) is seen by whoever sees its project.
    ctx.entities.register('brand-kit', {
      canView: (id, actor) => ctx.services.projects.canView(id, actor),
      summarize: async (ids, actor) =>
        (await ctx.services.projects.many(ids, actor)).map((p) => ({
          type: 'brand-kit',
          id: p.id,
          title: p.name,
          thumbnailUrl: p.brand?.logo?.url ?? null,
          kind: 'brand-kit',
          href: `/projects/${p.id}`,
          projectId: p.id,
        })),
    })
    ctx.versions.register('brand-kit', {
      labels: { guide: 'guide', colors: 'colours', fonts: 'fonts', logoMediaId: 'main logo' },
      coalesceSeconds: 60,
      snapshot: async (id) => {
        const [r] = await ctx.db.select().from(brandKits).where(eq(brandKits.projectId, id))
        return r ? { guide: r.guide, colors: r.colors, fonts: r.fonts, logoMediaId: r.logoMediaId } : null
      },
      restore: async (id, d) => {
        await ctx.db
          .update(brandKits)
          .set({
            guide: (d.guide as string) ?? '',
            colors: (d.colors as never) ?? [],
            fonts: (d.fonts as never) ?? [],
            logoMediaId: (d.logoMediaId as string) ?? null,
            updatedAt: new Date(),
          })
          .where(eq(brandKits.projectId, id))
        svc.announce(id)
      },
    })

    // ── API ─────────────────────────────────────────────────────────────
    const tags = ['Brand kits']
    route(ctx.api, {
      method: 'get',
      path: '/brands',
      summary: 'Brand kits you can see, with their main logo, colours and font families',
      tags,
      access: 'projects.read',
      response: z.array(BrandSummary.extend({ projectId: Id, name: z.string() })),
      handler: async ({ actor }) => {
        const kits = await ctx.services.projects.list(actor, { kind: 'brand' })
        return kits.map((p) => ({
          projectId: p.id,
          name: p.name,
          logo: p.brand?.logo ?? null,
          colors: p.brand?.colors ?? [],
          families: p.brand?.families ?? [],
        }))
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/brands/{id}',
      summary: 'A brand kit: its guide, colours, font families and files by section',
      tags,
      access: 'projects.read',
      params: IdParams,
      response: BrandKit,
      handler: ({ params, actor }) => svc.get(params.id, actor),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/brands/{id}',
      summary: "Change a brand kit's guide, colours, font roles or main logo",
      tags,
      access: 'media.edit',
      params: IdParams,
      body: UpdateBrandKitInput,
      response: BrandKit,
      handler: ({ params, body, actor }) => svc.update(params.id, body, actor),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/brands/{id}/assets/{mediaId}',
      summary: 'Move a file of a brand kit to another section or group',
      tags,
      access: 'media.edit',
      params: z.object({ id: Id, mediaId: Id }),
      body: MoveBrandAssetInput,
      response: Ok,
      handler: ({ params, body, actor }) => svc.move(params.id, params.mediaId, body, actor),
    })
    route(ctx.api, {
      method: 'post',
      path: '/brands/{id}/assets/{mediaId}/colors',
      summary: "Read a palette file of the kit again and add the colours it lists that the kit doesn't have",
      tags,
      access: 'media.edit',
      params: z.object({ id: Id, mediaId: Id }),
      response: BrandKit,
      handler: ({ params, actor }) => svc.readColors(params.id, params.mediaId, actor),
    })

    // ── downloading the kit ─────────────────────────────────────────────
    // A zip of the whole kit (or of one section with ?section=logos&label=Loghi), its folders as they were added. Streamed: a
    // kit of any size starts downloading at once and costs no disk. A plain link, so share-link visitors can use it.
    ctx.api.get('/brands/:id/download', async (c: Ctx) => {
      const actor = c.get('actor')
      if (!actor) throw new HttpError('unauthenticated')
      if (!can(actor, 'projects.read')) throw new HttpError('forbidden', 'You cannot open brand kits')
      const id = c.req.param('id')!
      if (!Id.safeParse(id).success) throw notFound('Brand kit not found')
      const asked = c.req.query('section')
      const section = asked ? BrandSectionType.safeParse(asked) : null
      if (section && !section.success) throw badRequest(`No section called ${asked}`)
      const label = c.req.query('label')?.slice(0, 60)
      const { filename, entries } = await svc.download(id, actor, section?.data, label)
      const body = zipStream(entries)
      body.on('error', (err) => ctx.log.warn({ err: err.message, kit: id }, 'a brand kit download broke off'))
      const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
      return new Response(Readable.toWeb(body) as ReadableStream, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'cache-control': 'private, no-store',
        },
      })
    })

    // ── MCP ─────────────────────────────────────────────────────────────
    ctx.mcp.tool({
      name: 'brand_kits',
      description:
        'List brand kits (projects of kind "brand"): id, name, main logo URL, colours (hex) and font families. ' +
        'Use brand_kit for the full rules before making anything for a brand.',
      input: {},
      access: 'projects.read',
      readOnly: true,
      handler: async (_input, { actor }) =>
        (await ctx.services.projects.list(actor, { kind: 'brand' })).map((p) => ({
          projectId: p.id,
          name: p.name,
          description: p.description,
          logo: abs(p.brand?.logo?.url),
          colors: p.brand?.colors ?? [],
          fonts: p.brand?.families ?? [],
        })),
    })
    ctx.mcp.tool({
      name: 'brand_kit',
      description:
        "A brand kit in full: its guide (the kit's README, Markdown: rules, voice, do's and don'ts), its colours " +
        '(name, hex, CMYK, what each is for, group), font families (role display/text, weights, uppercase, ' +
        'tracking, file URLs) and every file by section (logos, graphics, templates, looks, guidelines, files) with ' +
        'download URLs and, for transparent artwork, the background it reads on (dark/light). Files are media ' +
        "items: use their mediaId with the media tools. `download` (and each section's) is a zip of the kit with " +
        'its folders as they were added (send the API token with it).',
      input: { projectId: z.uuid() },
      access: 'projects.read',
      readOnly: true,
      handler: async ({ projectId }, { actor }) => {
        const k = await svc.get(projectId, actor)
        const zip = (section?: string) =>
          abs(`/api/brands/${k.projectId}/download${section ? `?section=${section}` : ''}`)
        return {
          projectId: k.projectId,
          name: k.name,
          download: zip(),
          guide: k.guide,
          colors: k.colors,
          fonts: k.families.map((f) => ({
            family: f.family,
            role: f.role,
            usage: f.usage,
            weights: f.weights,
            uppercase: f.uppercase,
            letterSpacingEm: f.letterSpacing,
            files: f.faces.map((x) => ({
              style: x.style,
              weight: x.weight,
              italic: x.italic,
              variable: x.variable,
              url: abs(x.url),
            })),
          })),
          mainLogo: k.logo
            ? { mediaId: k.logo.mediaId, url: abs(k.logo.url), surface: k.logo.surface }
            : null,
          sections: k.sections.map((s) => ({
            section: s.type,
            download: zip(s.type),
            groups: s.groups.map((g) => ({
              group: g.name,
              files: g.assets.map((a) => {
                const f = a.media.formats.find((x) => x.isPrimary) ?? a.media.formats[0]
                return {
                  mediaId: a.media.id,
                  title: a.media.title,
                  filename: f?.filename,
                  kind: a.media.kind,
                  width: f?.width ?? null,
                  height: f?.height ?? null,
                  surface: a.surface,
                  url: abs(f?.urls.original),
                }
              }),
            })),
          })),
        }
      },
    })
    ctx.mcp.tool({
      name: 'brand_kit_update',
      description:
        "Change a brand kit's guide (Markdown), its colours (the whole list: id, name, hex #RRGGBB, cmyk, usage, " +
        'group), its font roles (the whole list: family, role display/text/other, usage, uppercase, ' +
        'letterSpacing em, weights) or its main logo (a mediaId of the kit, null = automatic).',
      input: {
        projectId: z.uuid(),
        guide: UpdateBrandKitInput.shape.guide,
        colors: UpdateBrandKitInput.shape.colors,
        fonts: UpdateBrandKitInput.shape.fonts,
        logoMediaId: UpdateBrandKitInput.shape.logoMediaId,
      },
      access: 'media.edit',
      handler: async ({ projectId, ...patch }, { actor }) => {
        const k = await svc.update(projectId, patch, actor)
        return { ok: true, colors: k.colors.length, fonts: k.families.map((f) => `${f.family} (${f.role})`) }
      },
    })
  },
})
