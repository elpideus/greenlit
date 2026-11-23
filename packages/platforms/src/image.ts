import { planFrame } from './geometry.ts'
import { EncodeOptions, type Fit, type PlacementSpec, SourceInfo } from './types.ts'

export interface ImagePlan {
  format: 'jpeg' | 'webp' | 'png'
  outputExt: 'jpg' | 'webp' | 'png'
  quality: number
  chroma: '4:2:0' | '4:4:4'
  /** Final canvas. */
  width: number
  height: number
  fit: Fit
  /** Resize step: `sharp.resize(resize.width, resize.height, { fit: resize.fit, background })`. */
  resize: { width: number; height: number; fit: 'fill' | 'contain' | 'cover'; background: string }
  /** Convert to sRGB (sharp `.toColorspace('srgb')` after an ICC-aware read) and drop EXIF/XMP/GPS. */
  colorSpace: 'srgb'
  stripMetadata: true
  maxBytes: number | null
  notes: string[]
}

/**
 * The same picture decisions as ffmpegArgsFor, as a recipe for sharp (which converts ICC profiles properly —
 * iPhone photos are Display P3):
 *
 *   const p = imagePlanFor(spec, { kind: 'image', width, height })
 *   await sharp(src).rotate().resize(p.resize.width, p.resize.height, { fit: p.resize.fit, background: p.resize.background })
 *     .toColorspace('srgb').jpeg({ quality: p.quality, chromaSubsampling: p.chroma, mozjpeg: true }).toFile(out)
 *
 * sharp drops metadata unless told otherwise, which is what `stripMetadata` asks for.
 */
export function imagePlanFor(
  spec: PlacementSpec,
  sourceInfo: SourceInfo,
  options: EncodeOptions = {},
): ImagePlan {
  const src = SourceInfo.parse({ ...sourceInfo, kind: 'image' })
  const opt = EncodeOptions.parse(options)
  const enc = spec.encode.image
  if (!enc) throw new Error(`${spec.key} does not take pictures`)
  const frame = planFrame({ spec, frame: enc.frame, width: src.width, height: src.height, fit: opt.fit })
  const background = opt.padColor ?? enc.padColor
  return {
    format: enc.format,
    outputExt: enc.format === 'jpeg' ? 'jpg' : enc.format,
    quality: enc.quality,
    chroma: enc.chroma,
    width: frame.width,
    height: frame.height,
    fit: frame.fit,
    resize: {
      width: frame.width,
      height: frame.height,
      fit: frame.fit === 'pad' ? 'contain' : frame.fit === 'crop' ? 'cover' : 'fill',
      background,
    },
    colorSpace: 'srgb',
    stripMetadata: true,
    maxBytes: spec.maxBytes.image ?? null,
    notes: [
      `${enc.format.toUpperCase()} ${frame.width}×${frame.height}, quality ${enc.quality}, sRGB, metadata removed.`,
      ...frame.notes,
    ],
  }
}
