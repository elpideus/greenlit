import type { Composition } from '@greenlit/composition'

/**
 * Fonts an edit can use. The bundled ones ship with Greenlit (the same files in the editor and the headless
 * renderer, so exports match the preview); anything else listed in `doc.fonts` is loaded from its URL or from
 * Google Fonts by family name.
 */
export const BUNDLED_FONTS: Record<string, () => Promise<unknown>> = {
  'Inter Variable': () => import('@fontsource-variable/inter'),
  'Geist Variable': () => import('@fontsource-variable/geist'),
  'Geist Mono Variable': () => import('@fontsource-variable/geist-mono'),
  'Jost Variable': () => import('@fontsource-variable/jost'),
  'Cinzel Variable': () => import('@fontsource-variable/cinzel'),
  'JetBrains Mono Variable': () => import('@fontsource-variable/jetbrains-mono'),
}

const loaded = new Map<string, Promise<unknown>>()

function ensure(family: string, url?: string) {
  let p = loaded.get(family)
  if (p) return p
  const bundled = BUNDLED_FONTS[family]
  if (bundled) p = bundled()
  else if (url) {
    const face = new FontFace(family, `url(${url})`)
    p = face
      .load()
      .then((f) => document.fonts.add(f))
      .catch(() => {})
  } else {
    p = new Promise<void>((resolve) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@0,100..900;1,100..900&display=block`
      link.onload = () => resolve()
      link.onerror = () => resolve()
      document.head.appendChild(link)
    })
  }
  loaded.set(family, p)
  return p
}

/** Loads every font the document uses and waits until text can be drawn with them. */
export async function loadDocumentFonts(doc: Composition) {
  const uses = new Map<string, Set<string>>()
  for (const t of doc.tracks)
    for (const c of t.clips) {
      if (c.type !== 'text') continue
      const fam = c.text?.fontFamily ?? 'Inter Variable'
      const w = String(c.text?.fontWeight ?? 700)
      const style = c.text?.italic ? 'italic ' : ''
      if (!uses.has(fam)) uses.set(fam, new Set())
      uses.get(fam)!.add(`${style}${w}`)
    }
  if (!uses.has('Inter Variable')) uses.set('Inter Variable', new Set(['700']))
  const extra = new Map(doc.fonts.map((f) => [f.family, f.url]))
  await Promise.all([...uses.keys()].map((f) => ensure(f, extra.get(f))))
  await Promise.all(doc.fonts.map((f) => ensure(f.family, f.url)))
  await Promise.all(
    [...uses].flatMap(([fam, weights]) =>
      [...weights].map((w) => document.fonts.load(`${w} 64px "${fam}"`).catch(() => [])),
    ),
  )
}

export const FONT_CHOICES = Object.keys(BUNDLED_FONTS)
