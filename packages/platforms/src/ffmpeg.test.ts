import { describe, expect, it } from 'vitest'
import { chooseFps, ffmpegArgsFor, ffmpegCommand, getPlacement, h264Level, imagePlanFor } from './index.ts'

/** Value following a flag (`-crf 18` → '18'). */
const arg = (args: string[], flag: string) => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}
const graph = (args: string[]) => arg(args, '-filter_complex') ?? ''

const iphone4k60hdr = {
  width: 2160,
  height: 3840,
  fps: 59.94,
  durationSec: 20,
  hasAudio: true,
  hdr: 'hlg' as const,
}
const hd25 = { width: 1920, height: 1080, fps: 25, durationSec: 30, hasAudio: true, hdr: false }
const vertical = { width: 1080, height: 1920, fps: 30, durationSec: 15, hasAudio: true, hdr: false }

describe('ffmpegArgsFor', () => {
  it('4K 60 fps HDR iPhone video → Instagram Reel: 1080×1920 SDR, 59.94 fps, ≤ 25 Mbps, AAC 128k', () => {
    const plan = ffmpegArgsFor(getPlacement('instagram.reel'), iphone4k60hdr)
    const { args } = plan
    expect(plan.outputExt).toBe('mp4')
    expect(plan.output).toMatchObject({
      width: 1080,
      height: 1920,
      fpsExpr: '60000/1001',
      fit: 'keep',
      hdr: false,
    })
    expect(graph(args)).toContain('fps=60000/1001')
    expect(graph(args)).toContain('tonemap=tonemap=hable')
    expect(graph(args)).toContain('tin=arib-std-b67')
    expect(graph(args)).toContain('scale=1080:1920:')
    expect(graph(args)).toContain('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv')
    expect(arg(args, '-c:v')).toBe('libx264')
    expect(arg(args, '-profile:v')).toBe('high')
    expect(arg(args, '-level:v')).toBe('4.2')
    expect(arg(args, '-pix_fmt')).toBe('yuv420p')
    expect(Number.parseInt(arg(args, '-maxrate')!, 10)).toBeLessThanOrEqual(25_000)
    expect(arg(args, '-g')).toBe('120') // 2 s closed GOP
    expect(arg(args, '-flags')).toBe('+cgop')
    expect(arg(args, '-b:a')).toBe('128k')
    expect(arg(args, '-ar')).toBe('48000')
    expect(arg(args, '-movflags')).toContain('+faststart')
    expect(arg(args, '-use_editlist')).toBe('0')
    expect(plan.notes.join(' ')).toMatch(/tone-mapped/)
  })

  it('1080p 25 fps → YouTube video: kept at 1080p, half-second GOP, ceiling 2× the published 8 Mbps', () => {
    const { args, output } = ffmpegArgsFor(getPlacement('youtube.video'), hd25)
    expect(output).toMatchObject({
      width: 1920,
      height: 1080,
      fpsExpr: '25',
      videoMaxKbps: 16_000,
      audioKbps: 384,
    })
    expect(arg(args, '-crf')).toBe('17')
    expect(arg(args, '-g')).toBe('13') // 25 fps / 2
    expect(arg(args, '-bf')).toBe('2')
    expect(arg(args, '-level:v')).toBe('4.0')
    expect(arg(args, '-b:a')).toBe('384k')
    expect(graph(args)).not.toContain('tonemap')
    expect(graph(args)).not.toContain('pad=')
  })

  it('1080p 25 fps → YouTube with qualityBoost: upscaled to 1440p with the 1440p ceiling', () => {
    const plan = ffmpegArgsFor(getPlacement('youtube.video'), hd25, { qualityBoost: true })
    expect(plan.output).toMatchObject({ width: 2560, height: 1440, videoMaxKbps: 32_000 })
    expect(graph(plan.args)).toContain('scale=2560:1440:flags=lanczos')
    expect(arg(plan.args, '-level:v')).toBe('5.0')
    expect(plan.notes.join(' ')).toMatch(/1080p Premium/)
  })

  it('qualityBoost is ignored where the platform has no such behaviour', () => {
    const plan = ffmpegArgsFor(getPlacement('tiktok.video'), hd25, { qualityBoost: true })
    expect(plan.output.width).toBe(1920)
    expect(plan.notes.join(' ')).toMatch(/does nothing/)
  })

  it('vertical 1080×1920 → TikTok: untouched shape, 30 fps, mono kept', () => {
    const { args, output } = ffmpegArgsFor(getPlacement('tiktok.video'), { ...vertical, audioChannels: 1 })
    expect(output).toMatchObject({ width: 1080, height: 1920, fpsExpr: '30', fit: 'keep' })
    expect(graph(args)).not.toMatch(/pad=|crop=/)
    expect(arg(args, '-g')).toBe('60')
    expect(arg(args, '-ac')).toBe('1')
    expect(arg(args, '-level:v')).toBe('4.0')
  })

  it('never contains the input or output path', () => {
    const plan = ffmpegArgsFor(getPlacement('facebook.reel'), vertical)
    expect(plan.args).not.toContain('-i')
    expect(ffmpegCommand(plan, 'in.mov', 'out.mp4')).toEqual([
      '-hide_banner',
      '-y',
      '-i',
      'in.mov',
      ...plan.args,
      'out.mp4',
    ])
  })

  it('pads or crops to the recommended shape on request', () => {
    const pad = ffmpegArgsFor(getPlacement('tiktok.video'), hd25, { fit: 'pad' })
    expect(pad.output).toMatchObject({ width: 1080, height: 1920, fit: 'pad' })
    expect(graph(pad.args)).toContain('scale=1080:608:')
    expect(graph(pad.args)).toContain('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black')
    const crop = ffmpegArgsFor(getPlacement('instagram.reel'), hd25, { fit: 'crop' })
    expect(crop.output).toMatchObject({ width: 608, height: 1080, fit: 'crop' }) // never upscaled
    expect(graph(crop.args)).toContain('crop=608:1080')
  })

  it('pads shapes a placement refuses: 16:9 → Short becomes 9:16, 9:16 → Instagram feed becomes 4:5', () => {
    expect(ffmpegArgsFor(getPlacement('youtube.short'), hd25).output).toMatchObject({
      width: 1080,
      height: 1920,
      fit: 'pad',
    })
    expect(ffmpegArgsFor(getPlacement('instagram.feed'), vertical).output).toMatchObject({
      width: 1080,
      height: 1350,
      fit: 'pad',
    })
  })

  it('reduces 120 fps by whole frames and adds a silent track for Instagram reels', () => {
    const plan = ffmpegArgsFor(getPlacement('instagram.reel'), {
      width: 1280,
      height: 720,
      fps: 120,
      durationSec: 5,
      hasAudio: false,
    })
    expect(plan.output.fpsExpr).toBe('60')
    expect(graph(plan.args)).toContain('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=5[a]')
    expect(plan.args).toContain('[a]')
    // Stories don't need one.
    const story = ffmpegArgsFor(getPlacement('instagram.story'), {
      width: 1280,
      height: 720,
      fps: 30,
      durationSec: 5,
      hasAudio: false,
    })
    expect(story.args).not.toContain('-c:a')
  })

  it('holds the bitrate down so a long reel fits Instagram’s 300 MB', () => {
    const plan = ffmpegArgsFor(getPlacement('instagram.reel'), { ...vertical, durationSec: 14 * 60 })
    expect(plan.output.maxBytes!).toBeLessThanOrEqual(300 * 1024 * 1024)
    expect(plan.notes.join(' ')).toMatch(/fits/)
  })

  it('trims to the maximum only when asked', () => {
    const long = { ...vertical, durationSec: 200 }
    expect(ffmpegArgsFor(getPlacement('youtube.short'), long).args).not.toContain('-t')
    expect(arg(ffmpegArgsFor(getPlacement('youtube.short'), long, { trimToMax: true }).args, '-t')).toBe(
      '180',
    )
  })

  it('keeps HDR for YouTube on request (HEVC Main10, HLG tags) and tone-maps elsewhere', () => {
    const yt = ffmpegArgsFor(getPlacement('youtube.video'), iphone4k60hdr, { hdr: 'keep' })
    expect(yt.output.hdr).toBe(true)
    expect(arg(yt.args, '-c:v')).toBe('libx265')
    expect(arg(yt.args, '-color_trc')).toBe('arib-std-b67')
    expect(yt.output.videoMaxKbps).toBe(170_000) // 85 Mbps HDR 2160p60 × 2
    const ig = ffmpegArgsFor(getPlacement('instagram.reel'), iphone4k60hdr, { hdr: 'keep' })
    expect(ig.output.hdr).toBe(false)
    expect(graph(ig.args)).toContain('tonemap')
  })

  it('converts SD BT.601 colours to BT.709 and full range to limited', () => {
    const plan = ffmpegArgsFor(getPlacement('youtube.video'), {
      width: 640,
      height: 480,
      fps: 29.97,
      durationSec: 3,
      colorRange: 'pc',
    })
    expect(graph(plan.args)).toContain(
      'in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv',
    )
    expect(plan.output.fpsExpr).toBe('30000/1001')
  })

  it('makes JPEGs for pictures', () => {
    const plan = ffmpegArgsFor(getPlacement('instagram.feed'), { kind: 'image', width: 4032, height: 3024 })
    expect(plan.outputExt).toBe('jpg')
    expect(plan.output).toMatchObject({ width: 1440, height: 1080 })
    expect(arg(plan.args, '-c:v')).toBe('mjpeg')
    expect(arg(plan.args, '-map_metadata')).toBe('-1')
    expect(() =>
      ffmpegArgsFor(getPlacement('instagram.reel'), { kind: 'image', width: 100, height: 100 }),
    ).toThrow()
  })
})

describe('imagePlanFor', () => {
  it('crops a 9:16 photo for the Instagram feed and pads it for a Facebook story', () => {
    expect(imagePlanFor(getPlacement('instagram.feed'), { width: 1080, height: 1920 })).toMatchObject({
      width: 1080,
      height: 1350,
      fit: 'crop',
      resize: { fit: 'cover' },
      format: 'jpeg',
    })
    expect(imagePlanFor(getPlacement('facebook.story'), { width: 3000, height: 2000 })).toMatchObject({
      width: 1080,
      height: 1920,
      resize: { fit: 'contain', background: '#000000' },
    })
  })
})

describe('chooseFps / h264Level', () => {
  it('keeps the source rate, divides when too high, repeats frames when too low', () => {
    expect(chooseFps(23.976, 23, 60).expr).toBe('24000/1001')
    expect(chooseFps(119.88, 23, 60).expr).toBe('60000/1001')
    expect(chooseFps(240, 23, 60).expr).toBe('60')
    expect(chooseFps(100, undefined, 60).expr).toBe('50')
    expect(chooseFps(15, 23, 60).expr).toBe('30')
    expect(chooseFps(null, 23, 60).expr).toBeNull()
  })
  it('picks the lowest level that fits', () => {
    expect(h264Level(1920, 1080, 30, 16_000)).toBe('4.0')
    expect(h264Level(1080, 1920, 60, 20_000)).toBe('4.2')
    expect(h264Level(2560, 1440, 60, 48_000)).toBe('5.1')
    expect(h264Level(3840, 2160, 60, 136_000)).toBe('5.2')
    expect(h264Level(7680, 4320, 30, 320_000)).toBe('6.1')
  })
})
