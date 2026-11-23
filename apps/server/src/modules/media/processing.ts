import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type MediaKind, mediaKindFromMime } from '@greenlit/shared'
import { eq } from 'drizzle-orm'
import exifr from 'exifr'
import sharp, { type Metadata } from 'sharp'
import type { JobContext } from '../../core/jobs.ts'
import type { ModuleContext } from '../../core/module.ts'
import { ffmpeg, ffmpegBin, HDR_TO_SDR, isHdr, type ProbeResult, probe } from '../../lib/ffmpeg.ts'
import { media, mediaFormats } from './schema.ts'

declare module '../../core/hooks.ts' {
  interface Hooks {
    /**
     * A file the media module can't read itself (a design document...): the module that knows the format makes the
     * derived files in `out` (thumb.webp, poster.webp and its own) and says what it found; others answer undefined.
     */
    'media.processFile': {
      args: { src: string; out: string; mime: string; filename: string; signal: AbortSignal }
      result: ProcessedFile | undefined
    }
  }
}

export interface ProcessedFile {
  kind?: MediaKind
  width?: number | null
  height?: number | null
  /** Names of the files written to `out`. */
  derived: string[]
  meta?: Record<string, unknown>
}

const SPRITE_COLS = 10
const SPRITE_W = 192

/**
 * Turns an uploaded file into everything the UI needs: size/duration, thumbnail, poster, a browser-friendly
 * preview (short keyframe interval so the editor can scrub), a sprite sheet for hover-scrubbing and a waveform.
 */
export async function processFormat(ctx: ModuleContext, formatId: string, job: JobContext) {
  const [format] = await ctx.db.select().from(mediaFormats).where(eq(mediaFormats.id, formatId))
  if (!format) return
  const files = ctx.services.files
  const blob = await files.get(format.blobId)
  const src = await files.readablePath(blob)
  const out = files.derivedDir(blob.id)
  await mkdir(out, { recursive: true })
  const setState = async (patch: Partial<typeof mediaFormats.$inferInsert>) => {
    await ctx.db
      .update(mediaFormats)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(mediaFormats.id, formatId))
    ctx.realtime.publish(`media:${format.mediaId}`, 'media.processing', { formatId, ...patch })
  }
  await setState({ processingState: 'processing', processingProgress: 0, processingError: null })
  const progress = async (p: number, message?: string) => {
    await job.progress(p, message)
    ctx.realtime.publish(`media:${format.mediaId}`, 'media.processing', {
      formatId,
      processingState: 'processing',
      processingProgress: p,
    })
  }

  try {
    let kind = mediaKindFromMime(format.mime)
    let info: Partial<typeof mediaFormats.$inferInsert> = {}
    const derived: string[] = []
    let takenAt: Date | null = null
    let location: { lat: number; lng: number } | null = null

    if (kind === 'image') {
      const r = await processImage(src, out)
      info = { width: r.width, height: r.height }
      derived.push(...r.derived)
      takenAt = r.takenAt
      location = r.location
    } else if (kind === 'video' || kind === 'audio' || format.mime === 'application/octet-stream') {
      const p = await probe(src).catch(() => null)
      if (p?.hasVideo && (p.durationSec ?? 0) > 0) kind = 'video'
      else if (p?.hasAudio) kind = 'audio'
      if (p && kind === 'video') {
        info = {
          width: p.width,
          height: p.height,
          duration: p.durationSec,
          fps: p.fps,
          hasAudio: p.hasAudio,
          kind,
        }
        derived.push(...(await processVideo(src, out, p, progress, job.signal)))
      } else if (p && kind === 'audio') {
        info = { duration: p.durationSec, hasAudio: true, kind }
        derived.push(...(await processAudio(src, out, p, progress, job.signal)))
      }
      if (p) {
        takenAt = p.createdAt ? new Date(p.createdAt) : null
        location = p.location
        info.meta = {
          videoCodec: p.videoCodec,
          audioCodec: p.audioCodec,
          bitrate: p.bitrate,
          pixFmt: p.pixFmt,
          hdr: isHdr(p),
          container: p.format,
        }
      }
    } else if (format.mime === 'application/pdf') {
      derived.push(...(await processPdf(src, out)))
    } else {
      const args = { src, out, mime: format.mime, filename: format.filename, signal: job.signal }
      const done = (await ctx.hooks.run('media.processFile', args)).find((r) => r)
      if (done) {
        if (done.kind) kind = done.kind
        info = { width: done.width ?? null, height: done.height ?? null, meta: done.meta ?? {} }
        derived.push(...done.derived)
      }
    }

    await setState({
      ...info,
      kind,
      derived,
      processingState: 'ready',
      processingProgress: 1,
      processingError: null,
    })
    const [m] = await ctx.db.select().from(media).where(eq(media.id, format.mediaId))
    if (m) {
      const patch: Partial<typeof media.$inferInsert> = {}
      // The item's kind follows its main file (not another version's, nor an audio track).
      if (format.isPrimary && format.role === 'format' && !format.version && m.kind !== kind)
        patch.kind = kind
      if (!m.takenAt && takenAt && !Number.isNaN(takenAt.getTime()) && takenAt.getFullYear() > 1980)
        patch.takenAt = takenAt
      if (Object.keys(patch).length) await ctx.db.update(media).set(patch).where(eq(media.id, m.id))
      if (location)
        ctx.events.emit('media.located', { id: m.id, lat: location.lat, lng: location.lng, source: 'exif' })
      ctx.events.emit('media.processed', { id: m.id, formatId })
      ctx.services.media.publish(m.id, m.projectId, 'media.updated')
    }
  } catch (err) {
    if (job.signal.aborted) return
    await setState({ processingState: 'failed', processingError: (err as Error).message.slice(0, 1000) })
    throw err
  }
}

async function processImage(src: string, out: string) {
  let input: string | Buffer = src
  let meta: Metadata
  try {
    meta = await sharp(src, { failOn: 'none' }).metadata()
  } catch {
    // HEIC and other formats sharp cannot read: let ffmpeg decode them first.
    const png = join(out, 'decoded.png')
    await ffmpeg(['-i', src, '-frames:v', '1', png])
    input = png
    meta = await sharp(png).metadata()
  }
  const rotated = (meta.orientation ?? 1) >= 5
  const width = (rotated ? meta.height : meta.width) ?? null
  const height = (rotated ? meta.width : meta.height) ?? null
  await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(join(out, 'thumb.webp'))
  await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86 })
    .toFile(join(out, 'poster.webp'))
  if (typeof input !== 'string' || input !== src) await rm(join(out, 'decoded.png'), { force: true })
  let takenAt: Date | null = null
  let location: { lat: number; lng: number } | null = null
  try {
    // exifr leaks file handles when given a path (fatal on Node 26), so hand it the head of the file.
    const fh = await open(src, 'r')
    let head: Buffer
    try {
      const { buffer, bytesRead } = await fh.read({ buffer: Buffer.alloc(2 * 1024 * 1024), position: 0 })
      head = buffer.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
    const exif = await exifr.parse(head, {
      gps: true,
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'GPSLatitude',
        'GPSLatitudeRef',
        'GPSLongitude',
        'GPSLongitudeRef',
      ],
    })
    const d = exif?.DateTimeOriginal ?? exif?.CreateDate
    if (d instanceof Date) takenAt = d
    if (
      typeof exif?.latitude === 'number' &&
      typeof exif?.longitude === 'number' &&
      (exif.latitude || exif.longitude)
    )
      location = { lat: exif.latitude, lng: exif.longitude }
  } catch {
    /* no EXIF */
  }
  return { width, height, derived: ['thumb.webp', 'poster.webp'], takenAt, location }
}

async function processVideo(
  src: string,
  out: string,
  p: ProbeResult,
  progress: (p: number, m?: string) => Promise<void>,
  signal: AbortSignal,
) {
  const derived: string[] = []
  const duration = p.durationSec ?? 0
  const hdr = isHdr(p)
  const tone = hdr ? `${HDR_TO_SDR},` : ''
  // Poster: a frame a little way in (first frames are often black).
  const at = Math.min(Math.max(duration * 0.1, 0), Math.max(duration - 0.1, 0), 3)
  const posterJpg = join(out, 'poster.jpg')
  await ffmpeg(
    [
      '-ss',
      String(at),
      '-i',
      src,
      '-frames:v',
      '1',
      '-vf',
      `${tone}scale='min(2400,iw)':-2`,
      '-q:v',
      '2',
      posterJpg,
    ],
    { signal },
  )
  await sharp(posterJpg).webp({ quality: 86 }).toFile(join(out, 'poster.webp'))
  await sharp(posterJpg)
    .resize(640, 640, { fit: 'inside' })
    .webp({ quality: 78 })
    .toFile(join(out, 'thumb.webp'))
  await rm(posterJpg, { force: true })
  derived.push('poster.webp', 'thumb.webp')
  await progress(0.05, 'Poster ready')

  // Preview: H.264 up to 1080p, keyframe every second for snappy scrubbing, AAC, fast start.
  const fps = p.fps && p.fps > 0 && p.fps <= 120 ? p.fps : 30
  const gop = Math.max(1, Math.round(fps))
  const scale = `scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))':flags=lanczos`
  const preview = join(out, 'preview.mp4')
  await ffmpeg(
    [
      '-i',
      src,
      '-map',
      '0:v:0',
      ...(p.hasAudio ? ['-map', '0:a:0'] : []),
      '-vf',
      `${tone}${scale},format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '22',
      '-profile:v',
      'high',
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
      '-sc_threshold',
      '0',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      ...(p.hasAudio ? ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000'] : []),
      '-movflags',
      '+faststart',
      preview,
    ],
    { durationSec: duration, onProgress: (f) => void progress(0.05 + f * 0.8, 'Making the preview'), signal },
  )
  derived.push('preview.mp4')

  // Sprite sheet for hover scrubbing: up to 100 frames.
  if (duration > 0) {
    const count = Math.min(100, Math.max(10, Math.ceil(duration)))
    const interval = duration / count
    const rows = Math.ceil(count / SPRITE_COLS)
    const sprite = join(out, 'sprite.jpg')
    await ffmpeg(
      [
        '-i',
        preview,
        '-vf',
        `fps=1/${interval.toFixed(4)},scale=${SPRITE_W}:-2,tile=${SPRITE_COLS}x${rows}`,
        '-frames:v',
        '1',
        '-q:v',
        '4',
        sprite,
      ],
      { signal },
    )
    const tileH = Math.round((((p.height ?? 9) / (p.width ?? 16)) * SPRITE_W) / 2) * 2
    await writeFile(
      join(out, 'sprite.json'),
      JSON.stringify({ cols: SPRITE_COLS, rows, count, interval, w: SPRITE_W, h: tileH }),
    )
    derived.push('sprite.jpg', 'sprite.json')
  }
  await progress(0.92, 'Sprite ready')
  if (p.hasAudio) {
    await writeWaveform(preview, join(out, 'waveform.json'), duration, signal)
    derived.push('waveform.json')
  }
  return derived
}

async function processAudio(
  src: string,
  out: string,
  p: ProbeResult,
  progress: (p: number, m?: string) => Promise<void>,
  signal: AbortSignal,
) {
  const derived: string[] = []
  const playable = ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(p.audioCodec ?? '')
  if (!playable || (p.format ?? '').includes('wav')) {
    await ffmpeg(
      ['-i', src, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', join(out, 'preview.m4a')],
      {
        durationSec: p.durationSec,
        onProgress: (f) => void progress(f * 0.7, 'Making the preview'),
        signal,
      },
    )
    derived.push('preview.m4a')
  }
  await writeWaveform(src, join(out, 'waveform.json'), p.durationSec ?? 0, signal)
  derived.push('waveform.json')
  return derived
}

/** Peaks for drawing: ~50 values per second (max 20k), each 0..1. */
async function writeWaveform(src: string, dest: string, duration: number, signal: AbortSignal) {
  const rate = 4000
  const pcm: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegBin(),
      ['-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1'],
      { signal },
    )
    child.stdout.on('data', (d) => pcm.push(d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`waveform ffmpeg exited ${code}`)),
    )
  })
  const buf = Buffer.concat(pcm)
  const samples = buf.length / 2
  const perSecond = Math.max(1, Math.min(50, Math.floor(20_000 / Math.max(duration, 1))))
  const buckets = Math.max(1, Math.round((samples / rate) * perSecond))
  const size = Math.max(1, Math.floor(samples / buckets))
  const peaks: number[] = []
  for (let b = 0; b < buckets; b++) {
    let max = 0
    const end = Math.min(samples, (b + 1) * size)
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(buf.readInt16LE(i * 2))
      if (v > max) max = v
    }
    peaks.push(Math.round((max / 32768) * 1000) / 1000)
  }
  await writeFile(dest, JSON.stringify({ perSecond, duration, peaks }))
}

async function processPdf(src: string, out: string) {
  const tool = ['/usr/bin/pdftoppm', '/usr/local/bin/pdftoppm'].find((p) => existsSync(p))
  if (!tool) return []
  const base = join(out, 'page')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tool, ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', src, base])
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('pdftoppm failed'))))
  })
  await sharp(`${base}.png`)
    .resize(640, 640, { fit: 'inside' })
    .webp({ quality: 80 })
    .toFile(join(out, 'thumb.webp'))
  await sharp(`${base}.png`)
    .resize(2000, 2000, { fit: 'inside' })
    .webp({ quality: 86 })
    .toFile(join(out, 'poster.webp'))
  await rm(`${base}.png`, { force: true })
  return ['thumb.webp', 'poster.webp']
}
