import type { BrandFamily, BrandFontFace } from '@greenlit/shared'
import { useEffect, useState } from 'react'

/**
 * A kit's fonts, loaded from its own files under names of their own (`gl-kit-…`), so a kit's "Cinzel" never mixes
 * with the Cinzel Greenlit's themes bundle.
 */

const loading = new Map<string, Promise<boolean>>()

export const kitFamilyName = (projectId: string, family: string) =>
  `gl-kit-${projectId.slice(0, 8)}-${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/** The files that draw a family: its static files, or its variable ones when it has nothing else. */
export function drawingFaces(f: BrandFamily): BrandFontFace[] {
  const fixed = f.faces.filter((x) => !x.variable)
  return fixed.length ? fixed : f.faces
}

function load(name: string, face: BrandFontFace) {
  const key = `${name}:${face.mediaId}`
  let p = loading.get(key)
  if (!p) {
    const weight =
      face.variable && face.weightRange
        ? `${face.weightRange[0]} ${face.weightRange[1]}`
        : String(face.weight)
    const ff = new FontFace(name, `url(${face.url})`, { weight, style: face.italic ? 'italic' : 'normal' })
    p = ff
      .load()
      .then((f) => {
        document.fonts.add(f)
        return true
      })
      .catch(() => false)
    loading.set(key, p)
  }
  return p
}

/** Loads every family of the kit; answers which ones are ready to draw. */
export function useKitFonts(projectId: string, families: BrandFamily[]) {
  const [ready, setReady] = useState<Record<string, boolean>>({})
  const sig = families.map((f) => `${f.family}:${f.faces.map((x) => x.mediaId).join(',')}`).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sig` stands for the families' files
  useEffect(() => {
    let live = true
    for (const f of families) {
      const name = kitFamilyName(projectId, f.family)
      void Promise.all(drawingFaces(f).map((face) => load(name, face))).then((ok) => {
        if (live && ok.some(Boolean)) setReady((r) => ({ ...r, [f.family]: true }))
      })
    }
    return () => {
      live = false
    }
  }, [projectId, sig])
  return ready
}
