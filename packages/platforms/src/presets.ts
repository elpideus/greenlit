import type { BitrateTier, ImageEncodeInput, VideoEncodeInput } from './types.ts'

/**
 * Building blocks shared by the platform files. Values that come from a platform's documentation are
 * repeated in that platform's file; what lives here are Greenlit's own quality choices (CRF, presets,
 * ceilings), explained in README.md → "Encoding choices".
 */

const MB = 1024 * 1024
export const bytes = { MB, GB: 1024 * MB }

/**
 * YouTube's published recommended upload bitrates (SDR and HDR), kbps, from "Recommended upload encoding
 * settings" (support.google.com/youtube/answer/1722171, checked 2026-11-21). For 2160p and 8K the table
 * gives a range; this is the top of it.
 */
export const youtubeTable: BitrateTier[] = [
  { shortEdge: 360, sdr30: 1_000, sdr60: 1_500 },
  { shortEdge: 480, sdr30: 2_500, sdr60: 4_000 },
  { shortEdge: 720, sdr30: 5_000, sdr60: 7_500, hdr30: 6_500, hdr60: 9_500 },
  { shortEdge: 1080, sdr30: 8_000, sdr60: 12_000, hdr30: 10_000, hdr60: 15_000 },
  { shortEdge: 1440, sdr30: 16_000, sdr60: 24_000, hdr30: 20_000, hdr60: 30_000 },
  { shortEdge: 2160, sdr30: 45_000, sdr60: 68_000, hdr30: 56_000, hdr60: 85_000 },
  { shortEdge: 4320, sdr30: 160_000, sdr60: 240_000, hdr30: 200_000, hdr60: 300_000 },
]

/**
 * Ceilings for the social apps (Instagram, Facebook, TikTok). They all re-encode to a few Mbps, so the goal is a
 * near-transparent mezzanine: CRF decides quality, these only stop pathological peaks and keep files small
 * enough to upload quickly. Kept under Instagram's 25 Mbps hard limit.
 */
export const socialTiers: BitrateTier[] = [
  { shortEdge: 480, sdr30: 4_000, sdr60: 5_000 },
  { shortEdge: 720, sdr30: 9_000, sdr60: 12_000 },
  { shortEdge: 1080, sdr30: 16_000, sdr60: 20_000 },
  { shortEdge: 1440, sdr30: 20_000, sdr60: 24_000 },
]

type VideoOverrides = Partial<Omit<VideoEncodeInput, 'frame' | 'rate' | 'audio' | 'fps' | 'hdr'>> & {
  frame: VideoEncodeInput['frame']
  fps: VideoEncodeInput['fps']
  rate?: Partial<VideoEncodeInput['rate']>
  audio?: Partial<VideoEncodeInput['audio']>
  hdr?: VideoEncodeInput['hdr']
}

/** H.264 High, BT.709, closed 2 s GOPs, 2 B-frames, AAC-LC 48 kHz, fast start — what every social app ingests best. */
export function socialVideo(o: VideoOverrides): VideoEncodeInput {
  return {
    container: 'mp4',
    codec: 'h264',
    profile: 'high',
    pixelFormat: 'yuv420p',
    color: 'bt709',
    gopSeconds: 2,
    bFrames: 2,
    faststart: true,
    ...o,
    frame: o.frame,
    fps: o.fps,
    rate: {
      crf: 18,
      preset: 'slow',
      tiers: socialTiers,
      ceilingFactor: 1,
      bufferFactor: 1.5,
      ...o.rate,
    },
    audio: {
      codec: 'aac',
      profile: 'aac_low',
      sampleRate: 48000,
      bitrateStereo: 192,
      bitrateMono: 128,
      allow51: false,
      requireTrack: false,
      ...o.audio,
    },
    hdr: o.hdr ?? {
      accepted: false,
      note: 'HDR sources are tone-mapped to SDR BT.709: the app shows SDR to most viewers.',
    },
  }
}

export function jpeg(o: Partial<ImageEncodeInput> & { frame: ImageEncodeInput['frame'] }): ImageEncodeInput {
  return {
    format: 'jpeg',
    quality: 92,
    chroma: '4:2:0',
    colorSpace: 'srgb',
    stripMetadata: true,
    padColor: '#ffffff',
    ...o,
  }
}
