import { z } from 'zod'

/**
 * The shape of the platform registry. Every number in a platform file is a value from that platform's
 * own documentation (see README.md for the source and the date it was checked), not a guess. Fractions are
 * always of the frame (0..1). Aspect ratios are width / height (9:16 = 0.5625).
 */

export const PlatformId = z.enum(['instagram', 'facebook', 'tiktok', 'youtube'])
export type PlatformId = z.infer<typeof PlatformId>

export const PlacementKey = z.enum([
  'instagram.feed',
  'instagram.reel',
  'instagram.story',
  'facebook.feed',
  'facebook.reel',
  'facebook.story',
  'tiktok.video',
  'tiktok.photo',
  'youtube.video',
  'youtube.short',
  'youtube.post',
])
export type PlacementKey = z.infer<typeof PlacementKey>

/** How the platform lays the post out; previews and format picking key off this. */
export const Surface = z.enum(['feed', 'vertical', 'story', 'watch', 'post'])
export type Surface = z.infer<typeof Surface>

export const MediaKind = z.enum(['image', 'video', 'text'])
export type MediaKind = z.infer<typeof MediaKind>

const Size = z.object({ width: z.number().int().positive(), height: z.number().int().positive() })
export type Size = z.infer<typeof Size>

/** How strings are counted: code points (what users call characters), UTF-16 units (JS length) or UTF-8 bytes. */
export const TextUnit = z.enum(['chars', 'utf16', 'bytes'])
export type TextUnit = z.infer<typeof TextUnit>

const TextLimit = z.object({
  max: z.number().int().positive(),
  unit: TextUnit.default('chars'),
  required: z.boolean().optional(),
  /** Characters not allowed anywhere in the text (YouTube: < and >). */
  forbidden: z.array(z.string()).optional(),
})
export type TextLimit = z.infer<typeof TextLimit>

/** What a viewer sees before tapping "more": the preview truncates by characters, then by lines. */
const Display = z.object({
  chars: z.number().int().positive().optional(),
  lines: z.number().int().positive().optional(),
  /** The word the platform appends ("more", "See more", "...more"). */
  more: z.string(),
})
export type Display = z.infer<typeof Display>

export const SafeRegion = z.object({
  label: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
})
export type SafeRegion = z.infer<typeof SafeRegion>

/**
 * Margins covered by the app's own UI (fractions of the frame). Keep text and faces out of them.
 * `regions` adds extra blocked rectangles, e.g. a right-hand action rail that only covers the lower half.
 */
export const SafeZone = z.object({
  top: z.number().min(0).max(1),
  bottom: z.number().min(0).max(1),
  left: z.number().min(0).max(1),
  right: z.number().min(0).max(1),
  regions: z.array(SafeRegion).default([]),
  /** Where the numbers come from (they are usually the ads guides: the conservative choice). */
  basis: z.string(),
})
export type SafeZone = z.infer<typeof SafeZone>

// ── Encoding ─────────────────────────────────────────────────────────────

/**
 * Bitrate ceiling for one resolution tier. Tiers are keyed by the SHORT edge of the output (a 1080×1920
 * vertical video is "1080p"), with separate values up to 30 fps and above 30 fps.
 */
export const BitrateTier = z.object({
  shortEdge: z.number().int().positive(),
  /** kbps for ≤ 30 fps */
  sdr30: z.number().positive(),
  /** kbps for > 30 fps */
  sdr60: z.number().positive(),
  /** kbps for HDR ≤ 30 / > 30 fps (only where the platform accepts HDR uploads). */
  hdr30: z.number().positive().optional(),
  hdr60: z.number().positive().optional(),
})
export type BitrateTier = z.infer<typeof BitrateTier>

/**
 * - keep: keep the source's shape if the platform accepts it (no bars, no crop), only scale down.
 * - pad:  fit inside the recommended frame and add bars (nothing is lost).
 * - crop: fill the recommended frame and cut the overflow from the centre.
 */
export const Fit = z.enum(['keep', 'pad', 'crop'])
export type Fit = z.infer<typeof Fit>

/** Where the output frame comes from. */
export const Frame = z.object({
  /** The frame the platform shows best, in the recommended orientation (1080×1920 for reels). Sources are scaled down (never up) to fit. */
  box: Size,
  /** The box may be turned 90° for sources of the other orientation (a 16:9 reel fits 1920×1080). */
  rotatable: z.boolean(),
  /** Smallest short edge the platform accepts: smaller sources are scaled UP to this (the only upscale besides qualityBoost). */
  minShortEdge: z.number().int().positive().optional(),
  /** What to do when the source shape is accepted but differs from the recommended one. */
  fitInRange: Fit,
  /** What to do when the platform does not accept the source shape at all. */
  fitOutOfRange: z.enum(['pad', 'crop']),
  /** Shape to pad/crop to when out of range: the nearest accepted ratio, or the recommended one (Shorts: 9:16, not 1:1). */
  outOfRangeTarget: z.enum(['nearest', 'recommended']).default('nearest'),
})
export type Frame = z.infer<typeof Frame>
export type FrameInput = z.input<typeof Frame>

export const VideoEncode = z.object({
  container: z.enum(['mp4', 'mov']),
  codec: z.literal('h264'),
  profile: z.enum(['high', 'main']),
  pixelFormat: z.literal('yuv420p'),
  /** Colour tags written on the output. SDR uploads are always BT.709 limited range. */
  color: z.literal('bt709'),
  frame: Frame,
  fps: z.object({
    min: z.number().positive().optional(),
    max: z.number().positive(),
  }),
  rate: z.object({
    /** libx264 constant-quality target. Lower is better; 17–19 is visually lossless for most content. */
    crf: z.number().min(0).max(51),
    /** x264 speed preset. Slower = smaller files at the same quality. */
    preset: z.enum(['medium', 'slow', 'slower', 'veryslow']),
    /** Ceilings per resolution (VBV maxrate); bufsize = maxrate × bufferFactor. */
    tiers: z.array(BitrateTier).min(1),
    /** maxrate = tier × ceilingFactor (YouTube publishes averages, so its ceiling is 2× the table). */
    ceilingFactor: z.number().positive().default(1),
    bufferFactor: z.number().positive(),
    /** Hard cap from the platform spec (e.g. Instagram "VBR 25 Mbps max"). */
    hardMaxKbps: z.number().positive().optional(),
  }),
  /** Keyframe interval in seconds (YouTube: half the frame rate = 0.5 s). Closed GOPs always. */
  gopSeconds: z.number().positive(),
  bFrames: z.number().int().min(0).max(16),
  audio: z.object({
    codec: z.literal('aac'),
    profile: z.literal('aac_low'),
    sampleRate: z.literal(48000),
    /** kbps per layout. */
    bitrateStereo: z.number().positive(),
    bitrateMono: z.number().positive(),
    bitrate51: z.number().positive().optional(),
    /** Allow 5.1 output when the source has 6 channels; otherwise down-mix to stereo. */
    allow51: z.boolean(),
    /** Write a silent track when the source has none (some APIs refuse silent videos when music is added). */
    requireTrack: z.boolean(),
  }),
  /** Move the moov atom to the front so the platform can start processing before the download ends. */
  faststart: z.literal(true),
  /** Platform re-encodes 1440p+ uploads with a better codec (YouTube): see `qualityBoost` in ffmpegArgsFor. */
  qualityBoost: z
    .object({
      /** Upscale target for the short edge (1440). */
      shortEdge: z.number().int().positive(),
      note: z.string(),
    })
    .optional(),
  /** HDR uploads accepted (PQ/HLG, BT.2020): encoded as HEVC Main10 when the caller asks to keep HDR. */
  hdr: z.object({ accepted: z.boolean(), note: z.string().optional() }),
})
export type VideoEncode = z.infer<typeof VideoEncode>
export type VideoEncodeInput = z.input<typeof VideoEncode>

export const ImageEncode = z.object({
  format: z.enum(['jpeg', 'webp', 'png']),
  /** 1–100 (sharp/libjpeg scale). */
  quality: z.number().int().min(1).max(100),
  /** Keep full colour resolution (4:4:4) — worth it for text and graphics, platforms keep it at this size. */
  chroma: z.enum(['4:2:0', '4:4:4']),
  frame: Frame,
  colorSpace: z.literal('srgb'),
  stripMetadata: z.literal(true),
  /** Background for pad (images have no alpha in JPEG). */
  padColor: z.string(),
})
export type ImageEncode = z.infer<typeof ImageEncode>
export type ImageEncodeInput = z.input<typeof ImageEncode>

// ── Placement ────────────────────────────────────────────────────────────

export const Support = z.enum(['yes', 'no', 'partial'])
export type Support = z.infer<typeof Support>

export const PlacementSpec = z.object({
  key: PlacementKey,
  platform: PlatformId,
  /** Short English name ("Reel"); the web app translates it by key. */
  label: z.string(),
  surface: Surface,
  /** Can Greenlit publish here through the official API? */
  api: z.object({
    publish: Support,
    endpoint: z.string().optional(),
    note: z.string().optional(),
  }),
  media: z.object({
    kinds: z.array(MediaKind).min(1),
    videoContainers: z.array(z.string()).default([]),
    videoCodecs: z.array(z.string()).default([]),
    imageFormats: z.array(z.string()).default([]),
  }),
  aspect: z.object({
    /** Accepted range, width / height. */
    min: z.number().positive(),
    max: z.number().positive(),
    recommended: z.number().positive(),
    /** Other shapes that display without bars (e.g. 1:1 and 4:5 in a feed). */
    alsoGood: z.array(z.number().positive()).default([]),
  }),
  resolution: z.object({
    recommended: Size,
    minWidth: z.number().int().positive().optional(),
    minHeight: z.number().int().positive().optional(),
    maxWidth: z.number().int().positive().optional(),
    maxHeight: z.number().int().positive().optional(),
  }),
  duration: z
    .object({
      minSec: z.number().nonnegative(),
      maxSec: z.number().positive(),
      /** Longer than this still posts, but the platform treats it differently (no Shorts shelf, no reels reach…). */
      softMaxSec: z.number().positive().optional(),
      note: z.string().optional(),
    })
    .optional(),
  maxBytes: z.object({ video: z.number().positive().optional(), image: z.number().positive().optional() }),
  fps: z.object({ min: z.number().positive().optional(), max: z.number().positive() }).optional(),
  maxVideoKbps: z.number().positive().optional(),
  text: z.object({
    caption: TextLimit.optional(),
    title: TextLimit.optional(),
    description: TextLimit.optional(),
    altText: TextLimit.optional(),
    hashtags: z
      .object({
        max: z.number().int().nonnegative().optional(),
        /** Above this count the platform ignores all of them (YouTube: 60). */
        ignoredAbove: z.number().int().positive().optional(),
        /** How many the platform surfaces prominently (YouTube: 3 above the title). */
        shown: z.number().int().positive().optional(),
        /** false = the documented API limit is looser than the app's; going over is a warning, not an error. */
        strict: z.boolean().default(true),
        note: z.string().optional(),
      })
      .optional(),
    mentions: z.object({ max: z.number().int().nonnegative() }).optional(),
    /** YouTube tags: total characters, commas counted, tags with spaces counted with quotes. */
    tags: z.object({ maxTotal: z.number().int().positive() }).optional(),
  }),
  display: z.object({
    caption: Display.optional(),
    title: Display.optional(),
    description: Display.optional(),
  }),
  thumbnail: z.object({
    /** frame = pick a frame of the video; image = upload a picture; none = platform chooses. */
    modes: z.array(z.enum(['frame', 'image', 'none'])).min(1),
    formats: z.array(z.string()).default([]),
    maxBytes: z.number().positive().optional(),
    recommended: Size.optional(),
    minWidth: z.number().int().positive().optional(),
    aspect: z.number().positive().optional(),
    note: z.string().optional(),
  }),
  safeZone: SafeZone.optional(),
  carousel: z
    .object({
      min: z.number().int().positive(),
      max: z.number().int().positive(),
      mixedKinds: z.boolean(),
      note: z.string().optional(),
    })
    .optional(),
  scheduling: z.object({
    /** The platform can hold the post and publish it at a time we set. */
    native: Support,
    minLeadMinutes: z.number().nonnegative().optional(),
    maxLeadDays: z.number().positive().optional(),
    note: z.string().optional(),
  }),
  music: z.object({
    /** The app has a music/sound library for this placement. */
    library: z.boolean(),
    /** A library track can be attached through the official API. */
    api: Support,
    note: z.string().optional(),
  }),
  localization: z.object({
    /** Per-language title/description (YouTube `localizations`). */
    titleDescription: Support,
    /** Several language versions of the post text (Facebook multilingual posts). */
    multilingualText: Support,
    note: z.string().optional(),
  }),
  features: z.object({
    location: z.boolean(),
    collaborators: z.number().int().nonnegative().optional(),
    userTags: z.boolean().optional(),
    aiLabel: z.boolean().optional(),
  }),
  encode: z.object({ video: VideoEncode.optional(), image: ImageEncode.optional() }),
  notes: z.array(z.string()).default([]),
  /** Keys into the README sources list. */
  sources: z.array(z.string()).min(1),
})
export type PlacementSpec = z.infer<typeof PlacementSpec>
/** What platform files write (zod defaults filled in by `definePlatform`). */
export type PlacementInput = z.input<typeof PlacementSpec>

export const PlatformSpec = z.object({
  id: PlatformId,
  name: z.string(),
  /** Small UI accents only (dots, focus rings). Never a logo. */
  brand: z.object({ color: z.string(), colorAlt: z.string().optional(), textOnColor: z.string() }),
  /** A lucide icon name with no brand artwork. */
  icon: z.string(),
  placements: z.array(PlacementSpec).min(1),
  /** Account-wide publishing limits. */
  limits: z.object({
    postsPerDay: z.number().int().positive().optional(),
    note: z.string().optional(),
  }),
  checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
export type PlatformSpec = z.infer<typeof PlatformSpec>
export type PlatformInput = Omit<z.input<typeof PlatformSpec>, 'placements'> & {
  placements: PlacementInput[]
}

/** Parses (and fills defaults of) a platform file once at import time, so a typo fails loudly. */
export function definePlatform(p: PlatformInput): PlatformSpec {
  return PlatformSpec.parse(p)
}

// ── Inputs to ffmpegArgsFor / validateForPlacement ────────────────────────

export const SourceInfo = z.object({
  kind: z.enum(['video', 'image']).default('video'),
  /** Display size (after rotation): what a viewer sees. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().nullable().default(null),
  durationSec: z.number().nonnegative().nullable().default(null),
  hasAudio: z.boolean().default(false),
  /** HDR transfer of the source: true/'pq'/'hlg' = HDR, false = SDR. */
  hdr: z.union([z.boolean(), z.enum(['pq', 'hlg'])]).default(false),
  audioChannels: z.number().int().positive().optional(),
  interlaced: z.boolean().optional(),
  /**
   * YCbCr matrix of the source (ffprobe `color_space`). Unknown = guessed like players do: BT.709 from 720p up,
   * BT.601 below. Getting this right keeps colours from shifting when SD/phone footage is converted to BT.709.
   */
  colorMatrix: z.enum(['bt709', 'bt601', 'bt2020']).optional(),
  /** Full-range ("pc"/yuvj) sources are converted to limited range. Unknown = read from the frames. */
  colorRange: z.enum(['tv', 'pc']).optional(),
  /** Bytes of the source file (lets validation warn about size limits for pass-through uploads). */
  bytes: z.number().nonnegative().optional(),
})
export type SourceInfo = z.input<typeof SourceInfo>

export const EncodeOptions = z.object({
  /** Override the placement's shape policy. 'auto' = the placement default. */
  fit: z.enum(['auto', 'keep', 'pad', 'crop']).default('auto'),
  /** YouTube: upscale to 1440p so YouTube serves its higher-bitrate VP9/AV1 encodes. */
  qualityBoost: z.boolean().default(false),
  /** HDR sources: tone-map to SDR (default) or keep HDR where the platform accepts it. */
  hdr: z.enum(['tonemap', 'keep']).default('tonemap'),
  /** Faster x264 preset for drafts/previews; the placement default otherwise. */
  speed: z.enum(['default', 'fast']).default('default'),
  /** Cut the output to the placement's max duration instead of only warning. */
  trimToMax: z.boolean().default(false),
  /** Pad colour (ffmpeg colour syntax). Default: black for video, the preset's colour for pictures. */
  padColor: z.string().optional(),
  /** Use this many encoder threads (0 = ffmpeg default). */
  threads: z.number().int().nonnegative().default(0),
})
export type EncodeOptions = z.input<typeof EncodeOptions>

export interface FfmpegPlan {
  /** Arguments between the input and the output: `ffmpeg -hide_banner -y -i <in> ...args <out>.<outputExt>` */
  args: string[]
  outputExt: 'mp4' | 'mov' | 'jpg' | 'webp' | 'png'
  /** What the plan does and why, in plain English (shown to users, logged by the server). */
  notes: string[]
  /** What the output will be. */
  output: {
    kind: 'video' | 'image'
    width: number
    height: number
    fps: number | null
    fpsExpr: string | null
    fit: Fit
    hdr: boolean
    videoMaxKbps: number | null
    audioKbps: number | null
    /** Upper bound of the file size (video ceiling × duration), when the duration is known. */
    maxBytes: number | null
  }
}

export type IssueLevel = 'error' | 'warning' | 'info'
export interface Issue {
  level: IssueLevel
  /** Stable id for translation: `caption.tooLong`, `aspect.outOfRange`… */
  code: string
  /** English sentence; the web app translates by `code` and `params`. */
  message: string
  params: Record<string, string | number>
}

export interface PostContent {
  caption?: string
  title?: string
  description?: string
  /** Extra hashtags kept apart from the caption (with or without '#'). They are counted with the caption's. */
  hashtags?: string[]
  /** YouTube tags. */
  tags?: string[]
  altText?: string
  /** Number of items in a carousel (defaults to 1). */
  items?: number
}
