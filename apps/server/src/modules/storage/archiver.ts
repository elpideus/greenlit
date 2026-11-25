import { spawn } from 'node:child_process'
import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough, type Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import type { ArchivePolicy, ArchiveStrategy, FileKind } from '@greenlit/shared'
import { and, eq, sql } from 'drizzle-orm'
import type { ModuleContext } from '../../core/module.ts'
import { ffmpegBin, probe } from '../../lib/ffmpeg.ts'
import { blobs } from '../files/schema.ts'
import type { BlobRow } from '../files/service.ts'
import { mediaFiles, mediaFormats } from '../media/schema.ts'
import { runTool, storageTools } from './tools.ts'

declare module '../../core/events.ts' {
  interface Events {
    /** A blob was packed. `removedDerived` lists derived files deleted with it (preview.mp4 when previews are not kept). */
    'storage.archived': {
      blobId: string
      strategy: ArchiveStrategy
      size: number
      archivedSize: number
      removedDerived: string[]
    }
    /**
     * A blob is hot again. When `exact` is false (AV1 / FLAC), the file on disk is the archived rendition and
     * mime, size and filename describe it, not the original upload.
     */
    'storage.restored': {
      blobId: string
      strategy: ArchiveStrategy
      exact: boolean
      mime: string
      size: number
      filename: string
    }
  }
}

type Packed = Exclude<ArchiveStrategy, 'none'>

interface Produced {
  strategy: Packed
  file: string
  ext: string
  mime: string
  size: number
  /** sha256 of the original, when this pass computed it. */
  sha256?: string
}

export interface ArchiveOutcome {
  outcome: 'archived' | 'skipped' | 'failed'
  strategy: ArchiveStrategy
  before: number
  after: number | null
  note: string | null
}

/** Files smaller than this are left alone: the bookkeeping costs more than it saves. */
export const MIN_ARCHIVE_BYTES = 64 * 1024
/** Lossless packing must save at least 3%; a lossy re-encode at least 25%, or it is not worth the quality risk. */
const MIN_LOSSLESS_GAIN = 0.03
const MIN_AV1_GAIN = 0.25

const EXT: Record<Packed, { ext: string; mime: string }> = {
  lossless: { ext: '.zst', mime: 'application/zstd' },
  av1: { ext: '.mp4', mime: 'video/mp4' },
  jxl: { ext: '.jxl', mime: 'image/jxl' },
  flac: { ext: '.flac', mime: 'audio/flac' },
}
/** Strategies whose restore gives back the original file bit for bit. */
const EXACT: Record<Packed, boolean> = { lossless: true, jxl: true, av1: false, flac: false }
/** Audio codecs an MP4 can carry as they are. */
const MP4_AUDIO = new Set(['aac', 'mp3', 'opus', 'alac', 'flac', 'ac3', 'eac3'])

const zstdCompressBuf = promisify(zlib.zstdCompress)

const hashTap = (hash: Hash, onBytes?: (n: number) => void) =>
  new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk)
      onBytes?.(chunk.length)
      cb(null, chunk)
    },
  })
const hashSink = (hash: Hash, onBytes?: (n: number) => void) =>
  new Writable({
    write(chunk: Buffer, _enc, cb) {
      hash.update(chunk)
      onBytes?.(chunk.length)
      cb()
    },
  })

async function sha256File(file: string, signal?: AbortSignal) {
  const h = createHash('sha256')
  await pipeline(createReadStream(file), hashSink(h), { signal })
  return h.digest('hex')
}

/** Moves a file, copying when source and target are on different disks. */
async function moveFile(from: string, to: string) {
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(from, to)
    await rm(from, { force: true })
  }
}

function swapExt(filename: string, ext: string) {
  const base = filename.replace(/\.[a-z0-9]{1,8}$/i, '')
  return `${base || 'file'}${ext}`
}

/**
 * Packs single blobs into DATA_DIR/archive/ (one file per blob, so each stays downloadable, restorable and
 * deletable on its own) and brings them back. Thumbnails, posters, sprites and waveforms are never touched,
 * so archived media stay browsable.
 */
export class Archiver {
  private ctx: ModuleContext
  /** Blobs being packed in this process: a restore request aborts the packing instead of waiting for it. */
  private packing = new Map<string, { abort: AbortController; done: Promise<void> }>()
  private restoring = new Map<string, Promise<boolean>>()

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }

  private get files() {
    return this.ctx.services.files
  }
  private get db() {
    return this.ctx.db
  }

  archivePathFor(blobId: string, ext: string) {
    return join('archive', blobId.slice(0, 2), `${blobId}${ext}`)
  }

  // ── archive ──────────────────────────────────────────────────────────────

  async archive(
    blobId: string,
    opts: {
      policy: ArchivePolicy
      kind: FileKind
      strategy?: ArchiveStrategy
      signal?: AbortSignal
      onProgress?: (fraction: number) => void
    },
  ): Promise<ArchiveOutcome> {
    const [blob] = await this.db
      .update(blobs)
      .set({ state: 'archiving' })
      .where(and(eq(blobs.id, blobId), eq(blobs.state, 'hot')))
      .returning()
    const wanted = opts.strategy ?? opts.policy.strategies[opts.kind] ?? 'lossless'
    if (!blob)
      return {
        outcome: 'skipped',
        strategy: wanted,
        before: 0,
        after: null,
        note: 'Not stored as a regular file right now',
      }

    const abort = new AbortController()
    const onOuterAbort = () => abort.abort()
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
    let finish!: () => void
    this.packing.set(blobId, { abort, done: new Promise<void>((r) => (finish = r)) })
    let produced: Produced | null = null
    try {
      if (wanted === 'none') {
        await this.releaseHot(blobId, false)
        return {
          outcome: 'skipped',
          strategy: 'none',
          before: blob.size,
          after: null,
          note: 'The policy keeps this kind of file as it is',
        }
      }
      const src = this.files.absPath(blob)
      if (!existsSync(src)) throw new Error('The original file is missing on disk')
      produced = await this.produce(blob, src, wanted, opts.kind, abort.signal, opts.onProgress ?? (() => {}))
      if (!produced) {
        // Nothing worth doing: remember that we looked, so the next pass waits another `afterDays`.
        await this.releaseHot(blobId, true)
        return {
          outcome: 'skipped',
          strategy: wanted,
          before: blob.size,
          after: null,
          note: 'Already compressed: packing would not save space',
        }
      }
      const rel = this.archivePathFor(blobId, produced.ext)
      const [done] = await this.db
        .update(blobs)
        .set({
          state: 'archived',
          archiveStrategy: produced.strategy,
          archivedPath: rel,
          archivedSize: produced.size,
          archivedMime: produced.mime,
          archivedAt: new Date(),
          ...(produced.sha256 && !blob.sha256 ? { sha256: produced.sha256 } : {}),
        })
        .where(and(eq(blobs.id, blobId), eq(blobs.state, 'archiving')))
        .returning()
      if (!done) throw new Error('The file changed while it was being packed')
      await rm(src, { force: true })
      const removedDerived: string[] = []
      if (
        !opts.policy.keepPreviews &&
        opts.kind === 'video' &&
        this.files.hasDerived(blobId, 'preview.mp4')
      ) {
        await rm(this.files.derivedPath(blobId, 'preview.mp4'), { force: true })
        removedDerived.push('preview.mp4')
      }
      this.ctx.events.emit('storage.archived', {
        blobId,
        strategy: produced.strategy,
        size: blob.size,
        archivedSize: produced.size,
        removedDerived,
      })
      await this.announce(blobId)
      const note =
        produced.strategy === wanted ? null : `${wanted} was not possible, packed losslessly instead`
      return {
        outcome: 'archived',
        strategy: produced.strategy,
        before: blob.size,
        after: produced.size,
        note,
      }
    } catch (err) {
      if (produced) await rm(produced.file, { force: true }).catch(() => {})
      await this.db
        .update(blobs)
        .set({ state: 'hot' })
        .where(and(eq(blobs.id, blobId), eq(blobs.state, 'archiving')))
      if (abort.signal.aborted) {
        return {
          outcome: 'skipped',
          strategy: wanted,
          before: blob.size,
          after: null,
          note: 'Needed again while it was being packed',
        }
      }
      this.ctx.log.warn({ err, blobId }, 'archiving failed')
      return {
        outcome: 'failed',
        strategy: wanted,
        before: blob.size,
        after: null,
        note: (err as Error).message.slice(0, 300),
      }
    } finally {
      opts.signal?.removeEventListener('abort', onOuterAbort)
      this.packing.delete(blobId)
      finish()
    }
  }

  /** Back to hot without packing. `looked` stamps archivedAt so the next pass waits another `afterDays`. */
  private async releaseHot(blobId: string, looked: boolean) {
    await this.db
      .update(blobs)
      .set({ state: 'hot', ...(looked ? { archiveStrategy: 'none', archivedAt: new Date() } : {}) })
      .where(and(eq(blobs.id, blobId), eq(blobs.state, 'archiving')))
  }

  private async produce(
    blob: BlobRow,
    src: string,
    wanted: Packed,
    kind: FileKind,
    signal: AbortSignal,
    progress: (f: number) => void,
  ): Promise<Produced | null> {
    const tools = await storageTools()
    await mkdir(join(this.files.dataDir, 'archive', blob.id.slice(0, 2)), { recursive: true })
    const attempt = async (name: Packed, fn: () => Promise<Produced | null>) => {
      try {
        return await fn()
      } catch (err) {
        if (signal.aborted) throw err
        this.ctx.log.warn(
          { err: (err as Error).message, blobId: blob.id, strategy: name },
          'archive strategy failed, falling back to lossless',
        )
        return null
      }
    }
    let result: Produced | null = null
    if (wanted === 'av1' && kind === 'video' && tools.av1)
      result = await attempt('av1', () => this.packAv1(blob, src, signal, progress, tools.opus))
    else if (wanted === 'jxl' && kind === 'image' && tools.jxl)
      result = await attempt('jxl', () => this.packJxl(blob, src, signal))
    else if (wanted === 'flac' && kind === 'audio' && tools.flac)
      result = await attempt('flac', () => this.packFlac(blob, src, signal))
    if (result) return result
    if (!tools.zstd) return null
    return this.packLossless(blob, src, signal, progress)
  }

  private partial(blob: BlobRow, ext: string) {
    return join(this.files.dataDir, this.archivePathFor(blob.id, `.partial${ext}`))
  }
  private final(blob: BlobRow, ext: string) {
    return join(this.files.dataDir, this.archivePathFor(blob.id, ext))
  }

  /** Rough zstd ratio from two 8 MB samples (start and middle), so incompressible video is not packed for nothing. */
  private async estimateRatio(src: string, size: number) {
    const fh = await open(src, 'r')
    try {
      const take = Math.min(size, 8 * 1024 * 1024)
      const parts: Buffer[] = []
      for (const pos of size > take * 2 ? [0, Math.floor(size / 2)] : [0]) {
        const { buffer, bytesRead } = await fh.read({ buffer: Buffer.alloc(take), position: pos })
        parts.push(buffer.subarray(0, bytesRead))
      }
      const raw = Buffer.concat(parts)
      const packed = await zstdCompressBuf(raw, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })
      return packed.length / Math.max(1, raw.length)
    } finally {
      await fh.close()
    }
  }

  private async packLossless(
    blob: BlobRow,
    src: string,
    signal: AbortSignal,
    progress: (f: number) => void,
  ): Promise<Produced | null> {
    if ((await this.estimateRatio(src, blob.size)) > 1 - MIN_LOSSLESS_GAIN) return null
    const part = this.partial(blob, EXT.lossless.ext)
    const out = this.final(blob, EXT.lossless.ext)
    const total = Math.max(1, blob.size)
    let read = 0
    const original = createHash('sha256')
    try {
      await pipeline(
        createReadStream(src),
        hashTap(original, (n) => {
          read += n
          progress((read / total) * 0.7)
        }),
        zlib.createZstdCompress({
          params: {
            [zlib.constants.ZSTD_c_compressionLevel]: 7,
            [zlib.constants.ZSTD_c_checksumFlag]: 1,
            [zlib.constants.ZSTD_c_nbWorkers]: Math.min(4, Math.max(1, cpus().length - 1)),
          },
        }),
        createWriteStream(part),
        { signal },
      )
      const sha = original.digest('hex')
      if (blob.sha256 && blob.sha256 !== sha)
        throw new Error('The original does not match its recorded checksum')
      const { size } = await stat(part)
      if (size > blob.size * (1 - MIN_LOSSLESS_GAIN)) {
        await rm(part, { force: true })
        return null
      }
      // Read the archive back and make sure it decompresses to exactly the original.
      const check = createHash('sha256')
      let back = 0
      await pipeline(
        createReadStream(part),
        zlib.createZstdDecompress(),
        hashSink(check, (n) => {
          back += n
          progress(0.7 + (back / total) * 0.3)
        }),
        { signal },
      )
      if (check.digest('hex') !== sha) throw new Error('The packed file did not unpack to the original')
      await rename(part, out)
      return {
        strategy: 'lossless',
        file: out,
        ext: EXT.lossless.ext,
        mime: EXT.lossless.mime,
        size,
        sha256: sha,
      }
    } catch (err) {
      await rm(part, { force: true })
      throw err
    }
  }

  private async packAv1(
    blob: BlobRow,
    src: string,
    signal: AbortSignal,
    progress: (f: number) => void,
    opus: boolean,
  ): Promise<Produced | null> {
    const p = await probe(src)
    // Already AV1 (for example restored from an earlier archive): never re-encode, it would only lose quality.
    if (!p.hasVideo || !p.durationSec || p.videoCodec === 'av1') return null
    // biome-ignore lint/suspicious/noExplicitAny: ffprobe JSON
    const audio = ((p.raw as any)?.streams ?? []).filter((s: any) => s.codec_type === 'audio') as {
      codec_name?: string
      channels?: number
    }[]
    const audioArgs: string[] = []
    if (audio.length) {
      if (audio.every((s) => MP4_AUDIO.has(s.codec_name ?? ''))) audioArgs.push('-c:a', 'copy')
      else if (opus) {
        audioArgs.push('-c:a', 'libopus')
        for (const [i, s] of audio.entries())
          audioArgs.push(`-b:a:${i}`, `${Math.max(2, s.channels ?? 2) * 96}k`)
      } else audioArgs.push('-c:a', 'aac', '-b:a', '320k')
    }
    const shortSide = Math.min(p.width ?? 1080, p.height ?? 1080)
    const crf = shortSide > 1080 ? 25 : 23
    const fps = p.fps && p.fps > 0 && p.fps <= 240 ? p.fps : 30
    const part = this.partial(blob, EXT.av1.ext)
    const out = this.final(blob, EXT.av1.ext)
    try {
      await runTool(
        ffmpegBin(),
        [
          '-hide_banner',
          '-y',
          '-progress',
          'pipe:2',
          '-nostats',
          '-i',
          src,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-map_metadata',
          '0',
          '-map_chapters',
          '0',
          '-c:v',
          'libsvtav1',
          '-preset',
          '6',
          '-crf',
          String(crf),
          '-pix_fmt',
          'yuv420p10le',
          '-svtav1-params',
          'tune=0',
          '-g',
          String(Math.min(300, Math.round(fps * 5))),
          ...audioArgs,
          '-fps_mode',
          'passthrough',
          '-movflags',
          '+faststart+use_metadata_tags',
          '-f',
          'mp4',
          part,
        ],
        { signal, durationSec: p.durationSec, onProgress: (f) => progress(f * 0.97) },
      )
      const check = await probe(part)
      const drift = Math.abs((check.durationSec ?? 0) - p.durationSec)
      if (!check.hasVideo || check.videoCodec !== 'av1' || drift > Math.max(0.5, p.durationSec * 0.01)) {
        throw new Error(
          `AV1 copy does not match the original (duration ${check.durationSec} vs ${p.durationSec})`,
        )
      }
      if (check.hasAudio !== p.hasAudio) throw new Error('AV1 copy lost the audio')
      const { size } = await stat(part)
      if (size > blob.size * (1 - MIN_AV1_GAIN)) {
        await rm(part, { force: true })
        return null
      }
      await rename(part, out)
      return { strategy: 'av1', file: out, ext: EXT.av1.ext, mime: EXT.av1.mime, size }
    } catch (err) {
      await rm(part, { force: true })
      throw err
    }
  }

  private async packJxl(blob: BlobRow, src: string, signal: AbortSignal): Promise<Produced | null> {
    // Only JPEGs can be transcoded reversibly; other pictures go to zstd.
    const fh = await open(src, 'r')
    const head = Buffer.alloc(3)
    await fh.read({ buffer: head, position: 0 })
    await fh.close()
    if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return null
    const part = this.partial(blob, EXT.jxl.ext)
    const out = this.final(blob, EXT.jxl.ext)
    const recon = `${part}.check.jpg`
    try {
      await runTool('cjxl', [src, part, '--lossless_jpeg=1', '--quiet'], { signal })
      await runTool('djxl', [part, recon, '--quiet'], { signal })
      const [a, b] = await Promise.all([blob.sha256 ?? sha256File(src, signal), sha256File(recon, signal)])
      if (a !== b) throw new Error('JPEG XL copy does not rebuild the original JPEG exactly')
      const { size } = await stat(part)
      if (size > blob.size * (1 - MIN_LOSSLESS_GAIN)) {
        await rm(part, { force: true })
        return null
      }
      await rename(part, out)
      return { strategy: 'jxl', file: out, ext: EXT.jxl.ext, mime: EXT.jxl.mime, size, sha256: a }
    } catch (err) {
      await rm(part, { force: true })
      throw err
    } finally {
      await rm(recon, { force: true })
    }
  }

  private async packFlac(blob: BlobRow, src: string, signal: AbortSignal): Promise<Produced | null> {
    const p = await probe(src)
    // biome-ignore lint/suspicious/noExplicitAny: ffprobe JSON
    const audio = ((p.raw as any)?.streams ?? []).filter((s: any) => s.codec_type === 'audio') as {
      codec_name?: string
    }[]
    // Only uncompressed integer PCM in a single stream; float or compressed audio goes to zstd.
    if (p.hasVideo || audio.length !== 1 || !/^pcm_s(16|24|32)(le|be)$/.test(audio[0]!.codec_name ?? ''))
      return null
    const part = this.partial(blob, EXT.flac.ext)
    const out = this.final(blob, EXT.flac.ext)
    try {
      await runTool(
        ffmpegBin(),
        [
          '-hide_banner',
          '-y',
          '-i',
          src,
          '-map',
          '0:a:0',
          '-map_metadata',
          '0',
          '-c:a',
          'flac',
          '-compression_level',
          '8',
          part,
        ],
        { signal },
      )
      // FLAC must decode to exactly the same samples.
      const md5 = (file: string) =>
        runTool(ffmpegBin(), ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'md5', '-'], {
          signal,
          captureStdout: true,
        })
      const [a, b] = await Promise.all([md5(src), md5(part)])
      if (!a.stdout.trim() || a.stdout.trim() !== b.stdout.trim())
        throw new Error('FLAC copy does not decode to the same samples')
      const { size } = await stat(part)
      if (size > blob.size * (1 - MIN_LOSSLESS_GAIN)) {
        await rm(part, { force: true })
        return null
      }
      await rename(part, out)
      return { strategy: 'flac', file: out, ext: EXT.flac.ext, mime: EXT.flac.mime, size }
    } catch (err) {
      await rm(part, { force: true })
      throw err
    }
  }

  // ── read & restore ───────────────────────────────────────────────────────

  /** A download stream for an archived blob: unpacked on the fly for zstd / JPEG XL, as it is for AV1 / FLAC. */
  async open(blob: BlobRow): Promise<{ stream: Readable; mime: string; size?: number } | undefined> {
    if (!blob.archivedPath || !blob.archiveStrategy || !(blob.archiveStrategy in EXT)) return undefined
    const strategy = blob.archiveStrategy as Packed
    const archive = join(this.files.dataDir, blob.archivedPath)
    if (!existsSync(archive)) {
      // A restore may have just moved it back into place.
      const hot = this.files.absPath(blob)
      if (!existsSync(hot)) return undefined
      return {
        stream: createReadStream(hot),
        mime: EXACT[strategy] ? blob.mime : (blob.archivedMime ?? blob.mime),
        size: (await stat(hot)).size,
      }
    }
    if (strategy === 'lossless') {
      const out = new PassThrough()
      pipeline(createReadStream(archive), zlib.createZstdDecompress(), out).catch((err) => out.destroy(err))
      return { stream: out, mime: blob.mime, size: blob.size }
    }
    if (strategy === 'jxl') {
      const child = spawn('djxl', [archive, '-', '--output_format', 'jpeg', '--quiet'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const out = new PassThrough()
      child.on('error', (err) => out.destroy(err))
      child.on('close', (code) => code !== 0 && out.destroy(new Error(`djxl exited with ${code}`)))
      child.stdout.pipe(out)
      return { stream: out, mime: blob.mime, size: blob.size }
    }
    return {
      stream: createReadStream(archive),
      mime: blob.archivedMime ?? EXT[strategy].mime,
      size: blob.archivedSize ?? undefined,
    }
  }

  /** Brings a blob back to hot storage (tools need random access). Resolves true once the file is in place. */
  async restore(blobId: string): Promise<boolean> {
    const blob = await this.files.get(blobId)
    if (blob.state === 'hot') return true
    if (blob.state === 'archiving') {
      const job = this.packing.get(blobId)
      if (job) {
        job.abort.abort()
        await job.done
      } else await this.waitWhile(blobId, 'archiving')
      const now = await this.files.get(blobId)
      return now.state === 'hot' ? true : now.state === 'archived' ? this.restore(blobId) : false
    }
    if (blob.state === 'restoring') {
      const pending = this.restoring.get(blobId)
      if (pending) return pending
      await this.waitWhile(blobId, 'restoring')
      return (await this.files.get(blobId)).state === 'hot'
    }
    const p = this.unpack(blobId).finally(() => this.restoring.delete(blobId))
    this.restoring.set(blobId, p)
    return p
  }

  /** Another process is moving the blob: wait (up to 2 hours) until it is done. */
  private async waitWhile(blobId: string, state: string) {
    const until = Date.now() + 2 * 3600_000
    while (Date.now() < until) {
      const [row] = await this.db.select({ state: blobs.state }).from(blobs).where(eq(blobs.id, blobId))
      if (!row || row.state !== state) return
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  private async unpack(blobId: string): Promise<boolean> {
    const [blob] = await this.db
      .update(blobs)
      .set({ state: 'restoring' })
      .where(and(eq(blobs.id, blobId), eq(blobs.state, 'archived')))
      .returning()
    if (!blob) return (await this.files.get(blobId)).state === 'hot'
    const strategy = (blob.archiveStrategy ?? 'lossless') as Packed
    const archive = join(this.files.dataDir, blob.archivedPath ?? '')
    const dest = this.files.absPath(blob)
    const part = `${dest}.restoring`
    let moved = false
    try {
      if (!blob.archivedPath || !existsSync(archive)) throw new Error('The archived file is missing on disk')
      await mkdir(dirname(dest), { recursive: true })
      let patch: Partial<BlobRow> = {}
      if (strategy === 'lossless' || strategy === 'jxl') {
        if (strategy === 'lossless') {
          await pipeline(createReadStream(archive), zlib.createZstdDecompress(), createWriteStream(part))
        } else {
          await runTool('djxl', [archive, `${part}.jpg`, '--quiet'])
          await rename(`${part}.jpg`, part)
        }
        const { size } = await stat(part)
        const sha = await sha256File(part)
        if (size !== blob.size || (blob.sha256 && sha !== blob.sha256))
          throw new Error('The unpacked file does not match the original')
        await rename(part, dest)
        patch = { sha256: blob.sha256 ?? sha }
      } else {
        // AV1 / FLAC: the archived rendition becomes the file; the row now describes it.
        await moveFile(archive, dest)
        moved = true
        const ext = EXT[strategy].ext
        patch = {
          mime: blob.archivedMime ?? EXT[strategy].mime,
          size: blob.archivedSize ?? (await stat(dest)).size,
          filename: swapExt(blob.filename, ext),
          sha256: null,
        }
      }
      await this.db
        .update(blobs)
        .set({
          ...patch,
          state: 'hot',
          archiveStrategy: null,
          archivedPath: null,
          archivedSize: null,
          archivedMime: null,
          // Restore time: the next pass leaves the file alone for another `afterDays`.
          archivedAt: new Date(),
        })
        .where(eq(blobs.id, blobId))
      if (EXACT[strategy]) await rm(archive, { force: true })
      else void this.ctx.jobs.send('files.hash', { blobId })
      const now = await this.files.get(blobId)
      this.ctx.events.emit('storage.restored', {
        blobId,
        strategy,
        exact: EXACT[strategy],
        mime: now.mime,
        size: now.size,
        filename: now.filename,
      })
      await this.announce(blobId)
      return true
    } catch (err) {
      this.ctx.log.error({ err, blobId }, 'restore failed')
      await rm(part, { force: true }).catch(() => {})
      await rm(`${part}.jpg`, { force: true }).catch(() => {})
      if (moved) await moveFile(dest, archive).catch(() => {})
      await this.db
        .update(blobs)
        .set({ state: 'archived' })
        .where(and(eq(blobs.id, blobId), eq(blobs.state, 'restoring')))
      return false
    }
  }

  /** Tells open media pages that a file moved (the media view shows its storage state). */
  private async announce(blobId: string) {
    const rows = await this.db.execute<{ media_id: string }>(sql`
      select media_id from ${mediaFormats} where blob_id = ${blobId}
      union select media_id from ${mediaFiles} where blob_id = ${blobId}`)
    for (const r of rows)
      this.ctx.realtime.publish(`media:${r.media_id}`, 'media.updated', { id: r.media_id })
    this.ctx.realtime.publish('storage', 'storage.changed', { blobId })
  }
}
