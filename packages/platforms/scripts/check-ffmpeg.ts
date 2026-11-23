/**
 * Encodes synthetic clips with every placement preset and checks the results with ffprobe.
 *
 *   node packages/platforms/scripts/check-ffmpeg.ts [work-dir]
 *
 * Needs ffmpeg/ffprobe with libx264, libx265 and libzimg on PATH. Exits 1 when an output does not match its plan
 * (size, codec, profile, colour tags, frame rate, audio, moov first, no edit list, A/V start in sync).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type EncodeOptions,
  ffmpegArgsFor,
  ffmpegCommand,
  placements,
  type SourceInfo,
} from '../src/index.ts'

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'gl-platforms-'))
mkdirSync(join(dir, 'clips'), { recursive: true })
mkdirSync(join(dir, 'out'), { recursive: true })
const run = (bin: string, args: string[]) => spawnSync(bin, args, { encoding: 'utf8' })
const make = (file: string, args: string[]) => {
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, join(dir, 'clips', file)])
  if (r.status !== 0) throw new Error(`could not make ${file}: ${r.stderr}`)
}

// 4K 60 fps HLG (like an iPhone), 1080p25 landscape, vertical 1080×1920 mono, silent 720p120, SD BT.601, a photo.
make('hlg.mov', [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=s=2160x3840:r=60000/1001:d=3',
  '-f',
  'lavfi',
  '-i',
  'sine=f=440:d=3:sample_rate=48000',
  '-c:v',
  'libx265',
  '-preset',
  'ultrafast',
  '-pix_fmt',
  'yuv420p10le',
  '-x265-params',
  'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error',
  '-color_primaries',
  'bt2020',
  '-color_trc',
  'arib-std-b67',
  '-colorspace',
  'bt2020nc',
  '-tag:v',
  'hvc1',
  '-c:a',
  'aac',
])
make('land.mp4', [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=s=1920x1080:r=25:d=4',
  '-f',
  'lavfi',
  '-i',
  'sine=f=330:d=4:sample_rate=44100',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
])
make('vert.mp4', [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=s=1080x1920:r=30:d=4',
  '-f',
  'lavfi',
  '-i',
  'sine=f=550:d=4',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-ac',
  '1',
])
make('silent.mp4', [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=s=1280x720:r=120:d=3',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-pix_fmt',
  'yuv420p',
])
make('sd.mp4', [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=s=640x480:r=30000/1001:d=3',
  '-f',
  'lavfi',
  '-i',
  'sine=f=220:d=3',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-pix_fmt',
  'yuv420p',
  '-colorspace',
  'smpte170m',
  '-c:a',
  'aac',
])
make('photo.png', ['-f', 'lavfi', '-i', 'testsrc2=s=3000x2000:d=1', '-frames:v', '1'])

const videos: { file: string; info: SourceInfo }[] = [
  {
    file: 'hlg.mov',
    info: { width: 2160, height: 3840, fps: 59.94, durationSec: 3, hasAudio: true, hdr: 'hlg' },
  },
  { file: 'land.mp4', info: { width: 1920, height: 1080, fps: 25, durationSec: 4, hasAudio: true } },
  {
    file: 'vert.mp4',
    info: { width: 1080, height: 1920, fps: 30, durationSec: 4, hasAudio: true, audioChannels: 1 },
  },
  { file: 'silent.mp4', info: { width: 1280, height: 720, fps: 120, durationSec: 3, hasAudio: false } },
  {
    file: 'sd.mp4',
    info: { width: 640, height: 480, fps: 29.97, durationSec: 3, hasAudio: true, colorMatrix: 'bt601' },
  },
]
const jobs: { key: string; file: string; info: SourceInfo; opt: EncodeOptions }[] = []
for (const p of placements) {
  if (p.encode.video) for (const v of videos) jobs.push({ key: p.key, ...v, opt: {} })
  if (p.encode.image)
    jobs.push({ key: p.key, file: 'photo.png', info: { kind: 'image', width: 3000, height: 2000 }, opt: {} })
}
jobs.push({ key: 'youtube.video', ...videos[1]!, opt: { qualityBoost: true } })
jobs.push({ key: 'youtube.video', ...videos[0]!, opt: { hdr: 'keep' } })
jobs.push({ key: 'instagram.reel', ...videos[1]!, opt: { fit: 'crop' } })
jobs.push({ key: 'tiktok.video', ...videos[1]!, opt: { fit: 'pad' } })

let failed = 0
for (const j of jobs) {
  const spec = placements.find((p) => p.key === j.key)!
  const plan = ffmpegArgsFor(spec, j.info, j.opt)
  const tag = `${j.key}__${j.file}${Object.entries(j.opt)
    .map(([k, v]) => `__${k}-${v}`)
    .join('')}`
  const out = join(dir, 'out', `${tag}.${plan.outputExt}`)
  const r = run('ffmpeg', ['-loglevel', 'error', ...ffmpegCommand(plan, join(dir, 'clips', j.file), out)])
  if (r.status !== 0) {
    failed++
    console.log(`FAIL ${tag}\n${r.stderr.slice(-800)}`)
    continue
  }
  type Stream = Record<string, string | number | undefined> & { codec_type: string }
  const probe = JSON.parse(
    run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out]).stdout,
  ) as { streams: Stream[]; format: { bit_rate: string } }
  const v = probe.streams.find((s) => s.codec_type === 'video')!
  const a = probe.streams.find((s) => s.codec_type === 'audio')
  const o = plan.output
  const bad: string[] = []
  if (v.width !== o.width || v.height !== o.height)
    bad.push(`size ${v.width}x${v.height}, planned ${o.width}x${o.height}`)
  if (o.kind === 'video') {
    if (v.codec_name !== (o.hdr ? 'hevc' : 'h264')) bad.push(`codec ${v.codec_name}`)
    if (!o.hdr && (v.profile !== 'High' || v.pix_fmt !== 'yuv420p'))
      bad.push(`profile ${v.profile} ${v.pix_fmt}`)
    if (!o.hdr && [v.color_space, v.color_transfer, v.color_primaries].some((c) => c !== 'bt709'))
      bad.push(`colour ${v.color_space}/${v.color_transfer}/${v.color_primaries}`)
    if (o.hdr && (v.color_transfer !== 'arib-std-b67' || v.pix_fmt !== 'yuv420p10le'))
      bad.push(`hdr ${v.color_transfer} ${v.pix_fmt}`)
    if (o.fpsExpr && v.r_frame_rate !== (o.fpsExpr.includes('/') ? o.fpsExpr : `${o.fpsExpr}/1`))
      bad.push(`fps ${v.r_frame_rate}`)
    if (o.audioKbps && (a?.codec_name !== 'aac' || a?.sample_rate !== '48000'))
      bad.push(`audio ${a?.codec_name} ${a?.sample_rate}`)
    if (!o.audioKbps && a) bad.push('unexpected audio')
    const buf = readFileSync(out)
    const mdat = buf.indexOf('mdat')
    if (!(buf.indexOf('moov') > 0 && buf.indexOf('moov') < mdat)) bad.push('moov not first')
    const elst = buf.indexOf('elst')
    if (elst !== -1 && elst < mdat) bad.push('edit list')
    if (a && Math.abs(Number(v.start_time) - Number(a.start_time)) > 0.001)
      bad.push(`A/V start ${v.start_time} vs ${a.start_time}`)
  }
  if (bad.length) failed++
  console.log(
    `${bad.length ? 'BAD ' : 'ok  '} ${tag.padEnd(60)} ${v.width}x${v.height} ${v.r_frame_rate ?? ''} ${Math.round(Number(probe.format.bit_rate) / 1000)} kbps ${bad.join('; ')}`,
  )
}
console.log(
  failed
    ? `${failed} of ${jobs.length} failed (outputs in ${dir}/out)`
    : `all ${jobs.length} outputs match their plans (${dir}/out)`,
)
process.exit(failed ? 1 : 0)
