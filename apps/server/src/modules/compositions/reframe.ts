import { readFile, rm } from 'node:fs/promises'
import { type Composition, findClip, type Keyframe } from '@greenlit/composition'
import sharp from 'sharp'
import { badRequest } from '../../core/errors.ts'
import type { ModuleContext } from '../../core/module.ts'
import { ffmpeg } from '../../lib/ffmpeg.ts'

/**
 * "Follow the subject" for reframing (e.g. 16:9 → 9:16): samples the clip, finds the most important region of
 * each frame (sharp's attention strategy: detail, saturation and skin tones — usually the person on screen) and
 * turns it into smoothed focusX/focusY keyframes for one format, so a cover-fit crop keeps the subject in frame.
 */
export async function autoReframe(
  ctx: ModuleContext,
  doc: Composition,
  clipId: string,
  formatId: string,
  opts: { interval?: number; axis?: 'x' | 'y' | 'both' } = {},
) {
  const found = findClip(doc, clipId)
  if (!found || found.clip.type !== 'video' || !found.clip.assetId) throw badRequest('Choose a video clip')
  const clip = found.clip
  const asset = doc.assets[clip.assetId!]
  const format = doc.formats.find((f) => f.id === formatId)
  if (!asset || !format) throw badRequest('Unknown asset or format')
  const formats = await ctx.services.media.formatsOf(asset.mediaId)
  const mf = formats.find((f) => f.key === asset.formatKey) ?? formats.find((f) => f.isPrimary) ?? formats[0]
  if (!mf) throw badRequest('The media file is missing')
  const blob = await ctx.services.files.get(mf.blobId)
  const src = ctx.services.files.hasDerived(blob.id, 'preview.mp4')
    ? ctx.services.files.derivedPath(blob.id, 'preview.mp4')
    : await ctx.services.files.readablePath(blob)

  const srcW = asset.width ?? mf.width ?? 1920
  const srcH = asset.height ?? mf.height ?? 1080
  const boxW = clip.transform.width || format.width
  const boxH = clip.transform.height || format.height
  const target = boxW / boxH
  const source = srcW / srcH
  const axis = opts.axis ?? (source > target ? 'x' : 'y')
  const interval = Math.max(0.2, opts.interval ?? 0.5)
  const sampleW = 480
  const sampleH = Math.round((sampleW * srcH) / srcW)
  // Crop window (in sample pixels) that cover-fit leaves visible.
  const cw = source > target ? Math.round(sampleH * target) : sampleW
  const ch = source > target ? sampleH : Math.round(sampleW / target)

  const samples: { t: number; x: number; y: number }[] = []
  const speed = clip.speed ?? 1
  for (let t = 0; t <= clip.duration + 1e-6; t += interval) {
    const mt = (clip.in ?? 0) + Math.min(t, clip.duration - 0.04) * speed
    const out = await ctx.services.files.tmpPath('.jpg')
    try {
      await ffmpeg([
        '-ss',
        mt.toFixed(3),
        '-i',
        src,
        '-frames:v',
        '1',
        '-vf',
        `scale=${sampleW}:${sampleH}`,
        '-q:v',
        '4',
        out,
      ])
      const { info } = await sharp(await readFile(out))
        .resize(cw, ch, { fit: 'cover', position: sharp.strategy.attention })
        .toBuffer({ resolveWithObject: true })
      const left = Math.abs(info.cropOffsetLeft ?? 0)
      const top = Math.abs(info.cropOffsetTop ?? 0)
      // object-position: the crop's offset as a fraction of the room it can move in.
      const x = sampleW > cw ? left / (sampleW - cw) : 0.5
      const y = sampleH > ch ? top / (sampleH - ch) : 0.5
      samples.push({ t: Math.round(t * 1000) / 1000, x: clamp(x), y: clamp(y) })
    } finally {
      await rm(out, { force: true })
    }
  }
  if (!samples.length) throw badRequest('Could not read the video')

  // Smooth (median of 3, then a moving average) so the frame glides instead of jumping.
  const smooth = (vals: number[]) => {
    const med = vals.map(
      (_, i) => [vals[i - 1] ?? vals[i]!, vals[i]!, vals[i + 1] ?? vals[i]!].sort((a, b) => a - b)[1]!,
    )
    return med.map((_, i) => {
      const w = med.slice(Math.max(0, i - 2), i + 3)
      return w.reduce((a, b) => a + b, 0) / w.length
    })
  }
  const xs = smooth(samples.map((s) => s.x))
  const ys = smooth(samples.map((s) => s.y))
  const keys = (vals: number[]): Keyframe[] => {
    const out: Keyframe[] = []
    for (let i = 0; i < vals.length; i++) {
      const v = Math.round(vals[i]! * 1000) / 1000
      const last = out[out.length - 1]
      // Keep a key when the subject moved enough, plus the first and last.
      if (!last || i === vals.length - 1 || Math.abs(Number(last.value) - v) > 0.04)
        out.push({ t: samples[i]!.t, value: v, easing: 'ease-in-out' })
    }
    return out
  }
  const design = doc.formats[0]!.id === formatId
  const existing = (design ? clip.keyframes : clip.formats?.[formatId]?.keyframes) ?? {}
  const next: Record<string, Keyframe[]> = { ...existing }
  if (axis === 'x' || axis === 'both') next.focusX = keys(xs)
  if (axis === 'y' || axis === 'both') next.focusY = keys(ys)
  // The design format animates the clip itself; other formats get an override.
  const patch: Record<string, unknown> = design
    ? { keyframes: next, fit: 'cover' }
    : { fit: 'cover', formats: { [formatId]: { keyframes: next } } }
  return {
    ops: [{ op: 'update_clip' as const, id: clip.id, patch }],
    samples: samples.length,
    keyframes: { focusX: next.focusX?.length ?? 0, focusY: next.focusY?.length ?? 0 },
  }
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
