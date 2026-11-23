import type { Fit, Frame, PlacementSpec } from './types.ts'

/** Ratios within 2% count as the same shape (1080×1350 vs 4:5 rounding, 1.9 vs 1.91…). */
export const SAME_SHAPE = 0.02

export const sameShape = (a: number, b: number) => Math.abs(a - b) / b <= SAME_SHAPE

export function aspectInRange(spec: PlacementSpec, aspect: number) {
  return aspect >= spec.aspect.min * (1 - SAME_SHAPE) && aspect <= spec.aspect.max * (1 + SAME_SHAPE)
}

/** Even integer ≥ 2 (4:2:0 chroma needs even dimensions). */
export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export interface FramePlan {
  fit: Fit
  /** Output canvas. */
  width: number
  height: number
  /** keep: = canvas. pad: the picture inside the bars. crop: the scaled picture before the centre crop. */
  scaleWidth: number
  scaleHeight: number
  /** The shape the canvas was made to (width / height). */
  targetAspect: number
  upscaled: boolean
  notes: string[]
}

export interface FrameRequest {
  spec: PlacementSpec
  frame: Frame
  width: number
  height: number
  fit: 'auto' | Fit
  /** Scale the short edge up to this (YouTube quality boost). */
  boostShortEdge?: number
}

/**
 * Decides the output frame for a source: whether to keep, pad or crop, and at what size. Sources are never scaled
 * up, except to reach the platform's minimum size or when a quality boost is asked for.
 */
export function planFrame({
  spec,
  frame,
  width: sw,
  height: sh,
  fit: asked,
  boostShortEdge,
}: FrameRequest): FramePlan {
  const notes: string[] = []
  const aspect = sw / sh
  const inRange = aspectInRange(spec, aspect)
  let fit: Fit = asked === 'auto' ? (inRange ? frame.fitInRange : frame.fitOutOfRange) : asked
  let target = spec.aspect.recommended
  if (fit === 'keep' && !inRange) {
    fit = frame.fitOutOfRange
    notes.push(
      `${shape(aspect)} is outside what ${spec.label} accepts (${shape(spec.aspect.min)}–${shape(spec.aspect.max)}), so it is ${fit === 'pad' ? 'padded' : 'cropped'}.`,
    )
  }
  if (
    fit !== 'keep' &&
    !inRange &&
    (asked === 'auto' || asked === 'keep') &&
    frame.outOfRangeTarget === 'nearest'
  ) {
    target = Math.min(spec.aspect.max, Math.max(spec.aspect.min, aspect))
  }
  if (fit !== 'keep' && sameShape(aspect, target)) fit = 'keep'

  const box = orientBox(frame, fit === 'keep' ? aspect : target)
  let w: number
  let h: number
  if (fit === 'keep') {
    const s = Math.min(1, box.w / sw, box.h / sh)
    w = sw * s
    h = sh * s
  } else if (fit === 'pad') {
    // Canvas at the picture's own scale, in the target shape, then shrunk into the box.
    w = aspect > target ? sw : sh * target
    h = w / target
    // Bars should not make the file bigger than the platform's recommended frame (or the source) needs.
    const rec = spec.resolution.recommended
    const capShort = Math.max(Math.min(rec.width, rec.height), Math.min(sw, sh))
    const s = Math.min(1, box.w / w, box.h / h, capShort / Math.min(w, h))
    w *= s
    h *= s
  } else {
    // Largest target-shaped window inside the picture, shrunk into the box.
    w = aspect > target ? sh * target : sw
    h = w / target
    const s = Math.min(1, box.w / w, box.h / h)
    w *= s
    h *= s
  }

  let upscaled = false
  const short = Math.min(w, h)
  const minShort = frame.minShortEdge ?? 0
  if (boostShortEdge && short < boostShortEdge) {
    const k = boostShortEdge / short
    w *= k
    h *= k
    upscaled = true
  } else if (short < minShort) {
    const k = minShort / short
    w *= k
    h *= k
    upscaled = true
    notes.push(
      `The picture is smaller than ${spec.label}'s minimum (${minShort}px on the short side), so it is scaled up.`,
    )
  }

  const width = even(w)
  const height = even(h)
  let scaleWidth = width
  let scaleHeight = height
  if (fit === 'pad') {
    const s = Math.min(width / sw, height / sh)
    scaleWidth = Math.min(width, even(sw * s))
    scaleHeight = Math.min(height, even(sh * s))
  } else if (fit === 'crop') {
    const s = Math.max(width / sw, height / sh)
    scaleWidth = Math.max(width, even(sw * s))
    scaleHeight = Math.max(height, even(sh * s))
  }
  if (fit === 'pad') notes.push(`Padded from ${shape(aspect)} to ${shape(target)} (bars, nothing cut).`)
  if (fit === 'crop') notes.push(`Cropped from ${shape(aspect)} to ${shape(target)} around the centre.`)
  return {
    fit,
    width,
    height,
    scaleWidth,
    scaleHeight,
    targetAspect: fit === 'keep' ? aspect : target,
    upscaled,
    notes,
  }
}

function orientBox(frame: Frame, aspect: number) {
  const { width, height } = frame.box
  const boxLandscape = width >= height
  if (frame.rotatable && aspect !== 1 && aspect > 1 !== boxLandscape) return { w: height, h: width }
  return { w: width, h: height }
}

/** "16:9", "9:16", "4:5", "1.91:1"… */
export function shape(r: number): string {
  const known: [number, string][] = [
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
    [1, '1:1'],
    [4 / 5, '4:5'],
    [5 / 4, '5:4'],
    [4 / 3, '4:3'],
    [3 / 4, '3:4'],
    [3 / 2, '3:2'],
    [2 / 3, '2:3'],
    [21 / 9, '21:9'],
    [1.91, '1.91:1'],
  ]
  for (const [v, label] of known) if (Math.abs(r - v) / v < 0.01) return label
  return r >= 1 ? `${trim(r)}:1` : `1:${trim(1 / r)}`
}

const trim = (n: number) => (Math.round(n * 100) / 100).toString()
