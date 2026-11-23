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

    if (kind === 'image' && format.role === 'depth') {
      // EXR depth mostly comes from renders' Z passes: distance, so the near end is dark.
      const nearGuess = format.mime === 'image/x-exr' ? 'dark' : 'light'
      const kept = depthMetaOf(format.meta)
      const r = await processDepthImage(src, out, { near: kept.near ?? nearGuess })
      info = {
        width: r.width,
        height: r.height,
        meta: {
          ...kept,
          nearGuess,
          bitDepth: r.bitDepth,
          float: r.float,
          range: r.range,
          curve: r.curve,
        },
      }
      derived.push(...r.derived)
    } else if (kind === 'image') {
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
          ...(format.role === 'depth'
            ? {
                ...depthMetaOf(format.meta),
                bitDepth: bitDepthOf(p.pixFmt),
                float: /f(16|32)/.test(p.pixFmt ?? ''),
              }
            : {}),
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
      // A depth map or a sound file says nothing about when and where the picture was taken.
      const own = format.role === 'format'
      if (own && !m.takenAt && takenAt && !Number.isNaN(takenAt.getTime()) && takenAt.getFullYear() > 1980)
        patch.takenAt = takenAt
      if (Object.keys(patch).length) await ctx.db.update(media).set(patch).where(eq(media.id, m.id))
      if (location && own)
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

/** Longest side of a depth map picture's preview. */
const DEPTH_MAX = 2400

/** What a depth map's row keeps across new files: the near end the user chose. */
function depthMetaOf(meta: unknown): { near?: 'light' | 'dark' } {
  const near = (meta as { near?: unknown } | null)?.near
  return near === 'light' || near === 'dark' ? { near } : {}
}

/** Bits per value of a pixel format: gray16le → 16, yuv420p10le → 10, grayf32le → 32, yuv420p → 8. */
function bitDepthOf(pixFmt: string | null) {
  if (!pixFmt) return null
  if (/^(rgb|bgr)a?(48|64)/.test(pixFmt)) return 16
  const m = /(?:p|gray|f)(\d{2})(?:le|be)?$/.exec(pixFmt)
  return m ? Number(m[1]) : 8
}

/**
 * A depth map picture: its values (8 or 16 bit, or floating point from EXR, PFM or TIFF, in metres or anything else)
 * are stretched over the range they use into a grey preview (thumb.webp, poster.webp), so a 16-bit map in
 * millimetres or an EXR in metres reads like any other. Distances (`near` dark) that span a lot (a room and the
 * sky) are spread on a log scale, as eyes see depth, so near things don't all crush into black. The file itself
 * stays as it is, and the preview keeps its convention (near stays dark).
 */
export async function processDepthImage(src: string, out: string, opts: { near?: 'light' | 'dark' } = {}) {
  const plane = await readDepthPlane(src)
  const { width, height, values } = plane
  const range = depthRange(values)
  const [lo, hi] = range
  const curve = opts.near === 'dark' && lo > 0 && hi / lo > 3 ? 'log' : 'linear'
  const span = hi - lo || 1
  const logLo = Math.log(lo)
  const logSpan = Math.log(hi) - logLo || 1
  const level =
    curve === 'log'
      ? (v: number) => (Math.log(Math.max(v, lo)) - logLo) / logSpan
      : (v: number) => (v - lo) / span
  const px = Buffer.alloc(width * height)
  for (let i = 0; i < px.length; i++) {
    const v = values[i]!
    // Beyond the range: clamp. Infinity (the sky in a Z pass) is the far end of the scale.
    px[i] = Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, level(v))) * 255) : v > 0 ? 255 : 0
  }
  const grey = sharp(px, { raw: { width, height, channels: 1 } })
  await grey
    .clone()
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(join(out, 'thumb.webp'))
  // Lossless: smooth gradients band in lossy WebP, and the 3D view reads these values.
  await grey.clone().webp({ lossless: true, effort: 3 }).toFile(join(out, 'poster.webp'))
  return {
    width: plane.fullWidth,
    height: plane.fullHeight,
    bitDepth: plane.bitDepth,
    float: plane.float,
    range: [round(lo), round(hi)] as [number, number],
    curve,
    derived: ['thumb.webp', 'poster.webp'],
  }
}

const round = (v: number) => Number(v.toPrecision(6))

/**
 * The values of a depth map picture, at most DEPTH_MAX on its longest side: integers through sharp (keeping 16 bits),
 * floating point (EXR, PFM, float TIFF) through ffmpeg's own decoder (its scaler would clip floats to 0..1).
 */
async function readDepthPlane(src: string): Promise<{
  values: ArrayLike<number>
  width: number
  height: number
  fullWidth: number
  fullHeight: number
  bitDepth: number | null
  float: boolean
}> {
  const meta = await sharp(src, { failOn: 'none' })
    .metadata()
    .catch(() => null)
  if (meta?.width && meta.height && ['uchar', 'char', 'ushort', 'short'].includes(meta.depth ?? '')) {
    const wide = meta.depth === 'ushort' || meta.depth === 'short'
    const { data, info } = await sharp(src, { failOn: 'none' })
      .rotate()
      .removeAlpha()
      .resize(DEPTH_MAX, DEPTH_MAX, { fit: 'inside', withoutEnlargement: true })
      .toColourspace(wide ? 'grey16' : 'b-w')
      .raw({ depth: wide ? 'ushort' : 'uchar' })
      .toBuffer({ resolveWithObject: true })
    const all = wide
      ? new Uint16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length))
      : new Uint8Array(data)
    const values = info.channels === 1 ? all : all.filter((_, i) => i % info.channels === 0)
    const rotated = (meta.orientation ?? 1) >= 5
    return {
      values,
      width: info.width,
      height: info.height,
      fullWidth: rotated ? meta.height : meta.width,
      fullHeight: rotated ? meta.width : meta.height,
      bitDepth: wide ? 16 : 8,
      float: false,
    }
  }
  const p = await probe(src)
  if (!p.width || !p.height) throw new Error('Not a picture Greenlit can read as a depth map')
  const w = p.width
  const h = p.height
  const fmt = p.pixFmt ?? ''
  if (/f(16|32)/.test(fmt)) {
    if (w * h > 80_000_000) throw new Error('This depth map is too large to preview')
    // Planar floats: the first plane is the grey one (or green, the same values in a grey picture saved as RGB).
    const { stdout } = await ffmpeg(['-i', src, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'])
    const n = w * h
    if (stdout.length < n * 4) throw new Error('The depth map could not be decoded')
    const view = new DataView(stdout.buffer, stdout.byteOffset, n * 4)
    const le = !fmt.endsWith('be')
    const full = new Float32Array(n)
    for (let i = 0; i < n; i++) full[i] = view.getFloat32(i * 4, le)
    return { ...shrink(full, w, h), fullWidth: w, fullHeight: h, bitDepth: null, float: true }
  }
  // Another integer picture sharp can't read: 16-bit grey from ffmpeg.
  const scale = Math.min(1, DEPTH_MAX / Math.max(w, h))
  const ow = Math.max(1, Math.round(w * scale))
  const oh = Math.max(1, Math.round(h * scale))
  const { stdout } = await ffmpeg([
    '-i',
    src,
    '-frames:v',
    '1',
    '-vf',
    `scale=${ow}:${oh}:flags=area`,
    '-pix_fmt',
    'gray16le',
    '-f',
    'rawvideo',
    'pipe:1',
  ])
  const values = new Uint16Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + ow * oh * 2))
  return {
    values,
    width: ow,
    height: oh,
    fullWidth: w,
    fullHeight: h,
    bitDepth: bitDepthOf(fmt),
    float: false,
  }
}

/** Box-averages a float plane down to DEPTH_MAX on its longest side (non-finite values only where nothing else is). */
function shrink(src: Float32Array, w: number, h: number) {
  const f = Math.ceil(Math.max(w, h) / DEPTH_MAX)
  if (f <= 1) return { values: src, width: w, height: h }
  const ow = Math.floor(w / f)
  const oh = Math.floor(h / f)
  const out = new Float32Array(ow * oh)
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      let sum = 0
      let n = 0
      let other = 0
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const v = src[(y * f + dy) * w + x * f + dx]!
          if (Number.isFinite(v)) {
            sum += v
            n++
          } else other = v
        }
      out[y * ow + x] = n ? sum / n : other
    }
  return { values: out, width: ow, height: oh }
}

/**
 * The range a depth map's values use, without stray pixels: the 0.1st to 99.9th percentile of its finite values
 * (from a sample of at most 250 000).
 */
export function depthRange(values: ArrayLike<number>): [number, number] {
  const step = Math.max(1, Math.floor(values.length / 250_000))
  const sample: number[] = []
  for (let i = 0; i < values.length; i += step) {
    const v = values[i]!
    if (Number.isFinite(v)) sample.push(v)
  }
  if (!sample.length) return [0, 1]
  sample.sort((a, b) => a - b)
  const at = (q: number) =>
    sample[Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))))]!
  const lo = at(0.001)
  const hi = at(0.999)
  return hi > lo ? [lo, hi] : [sample[0]!, sample.at(-1)! > sample[0]! ? sample.at(-1)! : sample[0]! + 1]
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
