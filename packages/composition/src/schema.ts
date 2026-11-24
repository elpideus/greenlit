import { z } from 'zod'

/** Same fields, all optional, and no defaults (an override must only contain what it changes). */
function patchOf<T extends z.ZodRawShape>(o: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {}
  for (const [k, v] of Object.entries(o.shape)) {
    let inner = v as z.ZodType
    while (inner instanceof z.ZodDefault || inner instanceof z.ZodOptional)
      inner = (inner as z.ZodDefault<z.ZodType>).unwrap() as z.ZodType
    shape[k] = inner.optional()
  }
  return z.object(shape) as unknown as z.ZodObject<{
    [K in keyof T]: z.ZodOptional<z.ZodType<z.infer<T[K]>>>
  }>
}

/**
 * The editing-project document. Everything is plain JSON so people, Claude (through MCP) and the API can all
 * read and change it. Times are seconds; positions and sizes are pixels of the format being edited
 * (origin top-left). Tracks are listed bottom → top: later tracks are drawn above earlier ones.
 */

export const Easing = z.union([
  z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'spring', 'back-out', 'expo-out']),
  z.tuple([z.number(), z.number(), z.number(), z.number()]).describe('cubic-bezier(x1, y1, x2, y2)'),
])
export type Easing = z.infer<typeof Easing>

export const Keyframe = z.object({
  /** Seconds from the start of the clip. */
  t: z.number().min(0),
  value: z.union([z.number(), z.string()]),
  /** Easing from this keyframe to the next one. */
  easing: Easing.optional(),
})
export type Keyframe = z.infer<typeof Keyframe>

export const Transform = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(0),
  height: z.number().default(0),
  /** Degrees, clockwise. */
  rotation: z.number().default(0),
  scale: z.number().default(1),
  /** Pivot for rotation/scale, 0..1 of the box. */
  anchorX: z.number().default(0.5),
  anchorY: z.number().default(0.5),
  opacity: z.number().min(0).max(1).default(1),
})
export type Transform = z.infer<typeof Transform>

export const Filters = z.object({
  blur: z.number().min(0).default(0),
  brightness: z.number().min(0).default(1),
  contrast: z.number().min(0).default(1),
  saturate: z.number().min(0).default(1),
  hue: z.number().default(0),
  grayscale: z.number().min(0).max(1).default(0),
  sepia: z.number().min(0).max(1).default(0),
})
export type Filters = z.infer<typeof Filters>

export const Style = z.object({
  radius: z.number().min(0).default(0),
  /** CSS box-shadow, e.g. "0 20px 60px rgba(0,0,0,.4)" */
  shadow: z.string().default(''),
  border: z.string().default(''),
  blendMode: z
    .enum([
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'soft-light',
      'hard-light',
      'difference',
      'exclusion',
    ])
    .default('normal'),
  filters: patchOf(Filters).default({}),
  /** CSS clip-path / mask for creative reveals (e.g. "circle(40% at 50% 50%)"). */
  clipPath: z.string().default(''),
})
export type Style = z.infer<typeof Style>

export const TextAnimation = z.object({
  preset: z
    .enum([
      'none',
      'fade',
      'rise',
      'drop',
      'pop',
      'typewriter',
      'blur',
      'slide-left',
      'slide-right',
      'scale-up',
      'wipe',
    ])
    .default('none'),
  /** Animate whole block, per line, per word or per character. */
  by: z.enum(['block', 'line', 'word', 'char']).default('block'),
  duration: z.number().min(0).default(0.6),
  /** Delay between pieces when animating by line/word/char. */
  stagger: z.number().min(0).default(0.04),
  easing: Easing.default('expo-out'),
})

export const Text = z.object({
  content: z.string().default(''),
  fontFamily: z.string().default('Inter Variable'),
  fontSize: z.number().min(1).default(72),
  fontWeight: z.number().min(100).max(1000).default(700),
  italic: z.boolean().default(false),
  color: z.string().default('#ffffff'),
  align: z.enum(['left', 'center', 'right']).default('center'),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('middle'),
  lineHeight: z.number().default(1.1),
  letterSpacing: z.number().default(0),
  textTransform: z.enum(['none', 'uppercase', 'lowercase']).default('none'),
  /** Background box behind the text ("" = none). */
  background: z.string().default(''),
  padding: z.number().min(0).default(0),
  strokeColor: z.string().default(''),
  strokeWidth: z.number().min(0).default(0),
  shadow: z.string().default(''),
  animateIn: patchOf(TextAnimation).optional(),
  animateOut: patchOf(TextAnimation).optional(),
})
export type Text = z.infer<typeof Text>

export const Shape = z.object({
  kind: z.enum(['rect', 'ellipse', 'line', 'path', 'polygon']).default('rect'),
  fill: z.string().default('#ffffff'),
  stroke: z.string().default(''),
  strokeWidth: z.number().min(0).default(0),
  /** SVG path data in the box's own 0..width × 0..height space (kind = path). */
  path: z.string().default(''),
  sides: z.number().int().min(3).max(24).default(6),
  /** Fraction of the line/path drawn, 0..1 — animate it for "draw on" effects. */
  trim: z.number().min(0).max(1).default(1),
})
export type Shape = z.infer<typeof Shape>

export const Audio = z.object({
  /** 1 = original level; up to 2 (+6 dB). */
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  fadeIn: z.number().min(0).default(0),
  fadeOut: z.number().min(0).default(0),
})
export type Audio = z.infer<typeof Audio>

export const Transition = z.object({
  type: z.enum([
    'fade',
    'slide-left',
    'slide-right',
    'slide-up',
    'slide-down',
    'zoom-in',
    'zoom-out',
    'blur',
    'wipe-left',
    'wipe-right',
    'iris',
  ]),
  duration: z.number().min(0.05).max(10).default(0.5),
  easing: Easing.default('ease-in-out'),
})
export type Transition = z.infer<typeof Transition>

/**
 * Code layer: an HTML document drawn on the frame. It runs in a sandbox and must be able to draw any time t:
 * Greenlit pauses every CSS / Web Animation and moves it to t automatically, and calls
 * `window.greenlit.onFrame((t, props) => { ... })` handlers (return a Promise if drawing is async).
 */
export const Html = z.object({
  code: z.string().default(''),
  props: z.record(z.string(), z.unknown()).default({}),
  /** Draw on a transparent background so layers below show through. */
  transparent: z.boolean().default(true),
})
export type Html = z.infer<typeof Html>

export const ClipType = z.enum(['video', 'image', 'audio', 'text', 'shape', 'solid', 'html'])
export type ClipType = z.infer<typeof ClipType>

export const FormatOverride = z.object({
  transform: patchOf(Transform).optional(),
  keyframes: z.record(z.string(), z.array(Keyframe)).optional(),
  text: patchOf(Text).optional(),
  hidden: z.boolean().optional(),
  crop: z
    .object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
    .partial()
    .optional(),
})
export type FormatOverride = z.infer<typeof FormatOverride>

export const Clip = z.object({
  id: z.string().min(1),
  type: ClipType,
  name: z.string().default(''),
  /** Where it starts on the timeline and how long it lasts (seconds). */
  start: z.number().min(0),
  duration: z.number().min(0.01),
  // media clips
  assetId: z.string().optional(),
  /** Seconds into the source where the clip begins. */
  in: z.number().min(0).default(0),
  speed: z.number().min(0.1).max(16).default(1),
  fit: z.enum(['cover', 'contain', 'fill', 'none']).default('cover'),
  /** Fractions of the source cut off each side. */
  crop: z
    .object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
    .default({ top: 0, right: 0, bottom: 0, left: 0 }),
  /** Focus point 0..1 used by fit=cover (who should stay in frame when reframing). */
  focusX: z.number().min(0).max(1).default(0.5),
  focusY: z.number().min(0).max(1).default(0.5),
  transform: Transform.default({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    scale: 1,
    anchorX: 0.5,
    anchorY: 0.5,
    opacity: 1,
  }),
  style: patchOf(Style).default({}),
  text: patchOf(Text).optional(),
  shape: patchOf(Shape).optional(),
  /** solid colour / gradient (any CSS background) */
  fill: z.string().optional(),
  html: patchOf(Html).optional(),
  audio: patchOf(Audio).optional(),
  transitionIn: Transition.optional(),
  transitionOut: Transition.optional(),
  /**
   * Animated properties: "transform.x", "transform.opacity", "transform.scale", "style.filters.blur",
   * "text.fontSize", "audio.volume", "focusX", "shape.trim"... Keyframe times are relative to the clip start.
   */
  keyframes: z.record(z.string(), z.array(Keyframe)).default({}),
  /** Differences for other formats (e.g. reframing for 9:16). */
  formats: z.record(z.string(), FormatOverride).default({}),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
})
export type Clip = z.infer<typeof Clip>
export type ClipInput = z.input<typeof Clip>

export const Track = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  kind: z.enum(['visual', 'audio']).default('visual'),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  muted: z.boolean().default(false),
  volume: z.number().min(0).max(2).default(1),
  clips: z.array(Clip).default([]),
})
export type Track = z.infer<typeof Track>

export const Asset = z.object({
  id: z.string().min(1),
  /** Greenlit media item, which of its versions and which of that version's formats (default: its main one). */
  mediaId: z.string(),
  /**
   * The item's version (another language, without the watermark, a mastered mix...); absent or '' = the main
   * version. A version the item no longer has falls back to the main one.
   */
  version: z.string().optional(),
  formatKey: z.string().optional(),
  kind: z.enum(['video', 'image', 'audio']),
  name: z.string().default(''),
  duration: z.number().nullable().default(null),
  width: z.number().nullable().default(null),
  height: z.number().nullable().default(null),
  hasAudio: z.boolean().default(false),
})
export type Asset = z.infer<typeof Asset>

export const OutputFormat = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
})
export type OutputFormat = z.infer<typeof OutputFormat>

export const Marker = z.object({
  id: z.string(),
  t: z.number(),
  label: z.string().default(''),
  color: z.string().optional(),
})

export const Composition = z.object({
  version: z.literal(1).default(1),
  fps: z.number().min(1).max(120).default(30),
  /** Total length in seconds. */
  duration: z
    .number()
    .min(0.1)
    .max(4 * 3600)
    .default(10),
  background: z.string().default('#000000'),
  formats: z
    .array(OutputFormat)
    .min(1)
    .default([{ id: 'main', name: '16:9', width: 1920, height: 1080 }]),
  tracks: z.array(Track).default([]),
  assets: z.record(z.string(), Asset).default({}),
  markers: z.array(Marker).default([]),
  /** Extra font families to load (Google Fonts family names or uploaded font URLs). */
  fonts: z.array(z.object({ family: z.string(), url: z.string().optional() })).default([]),
})
export type Composition = z.infer<typeof Composition>
export type CompositionInput = z.input<typeof Composition>

export const FORMAT_SIZES = {
  landscape: { id: 'main', name: '16:9', width: 1920, height: 1080 },
  vertical: { id: 'vertical', name: '9:16', width: 1080, height: 1920 },
  square: { id: 'square', name: '1:1', width: 1080, height: 1080 },
  portrait: { id: 'portrait', name: '4:5', width: 1080, height: 1350 },
} as const

export function emptyComposition(
  formats: OutputFormat[] = [FORMAT_SIZES.landscape],
  fps = 30,
  duration = 10,
): Composition {
  return Composition.parse({
    fps,
    duration,
    formats,
    tracks: [
      { id: 'v1', name: 'Video 1', kind: 'visual' },
      { id: 'a1', name: 'Audio 1', kind: 'audio' },
    ],
  })
}
