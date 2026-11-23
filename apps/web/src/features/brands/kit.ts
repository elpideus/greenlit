import {
  type BrandAsset,
  type BrandKit,
  type BrandSectionType,
  type BrandSurface,
  colorGroupKey,
  luminance,
  type MediaFormat,
} from '@greenlit/shared'
import {
  Box,
  FileStack,
  Images,
  LayoutTemplate,
  type LucideIcon,
  Palette,
  Shapes,
  Sparkles,
  Type,
} from 'lucide-react'

export const SECTION_ICON: Record<BrandSectionType | 'type', LucideIcon> = {
  logos: Box,
  colors: Palette,
  fonts: Type,
  type: Type,
  graphics: Shapes,
  templates: LayoutTemplate,
  looks: Sparkles,
  guidelines: Images,
  files: FileStack,
}

export const primary = (a: BrandAsset): MediaFormat | undefined =>
  a.media.formats.find((f) => f.isPrimary) ?? a.media.formats[0]

export const extOf = (f: MediaFormat | undefined) => (f?.filename.split('.').pop() ?? '').toUpperCase()

/** The kit's own darkest and lightest colours: what transparent artwork sits on. */
export function surfaces(kit: Pick<BrandKit, 'colors'>) {
  const core = kit.colors.filter((c) => colorGroupKey(c.group) === 'core')
  const pool = (core.length >= 2 ? core : kit.colors).map((c) => c.hex)
  const sorted = [...pool].sort((a, b) => luminance(a) - luminance(b))
  const dark = sorted.find((h) => luminance(h) < 0.08) ?? '#161616'
  const light = [...sorted].reverse().find((h) => luminance(h) > 0.7) ?? '#F2F2F2'
  return { dark, light }
}

export function surfaceColor(surface: BrandSurface | null, s: { dark: string; light: string }) {
  return surface === 'dark' ? s.dark : surface === 'light' ? s.light : null
}

/** Text that reads on a colour. */
export const inkOn = (hex: string) => (luminance(hex) > 0.36 ? 'rgba(0,0,0,0.82)' : 'rgba(255,255,255,0.92)')

/**
 * The same artwork in several files (logo.svg + logo.png in one folder) is one tile with a chip per file. The SVG
 * leads: it draws crisp at any size.
 */
export function pairFiles(assets: BrandAsset[]) {
  const by = new Map<string, BrandAsset[]>()
  for (const a of assets) {
    const name = (primary(a)?.filename ?? a.media.title).replace(/\.[^.]+$/, '').toLowerCase()
    by.set(name, [...(by.get(name) ?? []), a])
  }
  return [...by.values()].map((list) => {
    const sorted = [...list].sort((a, b) => rank(a) - rank(b))
    return { lead: sorted[0]!, files: sorted }
  })
}
const rank = (a: BrandAsset) => {
  const m = primary(a)?.mime ?? ''
  return m === 'image/svg+xml' ? 0 : m.startsWith('image/') ? 1 : 2
}

/** Groups of small artwork (icons): smaller tiles. */
export const isIconGroup = (name: string, assets: BrandAsset[]) =>
  /icon|icone|icona|pictogram/i.test(name) ||
  assets.every((a) => /icon|icona/i.test(primary(a)?.filename ?? ''))

export const sectionAnchor = (s: string) => `kit-${s}`
