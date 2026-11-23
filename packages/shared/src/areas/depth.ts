import { z } from 'zod'
import { Id } from '../common.ts'
import type { Media, MediaFormat } from './media.ts'

/**
 * Depth maps: a picture or video made elsewhere (Depth Anything, Marigold, DepthCrafter, a render's Z pass, a phone's
 * portrait depth...) that says how far away each pixel of a format is. Greenlit keeps them beside the format they
 * describe, one per format of each version; it never makes them.
 */

/** Which end of the scale is close to the camera: light (disparity, most AI tools) or dark (distance, Z passes). */
export const DepthNear = z.enum(['light', 'dark'])
export type DepthNear = z.infer<typeof DepthNear>

/** What Greenlit read from a depth map file. */
export const DepthInfo = z.object({
  near: DepthNear,
  /** Bits per value: 8, 10, 16, 32 (floating point)... null until read. */
  bitDepth: z.number().int().nullable(),
  float: z.boolean(),
  /** The values the picture's preview was stretched from (low, high), for a picture; null for a video. */
  range: z.tuple([z.number(), z.number()]).nullable(),
  /** How the preview spreads them: evenly, or on a log scale (distances, so near things stay apart). */
  curve: z.enum(['linear', 'log']),
})
export type DepthInfo = z.infer<typeof DepthInfo>

/** The files a depth map may be: pictures (16-bit PNG/TIFF, EXR, PFM...) or a video of the same length. */
export const DEPTH_ACCEPT = 'image/*,video/*,.exr,.pfm,.tif,.tiff,.png,.mkv,.mov'

type WithDepth = Pick<Media, 'formats' | 'depthMaps'>

/**
 * The depth map for a format: its own, or (for a format of another version that has none) the main version's one of
 * the same shape when the pictures line up (same size, and same length for videos). `inherited` tells which.
 */
export function depthMapFor(
  m: WithDepth,
  f: Pick<MediaFormat, 'key' | 'version' | 'width' | 'height' | 'duration' | 'kind'>,
): { map: MediaFormat; inherited: boolean } | null {
  const own = m.depthMaps.find((d) => d.version === f.version && d.key === f.key)
  if (own) return { map: own, inherited: false }
  if (!f.version) return null
  const main = m.formats.find((x) => x.key === f.key)
  const map = m.depthMaps.find((d) => d.version === '' && d.key === f.key)
  if (!main || !map || main.kind !== f.kind) return null
  if (main.width !== f.width || main.height !== f.height) return null
  if (f.kind === 'video' && Math.abs((main.duration ?? 0) - (f.duration ?? 0)) > 0.15) return null
  return { map, inherited: true }
}

/** Why a depth map may not line up with its picture: another shape, or another length. Null when it fits. */
export function depthMismatch(
  f: Pick<MediaFormat, 'width' | 'height' | 'duration' | 'kind'>,
  d: Pick<MediaFormat, 'width' | 'height' | 'duration' | 'kind' | 'processing'>,
): { kind: 'shape' | 'length'; picture: number; depth: number } | null {
  if (d.processing.state !== 'ready') return null
  if (f.width && f.height && d.width && d.height) {
    const a = f.width / f.height
    const b = d.width / d.height
    if (Math.abs(a - b) / a > 0.02) return { kind: 'shape', picture: a, depth: b }
  }
  if (f.kind === 'video' && f.duration && d.duration && Math.abs(f.duration - d.duration) > 0.25)
    return { kind: 'length', picture: f.duration, depth: d.duration }
  return null
}

/** Words tools add to a depth map's file name ("IMG_0412_depth_16bit.png", "clip_vis.mp4", "disp-IMG_0412.png"). */
const MARKERS = new Set([
  'depth',
  'depths',
  'depthmap',
  'map',
  'disp',
  'disparity',
  'zdepth',
  'z',
  'pred',
  'vis',
  '16bit',
  '8bit',
  '32bit',
  'gray',
  'grey',
  'raw',
  'colored',
  'coloured',
  'inv',
  'inverse',
  'inverted',
  'metric',
  'relative',
  'output',
])

/**
 * The names a depth map file could be the depth of, best guess first: its own name without the extension, then
 * without the words depth tools add at its end or start ("IMG_0412_depth_16bit.png" → "img_0412_depth_16bit",
 * "img_0412_depth", "img_0412"). Lower case.
 */
export function depthNameCandidates(filename: string): string[] {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const stem = base.replace(/\.[^.]+$/, '').toLowerCase()
  const out = [stem]
  // From the end: "img_0412_depth_16bit" → "img_0412_depth" → "img_0412"
  let s = stem
  for (;;) {
    const m = /^(.+?)[_\-. ]+([a-z0-9]+)$/.exec(s)
    if (!m || !MARKERS.has(m[2]!)) break
    s = m[1]!
    out.push(s)
  }
  // From the start: "depth_img_0412" → "img_0412"
  for (let t = s; ; ) {
    const m = /^([a-z0-9]+)[_\-. ]+(.+)$/.exec(t)
    if (!m || !MARKERS.has(m[1]!)) break
    t = m[2]!
    out.push(t)
  }
  return [...new Set(out)].filter(Boolean)
}

/** The name a format's file is matched by: its file name without the extension, lower case. */
export function depthNameKey(filename: string) {
  return (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[^.]+$/, '').toLowerCase()
}

export const DepthMatchInput = z.object({
  /** The depth maps' file names. */
  names: z.array(z.string().min(1).max(500)).min(1).max(1000),
  /** Look only in this project (null = media outside projects); everywhere when left out. */
  projectId: Id.nullable().optional(),
})
export type DepthMatchInput = z.infer<typeof DepthMatchInput>

/** A format a depth map file could belong to. */
export const DepthTarget = z.object({
  mediaId: Id,
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  formatKey: z.string(),
  formatLabel: z.string(),
  /** '' = the main version. */
  version: z.string(),
  versionLabel: z.string(),
  kind: z.enum(['image', 'video']),
  filename: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  /** It already has a depth map (the new file replaces it). */
  hasDepth: z.boolean(),
})
export type DepthTarget = z.infer<typeof DepthTarget>

export const DepthMatch = z.object({
  name: z.string(),
  /** Candidates, best first (several items can share a file name). */
  targets: z.array(DepthTarget),
})
export type DepthMatch = z.infer<typeof DepthMatch>
