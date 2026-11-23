import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ffmpeg } from '../../lib/ffmpeg.ts'

/**
 * Previews of the platforms' sounds: the audio the composer plays before and after a sound is chosen, and its
 * waveform. A driver says where a sound's audio is (`Driver.soundAudio`, else the track's own preview address);
 * ffmpeg reads up to PREVIEW_MAX_SECONDS of it into an AAC file under DATA_DIR/cache/sounds/<platform>/, with the
 * waveform's peaks beside it. Only for listening: the platform attaches its own sound to the post.
 */

export const PREVIEW_MAX_SECONDS = 300
export const PEAKS_PER_SECOND = 20
const PEAK_RATE = 8000
const KEEP_FILES = 400

/** Where a sound's audio can be read: an https address on one of the platforms' media hosts. */
export interface SoundSource {
  url: string
  /** Where in the track the audio at `url` starts, seconds (a platform's preview may be a clip of it). */
  offset?: number
  /** The whole track's length, seconds, when known. */
  length?: number | null
}

export interface SoundPreview {
  file: string
  /** Seconds of audio in the file. */
  duration: number
  /** Where in the track the file starts, seconds. */
  offset: number
  /** The track's length when the platform says, else null. */
  length: number | null
  /** 0..100, PEAKS_PER_SECOND of them per second of the file. */
  peaks: number[]
  peaksPerSecond: number
}

/** Media hosts of the platforms: previews are read from these only. */
export const PREVIEW_HOSTS = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokv.com',
  'tiktokv.us',
  'ibyteimg.com',
  'byteoversea.com',
  'muscdn.com',
  'fbcdn.net',
  'cdninstagram.com',
  'googlevideo.com',
  'ytimg.com',
  'ggpht.com',
]

export function previewHostOk(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (
      u.protocol === 'https:' && PREVIEW_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
    )
  } catch {
    return false
  }
}

/**
 * Peaks of 16-bit mono PCM for drawing: the loudness (RMS) of each slice, scaled so the loudest 2% reach the top
 * (one click does not flatten the rest), 0..100.
 */
export function peaksOf(pcm: Buffer, rate = PEAK_RATE, perSecond = PEAKS_PER_SECOND): number[] {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  const step = Math.max(1, Math.round(rate / perSecond))
  const rms: number[] = []
  for (let i = 0; i < samples.length; i += step) {
    const end = Math.min(samples.length, i + step)
    let sum = 0
    for (let j = i; j < end; j++) sum += samples[j]! * samples[j]!
    rms.push(Math.sqrt(sum / Math.max(1, end - i)))
  }
  const sorted = [...rms].sort((a, b) => a - b)
  const top = Math.max(1, sorted[Math.floor(sorted.length * 0.98)] ?? 1)
  return rms.map((v) => Math.round(Math.min(1, v / top) ** 0.8 * 100))
}

const safeName = (trackId: string) => {
  const plain = trackId.replace(/[^\w.-]/g, '_').slice(0, 80)
  return plain === trackId
    ? plain
    : `${plain}-${createHash('sha1').update(trackId).digest('hex').slice(0, 10)}`
}

export class SoundPreviews {
  private dir: string
  private running = new Map<string, Promise<SoundPreview>>()

  constructor(dir: string) {
    this.dir = dir
  }

  /** The sound's preview, made on first use from what `resolve` says (then kept on disk). */
  get(platform: string, trackId: string, resolve: () => Promise<SoundSource | null>): Promise<SoundPreview> {
    const key = `${platform}/${safeName(trackId)}`
    const running = this.running.get(key)
    if (running) return running
    const work = this.make(platform, key, resolve).finally(() => this.running.delete(key))
    this.running.set(key, work)
    return work
  }

  private async make(platform: string, key: string, resolve: () => Promise<SoundSource | null>) {
    const file = join(this.dir, `${key}.m4a`)
    const meta = join(this.dir, `${key}.json`)
    if (existsSync(file) && existsSync(meta)) {
      try {
        return { ...(JSON.parse(await readFile(meta, 'utf8')) as Omit<SoundPreview, 'file'>), file }
      } catch {
        // made again below
      }
    }
    const src = await resolve()
    if (!src) throw new Error('The platform gives no audio for this sound')
    if (!previewHostOk(src.url)) throw new Error('The sound’s audio is not on a platform media host')
    await mkdir(join(this.dir, platform), { recursive: true })
    const tmp = `${file}.${process.pid}.part.m4a`
    try {
      // https only: ffmpeg follows nothing to a local file or another protocol.
      await ffmpeg([
        '-v',
        'error',
        '-protocol_whitelist',
        'https,tls,tcp',
        '-i',
        src.url,
        '-t',
        String(PREVIEW_MAX_SECONDS),
        '-vn',
        '-ac',
        '2',
        '-ar',
        '44100',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        tmp,
      ])
      await rename(tmp, file)
    } catch (err) {
      await rm(tmp, { force: true })
      throw new Error(`The sound’s audio could not be read (${(err as Error).message.split('\n')[0]})`)
    }
    const { stdout } = await ffmpeg([
      '-v',
      'error',
      '-i',
      file,
      '-ac',
      '1',
      '-ar',
      String(PEAK_RATE),
      '-f',
      's16le',
      'pipe:1',
    ])
    const preview: Omit<SoundPreview, 'file'> = {
      duration: Math.round((stdout.length / 2 / PEAK_RATE) * 1000) / 1000,
      offset: src.offset ?? 0,
      length: src.length ?? null,
      peaks: peaksOf(stdout),
      peaksPerSecond: PEAKS_PER_SECOND,
    }
    await writeFile(meta, JSON.stringify(preview))
    void this.prune(platform)
    return { ...preview, file }
  }

  /** Keeps the newest KEEP_FILES previews of a platform. */
  private async prune(platform: string) {
    const dir = join(this.dir, platform)
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.m4a'))
    if (names.length <= KEEP_FILES) return
    const dated = await Promise.all(
      names.map(async (n) => ({ n, at: (await stat(join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })),
    )
    dated.sort((a, b) => a.at - b.at)
    for (const { n } of dated.slice(0, dated.length - KEEP_FILES)) {
      await rm(join(dir, n), { force: true })
      await rm(join(dir, n.replace(/\.m4a$/, '.json')), { force: true })
    }
  }
}
