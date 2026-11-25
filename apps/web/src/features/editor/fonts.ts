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

/**
 * Google Fonts stylesheets for a family, best first: the styles the edit uses ("700", "italic 400"), then the
 * family's regular style. Google refuses a request for a weight the family doesn't have (Cinzel starts at 400, and
 * asking every family for 100..900 and italics loaded nothing for most of them), so the next one is tried.
 */
export function googleFontUrls(family: string, styles: Iterable<string> = []): string[] {
  const base = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}`
  const tuples = new Map<string, [number, number]>()
  for (const s of styles) {
    const italic = s.startsWith('italic ') ? 1 : 0
    const w = Math.round(Number(italic ? s.slice(7) : s))
    const weight = Number.isFinite(w) && w > 0 ? Math.min(1000, w) : 400
    tuples.set(`${italic},${weight}`, [italic, weight])
  }
  // Google wants the tuples sorted.
  const sorted = [...tuples.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const plain = `${base}&display=block`
  if (!sorted.length) return [plain]
  return [`${base}:ital,wght@${sorted.map(([i, w]) => `${i},${w}`).join(';')}&display=block`, plain]
}

function googleStylesheet(urls: string[]): Promise<void> {
  return new Promise((resolve) => {
    const [href, ...rest] = urls
    if (!href) return resolve()
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => resolve()
    link.onerror = () => {
      link.remove()
      void googleStylesheet(rest).then(resolve)
    }
    document.head.appendChild(link)
  })
}

function ensure(family: string, url?: string, styles: Iterable<string> = []) {
  const bundled = BUNDLED_FONTS[family]
  const urls = bundled || url ? [] : googleFontUrls(family, styles)
  // Google stylesheets are per set of styles: a weight used later loads its own.
  const key = urls[0] ?? family
  let p = loaded.get(key)
  if (p) return p
  if (bundled) p = bundled()
  else if (url) {
    const face = new FontFace(family, `url(${url})`)
    p = face
      .load()
      .then((f) => document.fonts.add(f))
      .catch(() => {})
  } else p = googleStylesheet(urls)
  loaded.set(key, p)
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
  await Promise.all([...uses].map(([f, styles]) => ensure(f, extra.get(f), styles)))
  await Promise.all(doc.fonts.filter((f) => !uses.has(f.family)).map((f) => ensure(f.family, f.url)))
  await Promise.all(
    [...uses].flatMap(([fam, weights]) =>
      [...weights].map((w) => document.fonts.load(`${w} 64px "${fam}"`).catch(() => [])),
    ),
  )
}

export const FONT_CHOICES = Object.keys(BUNDLED_FONTS)
