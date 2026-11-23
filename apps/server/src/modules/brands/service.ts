import { readFile, rm } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  BRAND_SECTIONS,
  type BrandAsset,
  type BrandColor,
  type BrandFamily,
  type BrandFontFace,
  type BrandFontUse,
  type BrandKit,
  type BrandLogo,
  type BrandSection,
  type BrandSectionType,
  type BrandSummary,
  colorGroupKey,
  FONT_FILE,
  isJunkPath,
  kitRoot,
  luminance,
  type Media,
  type MediaFormat,
  type MoveBrandAssetInput,
  PALETTE_FILE,
  placeBrandFile,
  type UpdateBrandKitInput,
} from '@greenlit/shared'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { type Actor, actorUserId, systemActor } from '../../core/actor.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import type { JobContext } from '../../core/jobs.ts'
import type { ModuleContext } from '../../core/module.ts'
import { readFontInfo } from '../../lib/fonts.ts'
import { ZipError, ZipReader } from '../../lib/zip.ts'
import { media, mediaFormats } from '../media/schema.ts'
import { projects } from '../projects/schema.ts'
import { isPaletteFile, mergeColors, mergeFonts, parsePalette } from './palettes.ts'
import { type BrandAssetInfo, brandAssets, brandKits } from './schema.ts'
import { artworkSurface } from './surface.ts'

type KitRow = typeof brandKits.$inferSelect
type AssetRow = typeof brandAssets.$inferSelect

/** A font file of a kit, as design documents get it (see the figcraft module's `designs.extraFonts`). */
export interface KitFont {
  id: string
  blobId: string
  family: string
  style: string
  filename: string
  size: number
  createdAt: string
  /** The kit it comes from. */
  source: string
}

/** Types browsers and archives don't always say, for files kits carry. */
const KIT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.figcraft': 'application/x-figcraft',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.zip': 'application/zip',
  '.cube': 'application/x-cube-lut',
  '.ase': 'application/x-adobe-ase',
}
export const kitMime = (filename: string) =>
  KIT_MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream'

const isZip = (f: { mime: string; filename: string }) =>
  /^application\/(x-)?zip(-compressed)?$/.test(f.mime) || /\.zip$/i.test(f.filename)
const README = /^(readme|leggimi|leeme|lisezmoi|liesmich)(\.(md|markdown|txt))?$/i
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const blobOf = (f: Pick<MediaFormat, 'urls'>) => f.urls.original.split('?')[0]!.split('/').pop()!
const primaryOf = (m: Media) => m.formats.find((f) => f.isPrimary) ?? m.formats[0]
const SURFACE_SECTIONS: BrandSectionType[] = ['logos', 'graphics']

export class BrandsService {
  readonly ctx: ModuleContext
  private announcing = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }
  private get db() {
    return this.ctx.db
  }

  // ── kits ────────────────────────────────────────────────────────────────

  async isKit(projectId: string | null | undefined) {
    if (!projectId) return false
    const [p] = await this.db
      .select({ kind: projects.kind })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    return p?.kind === 'brand'
  }

  async kitRow(projectId: string): Promise<KitRow> {
    await this.db.insert(brandKits).values({ projectId }).onConflictDoNothing()
    const [row] = await this.db.select().from(brandKits).where(eq(brandKits.projectId, projectId))
    return row!
  }

  /** Tells open kit pages to read the kit again; bursts (an import of 150 files) become one message. */
  announce(projectId: string) {
    if (this.announcing.has(projectId)) return
    this.announcing.set(
      projectId,
      setTimeout(() => {
        this.announcing.delete(projectId)
        this.ctx.realtime.publish(`project:${projectId}`, 'brand.updated', { projectId })
        this.ctx.realtime.publish('library', 'brand.updated', { projectId })
      }, 1200),
    )
  }

  private async primaryRow(mediaId: string) {
    const [f] = await this.db
      .select({
        blobId: mediaFormats.blobId,
        mime: mediaFormats.mime,
        filename: mediaFormats.filename,
        derived: mediaFormats.derived,
      })
      .from(mediaFormats)
      .where(
        and(
          eq(mediaFormats.mediaId, mediaId),
          eq(mediaFormats.isPrimary, true),
          eq(mediaFormats.role, 'format'),
          eq(mediaFormats.version, ''),
        ),
      )
    return f ?? null
  }

  // ── a new file in a kit ─────────────────────────────────────────────────

  /** Places a file that arrived in a kit, reads what it carries, or unpacks it when it is the kit as a .zip. */
  async placeNew(mediaId: string, projectId: string | null, path?: string) {
    if (!projectId || !(await this.isKit(projectId))) return
    await this.kitRow(projectId)
    const f = await this.primaryRow(mediaId)
    if (!f) return
    const rel = (path ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (isZip(f) && !rel.includes('/')) {
      await this.queueUnpack(mediaId, projectId, f.filename)
      return
    }
    const place = placeBrandFile(rel || f.filename)
    await this.db
      .insert(brandAssets)
      .values({ mediaId, projectId, section: place.section, group: place.group, path: rel })
      .onConflictDoNothing()
    const [row] = await this.db.select().from(brandAssets).where(eq(brandAssets.mediaId, mediaId))
    if (row) {
      await this.readContents(row, f)
      await this.refreshInfo(row, f)
    }
    this.announce(projectId)
  }

  /** Colours and fonts from palette files; the kit's guide and description from its README. */
  private async readContents(row: AssetRow, f: { blobId: string; filename: string }) {
    const name = f.filename
    const palette = PALETTE_FILE.test(name) || (row.section === 'colors' && isPaletteFile(name))
    const readme = README.test(name) && !(row.path || name).includes('/')
    if (!palette && !readme) return
    const blob = await this.ctx.services.files.get(f.blobId)
    if (blob.size > 2 * 1024 * 1024) return
    const data = await readFile(await this.ctx.services.files.readablePath(blob))
    if (palette) {
      const found = parsePalette(name, data)
      if (found.colors.length || found.fonts.length) await this.mergeInto(row.projectId, found)
      return
    }
    const text = data.toString('utf8').slice(0, 100_000)
    const kit = await this.kitRow(row.projectId)
    if (!kit.guide.trim())
      await this.db
        .update(brandKits)
        .set({ guide: text, updatedAt: new Date() })
        .where(eq(brandKits.projectId, row.projectId))
    const [p] = await this.db
      .select({ description: projects.description })
      .from(projects)
      .where(eq(projects.id, row.projectId))
    const intro = firstParagraph(text)
    if (p && !p.description.trim() && intro)
      await this.ctx.services.projects.update(row.projectId, { description: intro }, systemActor('brand kit'))
  }

  /** Several palette files arrive at once: each merge reads and writes the kit under a row lock. */
  private async mergeInto(projectId: string, found: ReturnType<typeof parsePalette>) {
    await this.kitRow(projectId)
    await this.db.transaction(async (tx) => {
      const [kit] = await tx.select().from(brandKits).where(eq(brandKits.projectId, projectId)).for('update')
      if (!kit) return
      await tx
        .update(brandKits)
        .set({
          colors: mergeColors(kit.colors, found.colors),
          fonts: mergeFonts(kit.fonts, found.fonts),
          updatedAt: new Date(),
        })
        .where(eq(brandKits.projectId, projectId))
    })
  }

  /**
   * What Greenlit reads from the file itself, once per file version: a font's names and weight; the background a
   * transparent logo or graphic needs (from its thumbnail, so only once it is processed). Returns the new info.
   */
  async refreshInfo(
    row: AssetRow,
    f: { blobId: string; mime: string; filename: string; derived: string[] },
  ): Promise<BrandAssetInfo> {
    const files = this.ctx.services.files
    const was = row.info.blobId === f.blobId ? row.info : {}
    const next: BrandAssetInfo = { ...was, blobId: f.blobId }
    if (next.font === undefined) {
      next.font = null
      if (FONT_FILE.test(f.filename) && !/\.woff2?$/i.test(f.filename)) {
        const blob = await files.get(f.blobId)
        next.font = await readFontInfo(await files.readablePath(blob)).catch(() => null)
      }
    }
    const wantsSurface =
      f.mime.startsWith('image/') && SURFACE_SECTIONS.includes(row.section as BrandSectionType)
    if (!wantsSurface) next.surface = null
    else if (next.surface === undefined && f.derived.includes('thumb.webp'))
      next.surface = await artworkSurface(files.derivedPath(f.blobId, 'thumb.webp')).catch(() => null)
    if (JSON.stringify(next) !== JSON.stringify(row.info)) {
      await this.db.update(brandAssets).set({ info: next }).where(eq(brandAssets.mediaId, row.mediaId))
      if (next.font && JSON.stringify(next.font) !== JSON.stringify(row.info.font))
        this.ctx.events.emit('designs.fontsChanged', { families: [next.font.family] })
    }
    return next
  }

  /** A file of a kit finished processing (its thumbnail exists now): read what needed it. */
  async processed(mediaId: string) {
    const [row] = await this.db.select().from(brandAssets).where(eq(brandAssets.mediaId, mediaId))
    if (!row) return
    const f = await this.primaryRow(mediaId)
    if (f) await this.refreshInfo(row, f)
    this.announce(row.projectId)
  }

  /**
   * A deleted kit's files go to the trash with it (restorable there for 30 days): a kit's logos and fonts mean
   * nothing in the library on their own. Answers whether the project was a kit.
   */
  async trashKitFiles(projectId: string) {
    const [p] = await this.db.select({ kind: projects.kind }).from(projects).where(eq(projects.id, projectId))
    if (p?.kind !== 'brand') return false
    const rows = await this.db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.projectId, projectId), isNull(media.deletedAt)))
    if (rows.length)
      await this.ctx.services.media.trash(
        rows.map((r) => r.id),
        systemActor('brand kit'),
      )
    return true
  }

  // ── archives ────────────────────────────────────────────────────────────

  private async queueUnpack(mediaId: string, projectId: string, filename: string) {
    await this.setUnpacking(projectId, mediaId, { done: 0, total: 0 })
    const [m] = await this.db.select({ by: media.createdBy }).from(media).where(eq(media.id, mediaId))
    await this.ctx.jobs.send(
      'brands.unpack',
      { mediaId, projectId },
      {
        task: {
          kind: 'brands.unpack',
          title: `Unpacking ${filename}`,
          entityType: 'project',
          entityId: projectId,
          createdBy: m?.by ?? null,
        },
      },
    )
    this.announce(projectId)
  }

  private async setUnpacking(projectId: string, mediaId: string, v: { done: number; total: number } | null) {
    await this.kitRow(projectId)
    await this.db
      .update(brandKits)
      .set({
        unpacking: v
          ? sql`${brandKits.unpacking} || ${JSON.stringify({ [mediaId]: v })}::jsonb`
          : sql`${brandKits.unpacking} - ${mediaId}::text`,
      })
      .where(eq(brandKits.projectId, projectId))
  }

  /**
   * Unpacks a kit sent as a .zip: every file becomes an item of the kit, placed by its path inside the archive
   * (without the folder the whole archive sits in). The archive goes to the trash once everything is in.
   */
  async unpack({ mediaId, projectId }: { mediaId: string; projectId: string }, job: JobContext) {
    const files = this.ctx.services.files
    const f = await this.primaryRow(mediaId)
    const [m] = await this.db.select().from(media).where(eq(media.id, mediaId))
    if (!f || !m || m.deletedAt) return this.setUnpacking(projectId, mediaId, null)
    const actor = systemActor('brand kit')
    let zip: ZipReader
    try {
      zip = await ZipReader.open(await files.readablePath(await files.get(f.blobId)))
    } catch (err) {
      await this.setUnpacking(projectId, mediaId, null)
      // Not an archive after all: keep it as a file of the kit.
      if (err instanceof ZipError) {
        await this.db
          .insert(brandAssets)
          .values({ mediaId, projectId, section: 'files', group: '' })
          .onConflictDoNothing()
        this.announce(projectId)
        return { files: 0 }
      }
      throw err
    }
    const failed: string[] = []
    let done = 0
    try {
      const entries = zip.entries.filter((e) => !e.directory && !isJunkPath(e.name))
      const root = kitRoot(entries.map((e) => e.name))
      const total = entries.length
      await this.setUnpacking(projectId, mediaId, { done: 0, total })
      for (const e of entries) {
        if (job.signal.aborted) break
        const rel = root ? e.name.slice(root.length + 1) : e.name
        const name = basename(rel)
        const tmp = await files.tmpPath(extname(name))
        try {
          await zip.extract(e, tmp)
          const blob = await files.ingest(tmp, {
            filename: name,
            mime: kitMime(name),
            createdBy: m.createdBy,
            move: true,
          })
          await this.ctx.services.media.createFromBlob(blob, { projectId, path: rel }, actor)
        } catch (err) {
          failed.push(rel)
          job.log.warn({ err: (err as Error).message, file: rel }, 'could not unpack a file of a brand kit')
          await rm(tmp, { force: true })
        }
        done++
        if (done % 4 === 0 || done === total) {
          await job.progress(done / total, `${done} / ${total}`)
          await this.setUnpacking(projectId, mediaId, { done, total })
          this.announce(projectId)
        }
      }
    } finally {
      await zip.close()
    }
    await this.setUnpacking(projectId, mediaId, null)
    if (!failed.length && !job.signal.aborted) await this.ctx.services.media.trash([mediaId], actor)
    this.announce(projectId)
    return { files: done - failed.length, failed }
  }

  // ── reading a kit ───────────────────────────────────────────────────────

  private async kitMedia(projectId: string, actor: Actor) {
    const all: Media[] = []
    let cursor: string | undefined
    do {
      const page = await this.ctx.services.media.list(actor, { projectId, sort: 'title', limit: 500, cursor })
      all.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor && all.length < 5000)
    return all
  }

  async get(projectId: string, actor: Actor): Promise<BrandKit> {
    const project = await this.ctx.services.projects.get(projectId, actor)
    if (project.kind !== 'brand') throw badRequest('This project is not a brand kit')
    const kit = await this.kitRow(projectId)
    const items = (await this.kitMedia(projectId, actor)).filter((m) => !kit.unpacking[m.id])
    const ids = items.map((m) => m.id)
    const rows = new Map(
      (ids.length
        ? await this.db.select().from(brandAssets).where(inArray(brandAssets.mediaId, ids))
        : []
      ).map((r) => [r.mediaId, r]),
    )
    // Files that came in another way (moved here, uploaded before the project was a kit): placed by name.
    for (const m of items) {
      const f = primaryOf(m)
      if (rows.has(m.id) || !f) continue
      const place = placeBrandFile(f.filename)
      const [r] = await this.db
        .insert(brandAssets)
        .values({ mediaId: m.id, projectId, section: place.section, group: place.group })
        .onConflictDoUpdate({
          target: brandAssets.mediaId,
          set: { projectId, section: place.section, group: place.group, placedBy: 'auto', path: '' },
        })
        .returning()
      rows.set(m.id, r!)
    }
    // What hasn't been read yet (a burst of new files): a bounded amount per read, the rest next time.
    let budget = 60
    for (const m of items) {
      const r = rows.get(m.id)
      const f = primaryOf(m)
      if (!r || !f || budget <= 0) continue
      const blobId = blobOf(f)
      const stale =
        r.info.blobId !== blobId ||
        r.info.font === undefined ||
        (r.info.surface === undefined && !!f.urls.thumbnail)
      if (!stale) continue
      budget--
      const derived = f.urls.thumbnail ? ['thumb.webp'] : []
      r.info = await this.refreshInfo(r, { blobId, mime: f.mime, filename: f.filename, derived })
    }

    const assets: BrandAsset[] = items.flatMap((m) => {
      const r = rows.get(m.id)
      if (!r) return []
      const section = (BRAND_SECTIONS as readonly string[]).includes(r.section)
        ? (r.section as BrandSectionType)
        : 'files'
      return [{ media: m, section, group: r.group, path: r.path, surface: r.info.surface ?? null }]
    })
    const colors = kit.colors
    const logo = this.chooseLogo(kit, assets, colors)
    const families = buildFamilies(kit.fonts, assets, rows)
    const unpacking = Object.values(kit.unpacking)
    return {
      projectId,
      name: project.name,
      guide: kit.guide,
      colors,
      families,
      logo: logo.logo,
      logoChosen: logo.chosen,
      sections: buildSections(assets, logo.logo?.mediaId ?? null),
      unpacking: unpacking.length
        ? {
            files: unpacking.length,
            done: unpacking.reduce((n, u) => n + u.done, 0),
            total: unpacking.reduce((n, u) => n + u.total, 0),
          }
        : null,
      updatedAt: kit.updatedAt.toISOString(),
    }
  }

  private chooseLogo(kit: KitRow, assets: BrandAsset[], colors: BrandColor[]) {
    const cands = assets
      .filter((a) => a.section === 'logos' && a.media.kind === 'image')
      .map((a) => {
        const f = primaryOf(a.media)!
        return {
          mediaId: a.media.id,
          name: `${a.media.title} ${f.filename}`,
          group: a.group,
          svg: f.mime === 'image/svg+xml',
          surface: a.surface,
          url:
            f.mime === 'image/svg+xml'
              ? f.urls.original
              : (f.urls.poster ?? f.urls.thumbnail ?? f.urls.original),
        }
      })
    const chosen = kit.logoMediaId ? cands.find((c) => c.mediaId === kit.logoMediaId) : undefined
    const pick = chosen ?? pickLogo(cands, cardSurface(colors))
    return { logo: pick ? logoView(pick, colors) : null, chosen: !!chosen }
  }

  // ── summaries for project cards ─────────────────────────────────────────

  async summaries(ids: string[]): Promise<Record<string, BrandSummary>> {
    if (!ids.length) return {}
    const kits = await this.db
      .select({
        projectId: brandKits.projectId,
        colors: brandKits.colors,
        fonts: brandKits.fonts,
        logo: brandKits.logoMediaId,
      })
      .from(brandKits)
      .innerJoin(projects, eq(projects.id, brandKits.projectId))
      .where(and(inArray(brandKits.projectId, ids), eq(projects.kind, 'brand')))
    if (!kits.length) return {}
    const rows = await this.db
      .select({
        projectId: brandAssets.projectId,
        mediaId: brandAssets.mediaId,
        section: brandAssets.section,
        group: brandAssets.group,
        info: brandAssets.info,
        title: media.title,
        blobId: mediaFormats.blobId,
        mime: mediaFormats.mime,
        filename: mediaFormats.filename,
        derived: mediaFormats.derived,
        rev: mediaFormats.fileRevision,
      })
      .from(brandAssets)
      .innerJoin(
        media,
        and(
          eq(media.id, brandAssets.mediaId),
          eq(media.projectId, brandAssets.projectId),
          isNull(media.deletedAt),
        ),
      )
      .innerJoin(
        mediaFormats,
        and(
          eq(mediaFormats.mediaId, media.id),
          eq(mediaFormats.isPrimary, true),
          eq(mediaFormats.role, 'format'),
          eq(mediaFormats.version, ''),
        ),
      )
      .where(
        and(
          inArray(
            brandAssets.projectId,
            kits.map((k) => k.projectId),
          ),
          inArray(brandAssets.section, ['logos', 'fonts']),
        ),
      )
    const out: Record<string, BrandSummary> = {}
    for (const k of kits) {
      const mine = rows.filter((r) => r.projectId === k.projectId)
      const cands = mine
        .filter((r) => r.section === 'logos' && r.mime.startsWith('image/'))
        .sort((a, b) => natural.compare(`${a.group}/${a.filename}`, `${b.group}/${b.filename}`))
        .map((r) => {
          const base = `/api/files/${r.blobId}`
          const poster = r.derived.includes('poster.webp') ? `${base}/d/poster.webp?v=${r.rev}` : null
          return {
            mediaId: r.mediaId,
            name: `${r.title} ${r.filename}`,
            group: r.group,
            svg: r.mime === 'image/svg+xml',
            surface: r.info.blobId === r.blobId ? (r.info.surface ?? null) : null,
            url: r.mime === 'image/svg+xml' ? base : (poster ?? base),
          }
        })
      const chosen = k.logo ? cands.find((c) => c.mediaId === k.logo) : undefined
      const pick = chosen ?? pickLogo(cands, cardSurface(k.colors))
      const families = new Map<string, string>()
      for (const f of k.fonts) families.set(f.family.toLowerCase(), f.family)
      for (const r of mine)
        if (r.info.font && r.info.blobId === r.blobId)
          families.set(r.info.font.family.toLowerCase(), r.info.font.family)
      out[k.projectId] = {
        logo: pick ? logoView(pick, k.colors) : null,
        colors: k.colors.map((c) => c.hex).slice(0, 12),
        families: [...families.values()],
      }
    }
    return out
  }

  // ── fonts for design documents ──────────────────────────────────────────

  /** Every font file of every kit, one per family and style (a static file before a variable one). */
  async designFonts(): Promise<KitFont[]> {
    const rows = await this.db
      .select({
        mediaId: brandAssets.mediaId,
        info: brandAssets.info,
        createdAt: brandAssets.createdAt,
        blobId: mediaFormats.blobId,
        filename: mediaFormats.filename,
        size: mediaFormats.size,
        kit: projects.name,
      })
      .from(brandAssets)
      .innerJoin(
        media,
        and(
          eq(media.id, brandAssets.mediaId),
          eq(media.projectId, brandAssets.projectId),
          isNull(media.deletedAt),
        ),
      )
      .innerJoin(
        projects,
        and(eq(projects.id, brandAssets.projectId), eq(projects.kind, 'brand'), isNull(projects.deletedAt)),
      )
      .innerJoin(
        mediaFormats,
        and(
          eq(mediaFormats.mediaId, media.id),
          eq(mediaFormats.isPrimary, true),
          eq(mediaFormats.role, 'format'),
          eq(mediaFormats.version, ''),
        ),
      )
      .where(sql`jsonb_typeof(${brandAssets.info}->'font') = 'object'`)
    const best = new Map<string, (typeof rows)[number]>()
    for (const r of rows) {
      const font = r.info.font
      if (!font || r.info.blobId !== r.blobId) continue
      const key = `${font.family}\u0000${font.style}`.toLowerCase()
      const was = best.get(key)
      if (!was || (was.info.font?.variable && !font.variable)) best.set(key, r)
    }
    return [...best.values()].map((r) => ({
      id: `brand-${r.mediaId}`,
      blobId: r.blobId,
      family: r.info.font!.family,
      style: r.info.font!.style,
      filename: r.filename,
      size: r.size,
      createdAt: r.createdAt.toISOString(),
      source: r.kit,
    }))
  }

  // ── changes ─────────────────────────────────────────────────────────────

  async update(projectId: string, input: UpdateBrandKitInput, actor: Actor) {
    if (!(await this.isKit(projectId))) throw notFound('Brand kit not found')
    await this.ctx.services.projects.get(projectId, actor)
    const kit = await this.kitRow(projectId)
    const patch: Partial<KitRow> = { updatedAt: new Date() }
    if (input.guide !== undefined) patch.guide = input.guide
    if (input.colors !== undefined) {
      const ids = new Set<string>()
      for (const c of input.colors) {
        if (ids.has(c.id)) throw badRequest(`Two colours have the id ${c.id}`)
        ids.add(c.id)
      }
      patch.colors = input.colors
    }
    if (input.fonts !== undefined) patch.fonts = input.fonts
    if (input.logoMediaId !== undefined) patch.logoMediaId = input.logoMediaId
    await this.db.update(brandKits).set(patch).where(eq(brandKits.projectId, projectId))
    await this.ctx.versions.record('brand-kit', projectId, actor)
    if (input.fonts) {
      const families = new Set([...kit.fonts, ...input.fonts].map((f) => f.family))
      this.ctx.events.emit('designs.fontsChanged', { families: [...families] })
    }
    await this.ctx.services.projects.touch(projectId)
    this.announce(projectId)
    return this.get(projectId, actor)
  }

  async move(projectId: string, mediaId: string, input: MoveBrandAssetInput, actor: Actor) {
    const m = await this.ctx.services.media.get(mediaId, actor)
    if (m.projectId !== projectId) throw notFound('That file is not in this brand kit')
    const [row] = await this.db
      .update(brandAssets)
      .set({ section: input.section, group: input.group ?? '', placedBy: 'user', updatedAt: new Date() })
      .where(eq(brandAssets.mediaId, mediaId))
      .returning()
    if (!row) throw notFound('That file is not in this brand kit')
    const f = await this.primaryRow(mediaId)
    if (f) await this.refreshInfo({ ...row, info: { ...row.info, surface: undefined } }, f)
    this.announce(projectId)
    return { ok: true as const }
  }

  /** Reads a palette file of the kit again, adding the colours it lists that the kit doesn't have. */
  async readColors(projectId: string, mediaId: string, actor: Actor) {
    const m = await this.ctx.services.media.get(mediaId, actor)
    if (m.projectId !== projectId) throw notFound('That file is not in this brand kit')
    const f = await this.primaryRow(mediaId)
    if (!f) throw notFound('No file')
    const blob = await this.ctx.services.files.get(f.blobId)
    const found = parsePalette(f.filename, await readFile(await this.ctx.services.files.readablePath(blob)))
    if (!found.colors.length) throw badRequest(`No colours found in ${f.filename}`)
    await this.mergeInto(projectId, found)
    await this.ctx.versions.record(
      'brand-kit',
      projectId,
      actorUserId(actor) ? actor : systemActor('brand kit'),
    )
    this.announce(projectId)
    return this.get(projectId, actor)
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** The first paragraph of a README under its title ("Il kit del marchio per..."). */
export function firstParagraph(md: string) {
  for (const block of md.split(/\n\s*\n/)) {
    const t = block.trim()
    if (!t || /^(#|\||[-*+] |\d+\. |>|```|---|<)/.test(t)) continue
    const plain = t
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
    if (plain.length >= 20) return plain.length > 400 ? `${plain.slice(0, 397)}…` : plain
  }
  return ''
}

/** The background kit cards sit on: the kit's first core colour (dark for GEM), else dark. */
function cardSurface(colors: BrandColor[]): 'dark' | 'light' {
  const core = colors.find((c) => colorGroupKey(c.group) === 'core') ?? colors[0]
  return core && luminance(core.hex) > 0.5 ? 'light' : 'dark'
}

interface LogoCandidate {
  mediaId: string
  name: string
  group: string
  svg: boolean
  surface: 'dark' | 'light' | null
  url: string
}

/** The kit's most likely main logo: a horizontal lockup, vector, made for the card's background, not an original. */
export function pickLogo(cands: LogoCandidate[], surface: 'dark' | 'light') {
  let best: LogoCandidate | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const c of cands) {
    const n = c.name.toLowerCase()
    let s = 0
    if (/orizzontal|horizontal|long|primary|principal|main|lockup|full/.test(n)) s += 3
    if (/avatar|icon|favicon|short|only|monogram|mark\b|profil|social/.test(n)) s -= 2
    if (/original|social|profil|avatar|archive|old|vecch/i.test(c.group)) s -= 3
    if (c.svg) s += 1
    if (c.surface === surface) s += 2
    else if (c.surface === null) s -= 1
    if (s > bestScore) {
      best = c
      bestScore = s
    }
  }
  return best
}

function logoView(c: LogoCandidate, colors: BrandColor[]): BrandLogo {
  const byLight = [...colors].sort((a, b) => luminance(a.hex) - luminance(b.hex))
  const core = colors.filter((x) => colorGroupKey(x.group) === 'core')
  const pool = core.length >= 2 ? [...core].sort((a, b) => luminance(a.hex) - luminance(b.hex)) : byLight
  const background =
    c.surface === 'dark'
      ? (pool[0]?.hex ?? null)
      : c.surface === 'light'
        ? (pool[pool.length - 1]?.hex ?? null)
        : null
  return { mediaId: c.mediaId, url: c.url, surface: c.surface, background }
}

function buildSections(assets: BrandAsset[], logoId: string | null): BrandSection[] {
  const out: BrandSection[] = []
  for (const type of BRAND_SECTIONS) {
    const mine = assets.filter((a) => a.section === type)
    if (!mine.length) continue
    const groups = new Map<string, BrandAsset[]>()
    for (const a of mine) groups.set(a.group, [...(groups.get(a.group) ?? []), a])
    const key = (a: BrandAsset) => a.path || primaryOf(a.media)?.filename || a.media.title
    // The main logo's folder (with the folders above and below it) leads; originals and sources come last.
    const top = (name: string) => name.split(' › ')[0]!
    const lead = mine.find((a) => a.media.id === logoId)?.group
    const rank = (name: string) =>
      (name === '' ? -2 : 0) +
      (lead !== undefined && name && top(name) === top(lead) ? -1 : 0) +
      (/original|archiv|old\b|vecch|sorgent|source/i.test(name) ? 2 : 0)
    const sorted = [...groups.entries()]
      .map(([name, list]) => ({ name, assets: list.sort((a, b) => natural.compare(key(a), key(b))) }))
      .sort(
        (a, b) =>
          rank(a.name) - rank(b.name) ||
          natural.compare(key(a.assets[0]!), key(b.assets[0]!)) ||
          natural.compare(a.name, b.name),
      )
    out.push({ type, groups: sorted })
  }
  return out
}

function buildFamilies(
  uses: BrandFontUse[],
  assets: BrandAsset[],
  rows: Map<string, AssetRow>,
): BrandFamily[] {
  const faces = new Map<string, BrandFontFace[]>()
  const names = new Map<string, string>()
  for (const a of assets) {
    const font = rows.get(a.media.id)?.info.font
    const f = primaryOf(a.media)
    if (!font || !f) continue
    const k = font.family.toLowerCase()
    names.set(k, names.get(k) ?? font.family)
    faces.set(k, [
      ...(faces.get(k) ?? []),
      {
        mediaId: a.media.id,
        family: font.family,
        style: font.style,
        weight: font.weight,
        italic: font.italic,
        variable: font.variable,
        weightRange: font.weightRange,
        filename: f.filename,
        url: f.urls.original,
      },
    ])
  }
  const sortFaces = (list: BrandFontFace[]) =>
    list.sort(
      (a, b) =>
        Number(a.variable) - Number(b.variable) || Number(a.italic) - Number(b.italic) || a.weight - b.weight,
    )
  const out: BrandFamily[] = uses.map((u) => ({
    ...u,
    faces: sortFaces(faces.get(u.family.toLowerCase()) ?? []),
  }))
  const known = new Set(uses.map((u) => u.family.toLowerCase()))
  for (const [k, list] of [...faces].sort((a, b) => a[0].localeCompare(b[0])))
    if (!known.has(k))
      out.push({
        family: names.get(k)!,
        role: 'other',
        usage: '',
        uppercase: false,
        letterSpacing: null,
        weights: [],
        faces: sortFaces(list),
      })
  const order = { display: 0, text: 1, other: 2 }
  return out.sort((a, b) => order[a.role] - order[b.role])
}
