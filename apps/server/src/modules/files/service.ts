import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { eq, inArray } from 'drizzle-orm'
import type { Context } from 'hono'
import type { Actor } from '../../core/actor.ts'
import { HttpError, notFound } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import { MIME } from '../../core/static.ts'
import { blobs } from './schema.ts'

export type BlobRow = typeof blobs.$inferSelect

export interface UploadPurposeDef {
  /** Permission needed to upload with this purpose. */
  access: string
  maxBytes?: number
  /** Called when the upload is complete and stored as a blob. Its result is sent back to the uploader. */
  handle: (blob: BlobRow, target: Record<string, unknown>, actor: Actor) => Promise<unknown>
  usage?: string
}

declare module '../../core/hooks.ts' {
  interface Hooks {
    /** Can this person read this blob? Return true to allow, undefined if the blob is not yours. */
    'files.access': { args: { blobId: string; actor: Actor }; result: boolean | undefined }
    /** Read an archived blob (provided by the storage module). */
    'files.openArchived': {
      args: { blob: BlobRow }
      result: { stream: Readable; mime: string; size?: number } | undefined
    }
    /** Make an archived blob hot again (provided by the storage module). */
    'files.restore': { args: { blob: BlobRow }; result: boolean | undefined }
  }
}

const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME).map(([ext, mime]) => [mime.split(';')[0], ext]),
)

export class FilesService {
  readonly purposes = new Map<string, UploadPurposeDef>()
  readonly ctx: ModuleContext

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }

  get dataDir() {
    return this.ctx.config.dataDir
  }
  dir(name: 'blobs' | 'derived' | 'tmp' | 'uploads' | 'archive') {
    return join(this.dataDir, name)
  }

  purpose(name: string, def: UploadPurposeDef) {
    if (this.purposes.has(name)) throw new Error(`Upload purpose ${name} registered twice`)
    this.purposes.set(name, def)
  }

  async tmpPath(ext = '') {
    await mkdir(this.dir('tmp'), { recursive: true })
    return join(this.dir('tmp'), `${crypto.randomUUID()}${ext}`)
  }

  /** Moves (or copies) a finished file into the blob store. */
  async ingest(
    file: string,
    info: { filename: string; mime: string; createdBy?: string | null; usage?: string; move?: boolean },
  ): Promise<BlobRow> {
    const id = crypto.randomUUID()
    const rel = join('blobs', id.slice(0, 2), id)
    const abs = join(this.dataDir, rel)
    await mkdir(dirname(abs), { recursive: true })
    if (info.move !== false) {
      try {
        await rename(file, abs)
      } catch {
        await copyFile(file, abs)
        await rm(file, { force: true })
      }
    } else await copyFile(file, abs)
    const { size } = await stat(abs)
    const [row] = await this.ctx.db
      .insert(blobs)
      .values({
        id,
        size,
        mime: info.mime || 'application/octet-stream',
        filename: info.filename.slice(0, 250) || 'file',
        path: rel,
        usage: info.usage ?? 'media',
        createdBy: info.createdBy ?? null,
      })
      .returning()
    void this.ctx.jobs.send('files.hash', { blobId: id })
    return row!
  }

  async get(id: string): Promise<BlobRow> {
    const [row] = await this.ctx.db.select().from(blobs).where(eq(blobs.id, id))
    if (!row) throw notFound('File not found')
    return row
  }

  async many(ids: string[]): Promise<Map<string, BlobRow>> {
    if (!ids.length) return new Map()
    const rows = await this.ctx.db
      .select()
      .from(blobs)
      .where(inArray(blobs.id, [...new Set(ids)]))
    return new Map(rows.map((r) => [r.id, r]))
  }

  absPath(blob: BlobRow) {
    return join(this.dataDir, blob.path)
  }

  /**
   * A path ffmpeg & co. can read. Archived blobs are brought back first (restored), since tools need random access.
   */
  async readablePath(blob: BlobRow): Promise<string> {
    if (blob.state === 'hot') return this.absPath(blob)
    const restored = (await this.ctx.hooks.run('files.restore', { blob })).some(Boolean)
    if (!restored) throw new HttpError('unavailable', 'This file is archived and could not be restored')
    return this.absPath(await this.get(blob.id))
  }

  derivedDir(blobId: string) {
    return join(this.dir('derived'), blobId.slice(0, 2), blobId)
  }
  derivedPath(blobId: string, name: string) {
    return join(this.derivedDir(blobId), name)
  }
  hasDerived(blobId: string, name: string) {
    return existsSync(this.derivedPath(blobId, name))
  }

  async remove(blobId: string) {
    const [row] = await this.ctx.db.delete(blobs).where(eq(blobs.id, blobId)).returning()
    if (!row) return
    await rm(join(this.dataDir, row.path), { force: true })
    if (row.archivedPath) await rm(join(this.dataDir, row.archivedPath), { force: true })
    await rm(this.derivedDir(blobId), { recursive: true, force: true })
  }

  async hash(blobId: string) {
    const blob = await this.get(blobId)
    if (blob.sha256 || blob.state !== 'hot') return
    const h = createHash('sha256')
    await pipeline(createReadStream(this.absPath(blob)), h)
    await this.ctx.db
      .update(blobs)
      .set({ sha256: h.digest('hex') })
      .where(eq(blobs.id, blobId))
  }

  // ── access ──────────────────────────────────────────────────────────────

  async canAccess(blobId: string, actor: Actor | null) {
    if (!actor) return false
    if (actor.kind === 'system' || actor.permissions.has('*')) return true
    const answers = await this.ctx.hooks.run('files.access', { blobId, actor })
    return answers.some((a) => a === true)
  }

  /** Signed URL for clients without a session (render browser, social platform fetchers). */
  sign(path: string, ttlSeconds = 6 * 3600) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds
    const sig = createHmac('sha256', this.ctx.config.secret).update(`${path}|${exp}`).digest('base64url')
    return `${path}${path.includes('?') ? '&' : '?'}exp=${exp}&sig=${sig}`
  }

  verify(path: string, exp: string | undefined, sig: string | undefined) {
    if (!exp || !sig || Number(exp) < Date.now() / 1000) return false
    const expected = createHmac('sha256', this.ctx.config.secret).update(`${path}|${exp}`).digest()
    const got = Buffer.from(sig, 'base64url')
    return got.length === expected.length && timingSafeEqual(got, expected)
  }

  // ── serving ─────────────────────────────────────────────────────────────

  /** Streams a file with HTTP range support (video seeking) and cache headers. */
  async serveFile(
    c: Context,
    file: string,
    opts: { mime: string; download?: string | null; immutable?: boolean },
  ) {
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      throw notFound('File missing on disk')
    }
    const headers: Record<string, string> = {
      'content-type': opts.mime,
      'accept-ranges': 'bytes',
      'cache-control': opts.immutable ? 'private, max-age=31536000, immutable' : 'private, max-age=60',
    }
    if (opts.download) headers['content-disposition'] = contentDisposition(opts.download)
    const range = c.req.header('range')
    if (c.req.method === 'HEAD')
      return new Response(null, { headers: { ...headers, 'content-length': String(size) } })
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/)
      if (m) {
        let start = m[1] ? Number(m[1]) : size - Number(m[2])
        let end = m[1] && m[2] ? Number(m[2]) : size - 1
        if (!m[1]) end = size - 1
        start = Math.max(0, start)
        end = Math.min(end, size - 1)
        if (start > end)
          return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
        return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
          status: 206,
          headers: {
            ...headers,
            'content-range': `bytes ${start}-${end}/${size}`,
            'content-length': String(end - start + 1),
          },
        })
      }
    }
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { ...headers, 'content-length': String(size) },
    })
  }

  async serveBlob(c: Context, blob: BlobRow, download: boolean, name?: string) {
    const filename = name || blob.filename
    if (blob.state === 'hot' || blob.state === 'archiving') {
      return this.serveFile(c, this.absPath(blob), {
        mime: blob.mime,
        download: download ? filename : null,
        immutable: true,
      })
    }
    const [archived] = (await this.ctx.hooks.run('files.openArchived', { blob })).filter(Boolean)
    if (!archived) throw new HttpError('unavailable', 'This file is archived')
    const headers: Record<string, string> = {
      'content-type': archived.mime,
      'cache-control': 'private, max-age=60',
    }
    if (archived.size) headers['content-length'] = String(archived.size)
    let downloadName = filename
    if (archived.mime !== blob.mime) {
      const ext =
        EXT_BY_MIME[archived.mime.split(';')[0]!] ??
        ({ 'video/mp4': '.mp4', 'audio/flac': '.flac', 'image/jxl': '.jxl' } as Record<string, string>)[
          archived.mime
        ]
      if (ext) downloadName = downloadName.replace(/\.[a-z0-9]{1,8}$/i, '') + ext
    }
    if (download) headers['content-disposition'] = contentDisposition(downloadName)
    return new Response(Readable.toWeb(archived.stream) as ReadableStream, { headers })
  }

  extFor(mime: string, filename?: string) {
    const fromName = filename?.match(/\.[a-z0-9]{1,8}$/i)?.[0]?.toLowerCase()
    return fromName ?? EXT_BY_MIME[mime] ?? ''
  }

  relativeToData(abs: string) {
    return relative(this.dataDir, abs)
  }
}

export function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
