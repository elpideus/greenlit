import { z } from 'zod'
import { Id } from '../common.ts'
import type { Media, MediaFormat } from './media.ts'

/**
 * Depth maps: a picture or video that says how far away each pixel of a format is. Greenlit keeps them beside the
 * format they describe, one per format of each version: made elsewhere (Depth Anything, Marigold, DepthCrafter, a
 * render's Z pass, a phone's portrait depth...) and uploaded, or made by Greenlit itself (the depth module, with
 * Depth Anything V2 Small).
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
  /** Made by Greenlit: with which model, from which file version of the picture. Null for an uploaded map. */
  generated: z
    .object({
      model: z.string(),
      fromRevision: z.number().int(),
      /**
       * Real distances (MoGe-2): the map's levels run in disparity from `far` (black, 0) to `near` (white, 1) metres,
       * so a level v is 1 / (v × (1/near − 1/far) + 1/far) metres away. The sky is 0.
       */
      metric: z.object({ near: z.number(), far: z.number() }).nullable().optional(),
    })
    .nullable(),
})
export type DepthInfo = z.infer<typeof DepthInfo>

/**
 * The models Greenlit makes depth maps with: MoGe-2 ViT-L (Microsoft, MIT) for pictures, the cleanest shapes and
 * real distances; Depth Anything V2 Small (Apache-2.0) for videos, fast enough for every frame.
 */
export const DEPTH_GENERATORS: Record<string, { name: string; license: string; for: 'images' | 'videos' }> = {
  'moge-2-vitl': { name: 'MoGe-2 ViT-L', license: 'MIT', for: 'images' },
  'depth-anything-v2-small': { name: 'Depth Anything V2 Small', license: 'Apache-2.0', for: 'videos' },
}
export const generatorName = (id: string) => DEPTH_GENERATORS[id]?.name ?? id

/** A depth map Greenlit is making for a format right now (or about to). */
export const DepthJob = z.object({
  formatId: Id,
  state: z.enum(['queued', 'running']),
  progress: z.number().min(0).max(1),
})
export type DepthJob = z.infer<typeof DepthJob>

/** Make depth maps for new pictures and videos as they are added (workspace setting). */
export const DepthAuto = z.object({
  enabled: z.boolean(),
  /** Videos take a while (about half a second per frame on a processor): they can be left out. */
  kinds: z.enum(['all', 'images']),
})
export type DepthAuto = z.infer<typeof DepthAuto>
export const DEPTH_AUTO_DEFAULT: DepthAuto = { enabled: false, kinds: 'all' }

/** The depth generator: its model, the automatic setting, and how much is left without a depth map. */
export const DepthStatus = z.object({
  /** The models, the one for pictures first. */
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      license: z.string(),
      size: z.number(),
      for: z.enum(['images', 'videos']),
      /** Downloaded already (otherwise the first depth map of its kind downloads it). */
      installed: z.boolean(),
      /** Where it runs, once opened (MoGe-2 skips WebGPU, which can't hold it). */
      backend: z.enum(['cuda', 'webgpu', 'cpu']).nullable(),
    }),
  ),
  auto: DepthAuto,
  /** Pictures and videos (their main version's main format) without a depth map. */
  missing: z.object({ images: z.number().int(), videos: z.number().int() }),
  /** Greenlit's own maps made with a model it no longer uses for that kind (Small, for pictures). */
  outdated: z.object({ images: z.number().int(), videos: z.number().int() }),
  /** Depth maps waiting or being made. */
  queued: z.number().int(),
  /** Where the model runs: a graphics card (CUDA, WebGPU) or the processor. */
  device: z.object({
    /** What it runs on now; null until the first depth map opens the model. */
    backend: z.enum(['cuda', 'webgpu', 'cpu']).nullable(),
    /** What it will try, best first. */
    order: z.array(z.enum(['cuda', 'webgpu', 'cpu'])),
    /** NVIDIA cards this machine (or container) can see. */
    gpus: z.array(z.object({ name: z.string(), memoryMB: z.number() })),
    /** The graphics card was turned off (GREENLIT_GPU=off). */
    off: z.boolean(),
  }),
})
export type DepthStatus = z.infer<typeof DepthStatus>

/** Make the depth map of one format of an item (default: the main version's main format). */
export const GenerateDepthInput = z.object({
  formatId: Id.optional(),
  /** Replace a depth map that was uploaded (generated ones are always remade). */
  replace: z.boolean().optional(),
})

/** Make depth maps for many items (their main version's formats), or for everything without one (`missing`). */
export const GenerateDepthManyInput = z.object({
  ids: z.array(Id).max(2000).optional(),
  missing: z.enum(['all', 'images']).optional(),
  /** Remake Greenlit's maps that an older model made (pictures made with Small before MoGe-2). */
  outdated: z.boolean().optional(),
  replace: z.boolean().optional(),
})

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
