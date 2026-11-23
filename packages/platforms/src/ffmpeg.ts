import { planFrame, shape } from './geometry.ts'
import {
  type BitrateTier,
  EncodeOptions,
  type FfmpegPlan,
  type ImageEncode,
  type PlacementSpec,
  SourceInfo,
  type VideoEncode,
} from './types.ts'

/**
 * Turns a placement's encode preset into ffmpeg arguments for one source file.
 *
 *   const plan = ffmpegArgsFor(getPlacement('instagram.reel'), probe, { fit: 'auto' })
 *   spawn('ffmpeg', ['-hide_banner', '-y', '-i', input, ...plan.args, `out.${plan.outputExt}`])
 *
 * `args` never contain the input or output path (and need no input options), so the caller adds `-i <input>`
 * first and the output path last — or uses `ffmpegCommand(plan, input, output)`.
 *
 * Requires an ffmpeg build with libx264 (and libx265 + libzimg for HDR keep / tone mapping), like the server's.
 */
export function ffmpegArgsFor(
  spec: PlacementSpec,
  sourceInfo: SourceInfo,
  options: EncodeOptions = {},
): FfmpegPlan {
  const src = SourceInfo.parse(sourceInfo)
  const opt = EncodeOptions.parse(options)
  if (src.kind === 'image') {
    const enc = spec.encode.image
    if (!enc) throw new Error(`${spec.key} does not take pictures`)
    return imageArgs(spec, enc, src, opt)
  }
  const enc = spec.encode.video
  if (!enc) throw new Error(`${spec.key} does not take videos`)
  return videoArgs(spec, enc, src, opt)
}

/** The whole argv for spawn('ffmpeg', …). */
export function ffmpegCommand(plan: FfmpegPlan, input: string, output: string): string[] {
  return ['-hide_banner', '-y', '-i', input, ...plan.args, output]
}

type Src = ReturnType<typeof SourceInfo.parse>
type Opt = ReturnType<typeof EncodeOptions.parse>

const HDR_TO_SDR = (hdr: Src['hdr']) => {
  // Explicit input transfer when we know it, so untagged files still convert; otherwise zscale reads the frame tags.
  const tin =
    hdr === 'pq'
      ? ':tin=smpte2084:min=2020_ncl:pin=2020'
      : hdr === 'hlg'
        ? ':tin=arib-std-b67:min=2020_ncl:pin=2020'
        : ''
  return `zscale=t=linear:npl=100${tin},format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`
}

function videoArgs(spec: PlacementSpec, enc: VideoEncode, src: Src, opt: Opt): FfmpegPlan {
  const notes: string[] = []
  const isHdr = src.hdr !== false
  const keepHdr = isHdr && opt.hdr === 'keep' && enc.hdr.accepted && (src.hdr === 'pq' || src.hdr === 'hlg')
  if (isHdr && opt.hdr === 'keep' && !keepHdr) {
    notes.push(
      enc.hdr.accepted
        ? 'HDR kept only when the transfer (PQ or HLG) is known; this source is tone-mapped to SDR.'
        : `${platformName(spec)} ${spec.label} takes SDR only: HDR is tone-mapped to SDR BT.709.`,
    )
  } else if (isHdr && !keepHdr) notes.push('HDR source tone-mapped to SDR BT.709 (Hable curve).')

  // Shape and size.
  let boost: number | undefined
  if (opt.qualityBoost) {
    if (!enc.qualityBoost) notes.push(`Quality boost does nothing on ${platformName(spec)} ${spec.label}.`)
    else {
      boost = enc.qualityBoost.shortEdge
      if (Math.min(src.width, src.height) >= boost)
        notes.push('Quality boost not needed: the source is already 1440p or more.')
      else notes.push(`Quality boost: scaled up to ${boost}p. ${enc.qualityBoost.note}`)
    }
  }
  const frame = planFrame({
    spec,
    frame: enc.frame,
    width: src.width,
    height: src.height,
    fit: opt.fit,
    boostShortEdge: boost,
  })
  notes.push(...frame.notes)

  // Frame rate: keep the source's up to the platform max (exact divisors, no blending); never interpolate.
  const fpsPlan = chooseFps(src.fps, enc.fps.min, enc.fps.max)
  notes.push(...fpsPlan.notes)

  // Duration.
  let duration = src.durationSec
  const trim: string[] = []
  if (duration !== null && spec.duration) {
    if (duration > spec.duration.maxSec) {
      if (opt.trimToMax) {
        trim.push('-t', fmt(spec.duration.maxSec))
        notes.push(
          `Cut to ${spec.duration.maxSec} s, the longest ${spec.label} ${platformName(spec)} accepts.`,
        )
        duration = spec.duration.maxSec
      } else
        notes.push(
          `Longer than ${spec.duration.maxSec} s: ${platformName(spec)} will refuse it unless it is cut.`,
        )
    }
    if (duration < spec.duration.minSec)
      notes.push(`Shorter than ${spec.duration.minSec} s: ${platformName(spec)} will refuse it.`)
  }

  // Audio.
  const channels = src.audioChannels ?? 2
  const layout =
    channels === 1 ? 'mono' : channels >= 6 && enc.audio.allow51 && enc.audio.bitrate51 ? '5.1' : 'stereo'
  const audioKbps =
    src.hasAudio || enc.audio.requireTrack
      ? layout === 'mono' && src.hasAudio
        ? enc.audio.bitrateMono
        : layout === '5.1' && src.hasAudio
          ? enc.audio.bitrate51!
          : enc.audio.bitrateStereo
      : 0
  if (src.hasAudio && channels > 2 && layout === 'stereo')
    notes.push(`Audio down-mixed from ${channels} channels to stereo.`)

  // Bitrate ceiling.
  const shortEdge = Math.min(frame.width, frame.height)
  const high = (fpsPlan.fps ?? 30) > 31
  const tier = pickTier(enc.rate.tiers, shortEdge)
  let maxrate = Math.round(
    (keepHdr
      ? ((high ? tier.hdr60 : tier.hdr30) ?? (high ? tier.sdr60 : tier.sdr30) * 1.25)
      : high
        ? tier.sdr60
        : tier.sdr30) * enc.rate.ceilingFactor,
  )
  const hardMax = Math.min(enc.rate.hardMaxKbps ?? Infinity, spec.maxVideoKbps ?? Infinity)
  if (maxrate > hardMax) maxrate = Math.floor(hardMax * 0.96)
  if (spec.maxBytes.video && duration) {
    // Stay ~5% under the size limit (container overhead, VBV slack).
    const budget = Math.floor((spec.maxBytes.video * 8) / 1000 / duration / 1.05 - audioKbps)
    if (budget < maxrate) {
      maxrate = Math.max(budget, 200)
      notes.push(
        `Bitrate held to ${(maxrate / 1000).toFixed(1)} Mbps so ${fmtBytes(spec.maxBytes.video)} fits ${Math.round(duration)} s` +
          (maxrate < shortEdge * 1.5 ? ' — quality will suffer; a shorter cut would look better.' : '.'),
      )
    }
  }
  const bufsize = Math.round(maxrate * enc.rate.bufferFactor)

  // Filters.
  const vf: string[] = []
  if (src.interlaced) vf.push('bwdif=mode=send_frame')
  if (fpsPlan.expr && fpsPlan.changed) vf.push(`fps=${fpsPlan.expr}`)
  if (isHdr && !keepHdr) vf.push(HDR_TO_SDR(src.hdr))
  const flags = 'flags=lanczos+accurate_rnd+full_chroma_int'
  const pixFmt = keepHdr ? 'yuv420p10le' : 'yuv420p'
  let color = ''
  if (!keepHdr) {
    const inMatrix = isHdr
      ? 'bt709'
      : (src.colorMatrix ?? (Math.min(src.width, src.height) >= 720 ? 'bt709' : 'bt601'))
    const inRange = src.colorRange === 'pc' ? ':in_range=pc' : src.colorRange === 'tv' ? ':in_range=tv' : ''
    color = `:in_color_matrix=${inMatrix}:out_color_matrix=bt709${inRange}:out_range=tv`
    if (inMatrix !== 'bt709')
      notes.push(`Colours converted from ${inMatrix === 'bt601' ? 'BT.601' : 'BT.2020'} to BT.709.`)
  }
  vf.push(...scaleChain(frame, flags + color, opt.padColor ?? 'black'))
  // Tag the frames themselves: ffmpeg takes the colour description from the frames, not only from -color_* options.
  const tags = keepHdr
    ? `color_primaries=bt2020:color_trc=${src.hdr === 'pq' ? 'smpte2084' : 'arib-std-b67'}:colorspace=bt2020nc:range=tv`
    : 'color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'
  vf.push('setsar=1', `format=${pixFmt}`, `setparams=${tags}`)
  const recShort = Math.min(spec.resolution.recommended.width, spec.resolution.recommended.height)
  if (Math.min(frame.width, frame.height) < Math.min(recShort, 1080) * 0.7) {
    notes.push(
      `The output is only ${frame.width}×${frame.height}; ${platformName(spec)} favours ${spec.resolution.recommended.width}×${spec.resolution.recommended.height}. A larger source would look better.`,
    )
  }

  const filters = [`[0:v:0]${vf.join(',')}[v]`]
  const audioArgs: string[] = []
  if (src.hasAudio) {
    audioArgs.push('-map', '0:a:0')
  } else if (enc.audio.requireTrack) {
    filters.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000${duration ? `,atrim=duration=${fmt(duration)}` : ''}[a]`,
    )
    audioArgs.push('-map', '[a]')
    if (!duration) audioArgs.push('-shortest')
    notes.push(
      `Added a silent audio track: ${platformName(spec)} refuses silent videos when a sound is attached.`,
    )
  }
  if (audioArgs.length) {
    const ac = layout === 'mono' && src.hasAudio ? 1 : layout === '5.1' && src.hasAudio ? 6 : 2
    audioArgs.push(
      '-c:a',
      'aac',
      '-profile:a',
      'aac_low',
      '-b:a',
      `${audioKbps}k`,
      '-ar',
      String(enc.audio.sampleRate),
      '-ac',
      String(ac),
    )
  }

  const fps = fpsPlan.fps ?? 30
  const gop = Math.max(1, Math.round(fps * enc.gopSeconds))
  const preset = opt.speed === 'fast' ? 'faster' : enc.rate.preset
  const videoArgs: string[] = keepHdr
    ? hevcHdrArgs(src.hdr as 'pq' | 'hlg', {
        crf: enc.rate.crf + 1,
        preset,
        gop,
        bFrames: enc.bFrames,
        maxrate,
        bufsize,
      })
    : [
        '-c:v',
        'libx264',
        '-preset',
        preset,
        '-crf',
        String(enc.rate.crf),
        '-maxrate',
        `${maxrate}k`,
        '-bufsize',
        `${bufsize}k`,
        '-profile:v',
        enc.profile,
        '-level:v',
        h264Level(frame.width, frame.height, fps, maxrate),
        '-pix_fmt',
        pixFmt,
        '-g',
        String(gop),
        '-bf',
        String(enc.bFrames),
        '-flags',
        '+cgop',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-colorspace',
        'bt709',
        '-color_range',
        'tv',
      ]

  const args = [
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[v]',
    ...audioArgs,
    ...videoArgs,
    ...(opt.threads ? ['-threads', String(opt.threads)] : []),
    '-fps_mode',
    'cfr',
    ...trim,
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    // moov first; B-frame delay expressed with negative CTS offsets so no edit list is needed and A/V stay in sync.
    '-movflags',
    '+faststart+negative_cts_offsets',
    '-use_editlist',
    '0',
    '-f',
    enc.container === 'mov' ? 'mov' : 'mp4',
  ]
  notes.unshift(
    `${keepHdr ? 'HEVC Main10 HDR' : 'H.264 High'} ${frame.width}×${frame.height} ${fpsPlan.label}, CRF ${keepHdr ? enc.rate.crf + 1 : enc.rate.crf} ≤ ${(maxrate / 1000).toFixed(1)} Mbps, keyframe every ${enc.gopSeconds} s` +
      (audioKbps ? `, AAC ${audioKbps} kbps ${src.hasAudio ? layout : 'silent'}` : ', no audio') +
      '.',
  )
  return {
    args,
    outputExt: enc.container,
    notes,
    output: {
      kind: 'video',
      width: frame.width,
      height: frame.height,
      fps: fpsPlan.fps,
      fpsExpr: fpsPlan.expr,
      fit: frame.fit,
      hdr: keepHdr,
      videoMaxKbps: maxrate,
      audioKbps: audioKbps || null,
      maxBytes: duration ? Math.round(((maxrate + audioKbps) * 1000 * duration) / 8) : null,
    },
  }
}

function hevcHdrArgs(
  hdr: 'pq' | 'hlg',
  o: { crf: number; preset: string; gop: number; bFrames: number; maxrate: number; bufsize: number },
): string[] {
  const trc = hdr === 'pq' ? 'smpte2084' : 'arib-std-b67'
  const x265 = [
    `keyint=${o.gop}`,
    `bframes=${o.bFrames}`,
    'open-gop=0',
    `vbv-maxrate=${o.maxrate}`,
    `vbv-bufsize=${o.bufsize}`,
    'colorprim=bt2020',
    `transfer=${trc}`,
    'colormatrix=bt2020nc',
    'range=limited',
    'repeat-headers=1',
    ...(hdr === 'pq' ? ['hdr10=1', 'hdr10-opt=1'] : []),
    'log-level=error',
  ].join(':')
  return [
    '-c:v',
    'libx265',
    '-preset',
    o.preset,
    '-crf',
    String(o.crf),
    '-profile:v',
    'main10',
    '-pix_fmt',
    'yuv420p10le',
    '-tag:v',
    'hvc1',
    '-x265-params',
    x265,
    '-color_primaries',
    'bt2020',
    '-color_trc',
    trc,
    '-colorspace',
    'bt2020nc',
    '-color_range',
    'tv',
  ]
}

function scaleChain(frame: ReturnType<typeof planFrame>, scaleOpts: string, padColor: string): string[] {
  if (frame.fit === 'pad') {
    return [
      `scale=${frame.scaleWidth}:${frame.scaleHeight}:${scaleOpts}`,
      `pad=${frame.width}:${frame.height}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`,
    ]
  }
  if (frame.fit === 'crop') {
    return [
      `scale=${frame.scaleWidth}:${frame.scaleHeight}:${scaleOpts}`,
      `crop=${frame.width}:${frame.height}`,
    ]
  }
  return [`scale=${frame.width}:${frame.height}:${scaleOpts}`]
}

function imageArgs(spec: PlacementSpec, enc: ImageEncode, src: Src, opt: Opt): FfmpegPlan {
  const frame = planFrame({ spec, frame: enc.frame, width: src.width, height: src.height, fit: opt.fit })
  const notes = [
    `${enc.format.toUpperCase()} ${frame.width}×${frame.height}, quality ${enc.quality}, sRGB, metadata removed.`,
    ...frame.notes,
  ]
  const vf = scaleChain(
    frame,
    'flags=lanczos+accurate_rnd+full_chroma_int:out_range=pc',
    opt.padColor ?? enc.padColor,
  )
  const codec: string[] =
    enc.format === 'jpeg'
      ? [
          '-c:v',
          'mjpeg',
          '-q:v',
          String(jpegQscale(enc.quality)),
          '-qmin',
          '1',
          '-pix_fmt',
          enc.chroma === '4:4:4' ? 'yuvj444p' : 'yuvj420p',
        ]
      : enc.format === 'webp'
        ? ['-c:v', 'libwebp', '-quality', String(enc.quality), '-pix_fmt', 'yuv420p']
        : ['-c:v', 'png', '-pix_fmt', 'rgb24']
  notes.push(
    'ffmpeg does not convert ICC profiles: for Display P3 / Adobe RGB photos use imagePlanFor() with sharp instead.',
  )
  return {
    args: [
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-vf',
      [...vf, 'setsar=1'].join(','),
      ...codec,
      '-map_metadata',
      '-1',
      '-update',
      '1',
      '-f',
      'image2',
    ],
    outputExt: enc.format === 'jpeg' ? 'jpg' : enc.format,
    notes,
    output: {
      kind: 'image',
      width: frame.width,
      height: frame.height,
      fps: null,
      fpsExpr: null,
      fit: frame.fit,
      hdr: false,
      videoMaxKbps: null,
      audioKbps: null,
      maxBytes: spec.maxBytes.image ?? null,
    },
  }
}

/** libjpeg quality (1–100) → ffmpeg mjpeg qscale (1 best … 31). */
function jpegQscale(q: number) {
  if (q >= 95) return 1
  if (q >= 90) return 2
  if (q >= 80) return 3
  if (q >= 70) return 5
  return 8
}

// ── Frame rate ───────────────────────────────────────────────────────────

const NTSC = [24, 30, 48, 60, 120, 240]

export function chooseFps(srcFps: number | null, min: number | undefined, max: number) {
  const notes: string[] = []
  if (!srcFps || !Number.isFinite(srcFps)) {
    notes.push('Frame rate unknown: the source rate is kept as is.')
    return {
      fps: null as number | null,
      expr: null as string | null,
      changed: false,
      reduced: false,
      label: 'source fps',
      notes,
    }
  }
  let f = srcFps
  let changed = false
  if (f > max * 1.001) {
    // 120 → 60, 100 → 50, 240 → 60, 119.88 → 59.94: drop whole frames, no blending.
    const n = Math.ceil(f / max - 0.001)
    f = f / n
    changed = true
    notes.push(`${trimFps(srcFps)} fps reduced to ${trimFps(f)} fps (${platformMaxNote(max)}).`)
  } else if (min && f < min * 0.999) {
    const n = Math.ceil(min / f - 0.001)
    f = f * n
    changed = true
    notes.push(
      `${trimFps(srcFps)} fps is below the platform's ${min} fps minimum: each frame is shown ${n}× (no new frames are invented).`,
    )
  }
  const expr = fpsExpr(f)
  // Always written as a constant rate: phone clips are variable-rate, and a 29.98 report should come out at exactly 30000/1001.
  return {
    fps: eval1(expr),
    expr,
    changed: true,
    reduced: changed,
    label: `${trimFps(eval1(expr))} fps`,
    notes,
  }
}

function fpsExpr(f: number): string {
  for (const n of NTSC) {
    const ntsc = (n * 1000) / 1001
    if (Math.abs(f - ntsc) < 0.01) return `${n * 1000}/1001`
  }
  const r = Math.round(f)
  if (Math.abs(f - r) < 0.01) return String(r)
  return (Math.round(f * 1000) / 1000).toString()
}

const eval1 = (expr: string) => {
  const [a, b] = expr.split('/').map(Number)
  return b ? a! / b : a!
}
const trimFps = (f: number) => (Math.round(f * 100) / 100).toString()
const platformMaxNote = (max: number) => `the platform plays at most ${max} fps`

// ── H.264 level ──────────────────────────────────────────────────────────

/** [level, max frame size (macroblocks), max macroblocks/s, max bitrate kbps for High profile] */
const LEVELS: [string, number, number, number][] = [
  ['3.0', 1620, 40500, 12500],
  ['3.1', 3600, 108000, 17500],
  ['3.2', 5120, 216000, 25000],
  ['4.0', 8192, 245760, 25000],
  ['4.1', 8192, 245760, 62500],
  ['4.2', 8704, 522240, 62500],
  ['5.0', 22080, 589824, 168750],
  ['5.1', 36864, 983040, 300000],
  ['5.2', 36864, 2073600, 300000],
  ['6.0', 139264, 4177920, 300000],
  ['6.1', 139264, 8355840, 600000],
  ['6.2', 139264, 16711680, 1000000],
]

/** Lowest H.264 level that fits the frame size, macroblock rate and VBV ceiling. */
export function h264Level(width: number, height: number, fps: number, maxrateKbps: number): string {
  const fs = Math.ceil(width / 16) * Math.ceil(height / 16)
  const mbps = fs * fps
  const dimLimit = (maxFs: number) => Math.sqrt(maxFs * 8)
  for (const [level, maxFs, maxMbps, maxBr] of LEVELS) {
    if (
      fs <= maxFs &&
      mbps <= maxMbps &&
      maxrateKbps <= maxBr &&
      Math.max(width, height) / 16 <= dimLimit(maxFs)
    )
      return level
  }
  return '6.2'
}

function pickTier(tiers: BitrateTier[], shortEdge: number): BitrateTier {
  const sorted = [...tiers].sort((a, b) => a.shortEdge - b.shortEdge)
  return sorted.find((t) => shortEdge <= t.shortEdge * 1.05) ?? sorted[sorted.length - 1]!
}

// ── small helpers ────────────────────────────────────────────────────────

const PLATFORM_NAMES: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}
export const platformName = (spec: PlacementSpec) => PLATFORM_NAMES[spec.platform] ?? spec.platform
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString()
export function fmtBytes(n: number) {
  if (n >= 1024 ** 3) return `${Math.round((n / 1024 ** 3) * 10) / 10} GB`
  return `${Math.round(n / 1024 ** 2)} MB`
}
export { shape }
