import { facebook } from './facebook.ts'
import { sameShape } from './geometry.ts'
import { instagram } from './instagram.ts'
import { tiktok } from './tiktok.ts'
import type { MediaKind, PlacementKey, PlacementSpec, PlatformId, PlatformSpec } from './types.ts'
import { youtube } from './youtube.ts'

export * from './ffmpeg.ts'
export { aspectInRange, type FramePlan, planFrame, sameShape, shape } from './geometry.ts'
export * from './image.ts'
export * from './text.ts'
export * from './types.ts'
export * from './validate.ts'
export { facebook, instagram, tiktok, youtube }

/** Every platform, in the order Greenlit shows them. */
export const platforms: Record<PlatformId, PlatformSpec> = { instagram, facebook, tiktok, youtube }
export const platformList: PlatformSpec[] = [instagram, facebook, tiktok, youtube]

/** Every placement of every platform. */
export const placements: PlacementSpec[] = platformList.flatMap((p) => p.placements)
const byKey = new Map(placements.map((p) => [p.key, p]))

export function getPlatform(id: PlatformId): PlatformSpec {
  return platforms[id]
}

/** `getPlacement('instagram.reel')`, or `getPlacement('instagram', 'reel')`. */
export function getPlacement(key: PlacementKey): PlacementSpec
export function getPlacement(platform: PlatformId, placement: string): PlacementSpec | undefined
export function getPlacement(a: string, b?: string): PlacementSpec | undefined {
  const key = b ? `${a}.${b}` : a
  const p = byKey.get(key as PlacementKey)
  if (!p && !b) throw new Error(`Unknown placement ${key}`)
  return p
}

export function placementsFor(platform: PlatformId): PlacementSpec[] {
  return platforms[platform].placements
}

export function placementsForKind(kind: MediaKind): PlacementSpec[] {
  return placements.filter((p) => p.media.kinds.includes(kind))
}

/** The part after the dot: 'instagram.reel' → 'reel'. */
export const placementName = (key: PlacementKey) => key.slice(key.indexOf('.') + 1)

/**
 * Picks the rendition that suits a placement best: one already in the recommended shape, then one of the other
 * good shapes, then anything the placement accepts, then the closest shape (which will be padded or cropped).
 * Ties go to the larger picture. Returns the index, or -1 for an empty list.
 */
export function pickBestFormat(
  spec: PlacementSpec,
  formats: { width: number | null; height: number | null }[],
): number {
  let best = -1
  let bestScore = -Infinity
  formats.forEach((f, i) => {
    if (!f.width || !f.height) return
    const a = f.width / f.height
    const rec = spec.aspect.recommended
    let score: number
    if (sameShape(a, rec)) score = 3
    else if (spec.aspect.alsoGood.some((g) => sameShape(a, g))) score = 2
    else if (a >= spec.aspect.min * 0.98 && a <= spec.aspect.max * 1.02) score = 1
    else score = 0
    // Closer shape, then more pixels (capped at the recommended size).
    const closeness = 1 - Math.min(1, Math.abs(Math.log(a / rec)))
    const px = Math.min(
      f.width * f.height,
      spec.resolution.recommended.width * spec.resolution.recommended.height,
    )
    const total = score * 10 + closeness + px / 1e8
    if (total > bestScore) {
      bestScore = total
      best = i
    }
  })
  return best
}
