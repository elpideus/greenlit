import { spawn } from 'node:child_process'

export interface ProbeResult {
  durationSec: number | null
  width: number | null
  height: number | null
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  hasVideo: boolean
  hasAudio: boolean
  rotation: number
  pixFmt: string | null
  colorTransfer: string | null
  /** YCbCr matrix (ffprobe color_space) and range, when the file says. */
  colorMatrix: 'bt709' | 'bt601' | 'bt2020' | null
  colorRange: 'tv' | 'pc' | null
  audioChannels: number | null
  bitrate: number | null
  createdAt: string | null
  location: { lat: number; lng: number } | null
  format: string | null
  raw: unknown
}

let FFMPEG = 'ffmpeg'
let FFPROBE = 'ffprobe'
export function configureFfmpeg(ffmpeg: string, ffprobe: string) {
  FFMPEG = ffmpeg
  FFPROBE = ffprobe
}
export const ffmpegBin = () => FFMPEG

function run(
  bin: string,
  args: string[],
  opts: { signal?: AbortSignal; onStderr?: (line: string) => void } = {},
) {
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: opts.signal })
    const out: Buffer[] = []
    let err = ''
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      err = (err + s).slice(-20_000)
      if (opts.onStderr) for (const line of s.split(/\r|\n/)) if (line) opts.onStderr(line)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err })
      else reject(new Error(`${bin} exited with ${code}: ${err.split('\n').slice(-6).join('\n')}`))
    })
  })
}

function parseRate(r?: string): number | null {
  if (!r || r === '0/0') return null
  const [a, b] = r.split('/').map(Number)
  if (!a || !b) return null
  return Math.round((a / b) * 1000) / 1000
}

/** ISO 6709 location as written by phones: +40.7578-073.9857+010.000/ */
function parseIso6709(s?: string): { lat: number; lng: number } | null {
  if (!s) return null
  const m = s.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ])
  // biome-ignore lint/suspicious/noExplicitAny: ffprobe JSON
  const j = JSON.parse(stdout.toString()) as any
  // biome-ignore lint/suspicious/noExplicitAny: ffprobe JSON
  const streams: any[] = j.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const a = streams.find((s) => s.codec_type === 'audio')
  const sideRot = v?.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation
  const rotation = Math.abs(Number(v?.tags?.rotate ?? sideRot ?? 0)) % 360
  let width = v?.width ?? null
  let height = v?.height ?? null
  if (rotation === 90 || rotation === 270) [width, height] = [height, width]
  const duration = Number(j.format?.duration ?? v?.duration ?? a?.duration)
  const tags = { ...(j.format?.tags ?? {}) }
  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    width,
    height,
    fps: parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate),
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    hasVideo: !!v,
    hasAudio: !!a,
    rotation,
    pixFmt: v?.pix_fmt ?? null,
    colorTransfer: v?.color_transfer ?? null,
    colorMatrix:
      v?.color_space === 'bt709'
        ? 'bt709'
        : ['bt470bg', 'smpte170m', 'bt601'].includes(v?.color_space)
          ? 'bt601'
          : String(v?.color_space ?? '').startsWith('bt2020')
            ? 'bt2020'
            : null,
    colorRange:
      v?.color_range === 'pc' || /^yuvj/.test(v?.pix_fmt ?? '')
        ? 'pc'
        : v?.color_range === 'tv'
          ? 'tv'
          : null,
    audioChannels: a?.channels ?? null,
    bitrate: j.format?.bit_rate ? Number(j.format.bit_rate) : null,
    createdAt: tags.creation_time ?? tags['com.apple.quicktime.creationdate'] ?? null,
    location: parseIso6709(tags.location ?? tags['com.apple.quicktime.location.ISO6709']),
    format: j.format?.format_name ?? null,
    raw: j,
  }
}

/**
 * Runs ffmpeg and reports progress (0..1) from its `-progress` output when the duration is known.
 */
export async function ffmpeg(
  args: string[],
  opts: { durationSec?: number | null; onProgress?: (f: number) => void; signal?: AbortSignal } = {},
) {
  const withProgress = opts.onProgress && opts.durationSec ? ['-progress', 'pipe:2', '-nostats'] : []
  return run(FFMPEG, ['-hide_banner', '-y', ...withProgress, ...args], {
    signal: opts.signal,
    onStderr:
      opts.onProgress && opts.durationSec
        ? (line) => {
            const m = line.match(/^out_time_us=(\d+)/)
            if (m) opts.onProgress!(Math.min(1, Number(m[1]) / 1e6 / opts.durationSec!))
          }
        : undefined,
  })
}

/** HDR (PQ/HLG) needs tone mapping before it looks right in SDR previews. */
export function isHdr(p: ProbeResult) {
  return p.colorTransfer === 'smpte2084' || p.colorTransfer === 'arib-std-b67'
}

/** A filter that turns HDR into SDR BT.709 with a pleasant tone curve (zscale+tonemap). */
export const HDR_TO_SDR =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'

let encoders: Set<string> | null = null
export async function availableEncoders(): Promise<Set<string>> {
  if (encoders) return encoders
  try {
    const { stdout } = await run(FFMPEG, ['-hide_banner', '-encoders'])
    encoders = new Set(
      stdout
        .toString()
        .split('\n')
        .map((l) => l.trim().split(/\s+/)[1])
        .filter((x): x is string => !!x),
    )
  } catch {
    encoders = new Set()
  }
  return encoders
}

let filters: Set<string> | null = null
export async function availableFilters(): Promise<Set<string>> {
  if (filters) return filters
  try {
    const { stdout } = await run(FFMPEG, ['-hide_banner', '-filters'])
    filters = new Set(
      stdout
        .toString()
        .split('\n')
        .map((l) => l.trim().split(/\s+/)[1])
        .filter((x): x is string => !!x),
    )
  } catch {
    filters = new Set()
  }
  return filters
}
