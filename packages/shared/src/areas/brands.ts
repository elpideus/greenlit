import { z } from 'zod'
import { Id, IsoDate } from '../common.ts'
import { Media } from './media.ts'

/**
 * Brand kits: a project of kind `brand` whose files are a brand's logos, colours, fonts, graphics, templates, looks
 * and guidelines. The files stay ordinary media items (viewer, history, sharing); the brands module sorts them into
 * sections, reads the colours and fonts they carry, and keeps what a folder of files can't say (which logo is the
 * main one, what each colour is for, which font sets titles).
 */

/** The parts of a kit, in the order a kit page shows them. */
export const BRAND_SECTIONS = [
  'logos',
  'colors',
  'fonts',
  'graphics',
  'templates',
  'looks',
  'guidelines',
  'files',
] as const
export const BrandSectionType = z.enum(BRAND_SECTIONS)
export type BrandSectionType = z.infer<typeof BrandSectionType>

/** The background a transparent logo or graphic reads on: light artwork on `dark`, dark artwork on `light`. */
export const BrandSurface = z.enum(['dark', 'light'])
export type BrandSurface = z.infer<typeof BrandSurface>

export const Hex = z.string().regex(/^#[0-9A-F]{6}$/, 'colour as #RRGGBB')

export const BrandColor = z.object({
  id: z.string().min(1).max(40),
  name: z.string().max(80),
  hex: Hex,
  /** Print values as the kit gives them ("C73 M67 Y65 K80"); indicative. */
  cmyk: z.string().max(60).nullable().default(null),
  /** What it is for ("Main background, text on light"). */
  usage: z.string().max(300).default(''),
  /** The kit's own grouping: core, neutral, accent... ('' = none). */
  group: z.string().max(40).default(''),
})
export type BrandColor = z.infer<typeof BrandColor>

export const BrandFontRole = z.enum(['display', 'text', 'other'])
export type BrandFontRole = z.infer<typeof BrandFontRole>

/** What the kit says about a font family. */
export const BrandFontUse = z.object({
  family: z.string().min(1).max(120),
  role: BrandFontRole,
  usage: z.string().max(300).default(''),
  /** Titles set in capitals (GEM: Cinzel, always uppercase). */
  uppercase: z.boolean().default(false),
  /** Tracking in em (0.03 = +3%). */
  letterSpacing: z.number().min(-0.2).max(0.5).nullable().default(null),
  /** The weights the kit uses, e.g. [700] or [300, 400, 500]. */
  weights: z.array(z.number().int().min(100).max(1000)).max(12).default([]),
})
export type BrandFontUse = z.infer<typeof BrandFontUse>

/** One font file of the kit. */
export const BrandFontFace = z.object({
  mediaId: Id,
  family: z.string(),
  style: z.string(),
  /** 100–900 (a variable font: its default instance). */
  weight: z.number(),
  italic: z.boolean(),
  /** A variable font (one file, every weight). */
  variable: z.boolean(),
  /** Its weight range when variable. */
  weightRange: z.tuple([z.number(), z.number()]).nullable(),
  filename: z.string(),
  url: z.string(),
})
export type BrandFontFace = z.infer<typeof BrandFontFace>

export const BrandFamily = BrandFontUse.extend({ faces: z.array(BrandFontFace) })
export type BrandFamily = z.infer<typeof BrandFamily>

/** A file of the kit and where it sits. */
export const BrandAsset = z.object({
  media: Media,
  section: BrandSectionType,
  /** The folder it came from inside its section ("Studio Associato GEM › Vettoriale (SVG)"); '' = none. */
  group: z.string(),
  /** Its path inside the kit as it was added ("01 Loghi/Studio Associato GEM/…svg"); '' = added on its own. */
  path: z.string(),
  /** Transparent artwork: the background it reads on. Null for opaque pictures and other files. */
  surface: BrandSurface.nullable(),
})
export type BrandAsset = z.infer<typeof BrandAsset>

export const BrandSection = z.object({
  type: BrandSectionType,
  /** Its groups in order, each with its files. */
  groups: z.array(z.object({ name: z.string(), assets: z.array(BrandAsset) })),
})
export type BrandSection = z.infer<typeof BrandSection>

export const BrandLogo = z.object({
  mediaId: Id,
  url: z.string(),
  surface: BrandSurface.nullable(),
  /** The kit's colour it sits on in cards (its darkest or lightest core colour). */
  background: Hex.nullable(),
})
export type BrandLogo = z.infer<typeof BrandLogo>

export const BrandKit = z.object({
  projectId: Id,
  name: z.string(),
  /** The kit's own guide (its README), Markdown. */
  guide: z.string(),
  colors: z.array(BrandColor),
  families: z.array(BrandFamily),
  /** The main logo: chosen, or the kit's most likely primary logo. */
  logo: BrandLogo.nullable(),
  /** True when `logo` was chosen by someone, false when Greenlit picked it. */
  logoChosen: z.boolean(),
  /** Only the sections that have files, in BRAND_SECTIONS order. */
  sections: z.array(BrandSection),
  /** Archives (a .zip of the kit dropped into it) still being unpacked: files done of total. */
  unpacking: z
    .object({ files: z.number().int(), done: z.number().int(), total: z.number().int() })
    .nullable(),
  updatedAt: IsoDate,
})
export type BrandKit = z.infer<typeof BrandKit>

/** What a project card shows of a kit. */
export const BrandSummary = z.object({
  logo: BrandLogo.nullable(),
  colors: z.array(Hex),
  families: z.array(z.string()),
})
export type BrandSummary = z.infer<typeof BrandSummary>

export const UpdateBrandKitInput = z.object({
  guide: z.string().max(100_000).optional(),
  colors: z.array(BrandColor).max(200).optional(),
  fonts: z.array(BrandFontUse).max(60).optional(),
  /** null = let Greenlit pick. */
  logoMediaId: Id.nullable().optional(),
})
export type UpdateBrandKitInput = z.infer<typeof UpdateBrandKitInput>

export const MoveBrandAssetInput = z.object({
  section: BrandSectionType,
  group: z.string().max(200).optional(),
})
export type MoveBrandAssetInput = z.infer<typeof MoveBrandAssetInput>

// ── sorting a kit's folders ─────────────────────────────────────────────────

export const FONT_FILE = /\.(ttf|otf|ttc|otc|woff2?)$/i
export const PALETTE_FILE = /\.(ase|gpl|aco|clr|act)$/i
export const LOOK_FILE = /\.(cube|3dl|look|lut|xmp|lrtemplate|dcp|icc)$/i
export const IMAGE_FILE = /\.(png|jpe?g|webp|avif|gif|svg|heic|tiff?)$/i
export const DESIGN_FILE = /\.(figcraft|fig|sketch|xd|psd|ai|indd|afdesign|afphoto)$/i

/** Names that kits use for their folders, in many languages, checked in this order. */
const FOLDER_RULES: [BrandSectionType, RegExp][] = [
  ['files', /\b(sources?|sorgenti|src|scripts?|code|firma|signatures?|email|licen[sc]es?)\b/],
  [
    'guidelines',
    /\b(guidelines?|linee guida|manual[e]?|brand ?book|book|anteprime|previews?|pages|pagine|regole)\b/,
  ],
  ['logos', /\b(logos?|loghi|logotip[io]|marchi|marchio|marks?|lockups?|avatars?|wordmarks?|monograms?)\b/],
  ['colors', /\b(colou?rs?|colori|palettes?|swatch(es)?|campioni)\b/],
  ['fonts', /\b(fonts?|typefaces?|typography|tipografia|caratteri|type)\b/],
  ['looks', /\b(luts?|looks?|presets?|grading|lightroom)\b/],
  ['templates', /\b(templates?|modelli|mockups?|layouts?|social|stampa|print)\b/],
  [
    'graphics',
    /\b(graphics?|grafic[ai]|elementi|elements?|icons?|icone|patterns?|ornament[io]?|textures?|shapes?|illustra\w*|sfondi|backgrounds?|wallpapers?)\b/,
  ],
]

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** "01 Loghi" → "Loghi", "02_colours" → "colours". */
export function folderLabel(name: string) {
  return name.replace(/^\s*\d{1,3}\s*[-_.—–)]*\s*/, '').trim() || name.trim()
}

export function sectionForFolder(name: string): BrandSectionType | null {
  const n = ` ${fold(folderLabel(name)).replace(/[_-]+/g, ' ')} `
  for (const [type, re] of FOLDER_RULES) if (re.test(n)) return type
  return null
}

/** Where a file goes by what it is, when its folder doesn't say. */
export function sectionForFile(filename: string): BrandSectionType {
  const n = fold(filename)
  if (FONT_FILE.test(n)) return 'fonts'
  if (PALETTE_FILE.test(n) || /(colou?rs?|colori|palette|tokens?).*\.(json|css|scss|txt)$/.test(n))
    return 'colors'
  if (LOOK_FILE.test(n)) return 'looks'
  if (/\.pdf$/.test(n) && /(guideline|linee guida|manual|brand ?book|marchio|brand)/.test(n))
    return 'guidelines'
  if (IMAGE_FILE.test(n) && /(logo|marchio|mark|lockup|wordmark|avatar)/.test(n)) return 'logos'
  if (DESIGN_FILE.test(n) || /\.pdf$/.test(n)) return 'templates'
  if (IMAGE_FILE.test(n)) return 'graphics'
  return 'files'
}

/** Files kits carry that aren't part of the kit. */
export function isJunkPath(path: string) {
  return path
    .split('/')
    .some((p) => !p || p.startsWith('.') || p === '__MACOSX' || /^(thumbs\.db|desktop\.ini)$/i.test(p))
}

/** Folder names that only name their section ("Loghi", "Colours"): not worth repeating as a group. */
const PLAIN_NAMES: Record<BrandSectionType, RegExp> = {
  logos: /^(logos?|loghi|logotip[io]|marchi|marchio|marks?)$/,
  colors: /^(colou?rs?|colori|palettes?|swatch(es)?)$/,
  fonts: /^(fonts?|typefaces?|typography|tipografia|caratteri|type)$/,
  graphics: /^(graphics?|grafica|elementi( grafici)?|graphic elements?|elements?)$/,
  templates: /^(templates?|modelli)$/,
  looks: /^(luts?|looks?|presets?)$/,
  guidelines: /^(guidelines?|linee guida|brand ?book|manuale?)$/,
  files: /^(files?|altro|other|misc)$/,
}

/**
 * Where a file of a kit goes, from its path inside the kit: the section the first folder that names one says (or
 * what the file is), and the folders from there down as its group ("01 Loghi/Costruzioni GEM/x.svg" → Logos,
 * "Costruzioni GEM"). A folder that only names the section isn't repeated ("02 Colori/x.ase" → Colours, no group);
 * one that says more is ("00 Anteprime/…" → Guidelines, "Anteprime"). Fonts and looks go to their section wherever
 * they are; so do palette files.
 */
export function placeBrandFile(path: string): { section: BrandSectionType; group: string } {
  const parts = path.split('/').filter(Boolean)
  const filename = parts.pop() ?? ''
  const byFile = sectionForFile(filename)
  let section: BrandSectionType | null = null
  let at = -1
  for (let i = 0; i < parts.length && !section; i++) {
    section = sectionForFolder(parts[i]!)
    if (section) at = i
  }
  const labels = parts.map(folderLabel)
  if (
    byFile === 'fonts' ||
    byFile === 'looks' ||
    (byFile === 'colors' && PALETTE_FILE.test(filename)) ||
    !section
  ) {
    if (section !== byFile) return { section: byFile, group: labels.join(' › ') }
  }
  section ??= byFile
  const named = labels[at] ?? ''
  const keep = named && !PLAIN_NAMES[section].test(fold(named).replace(/[_-]+/g, ' ').trim())
  const group = [...(keep ? [named] : []), ...labels.slice(at + 1)]
  return { section, group: group.join(' › ') }
}

/** The folder all paths share at the top (a kit dropped as its folder: "Branding/…"), or ''. */
export function commonRoot(paths: string[]) {
  if (!paths.length) return ''
  const first = paths[0]!.split('/')
  if (first.length < 2) return ''
  const root = first[0]!
  return paths.every((p) => p.startsWith(`${root}/`)) ? root : ''
}

/**
 * The folder to leave out of the paths of a kit added as its folder ("Branding/01 Loghi/…" → "01 Loghi/…"): the
 * top folder every path shares, unless it names a section itself (a "Logos" folder dropped on its own).
 */
export function kitRoot(paths: string[]) {
  const root = commonRoot(paths)
  return root && !sectionForFolder(root) ? root : ''
}

// ── colours ─────────────────────────────────────────────────────────────────

export function normalizeHex(input: string): string | null {
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!m) return null
  let h = m[1]!
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  return `#${h.slice(0, 6).toUpperCase()}`
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

export function rgbToHex(r: number, g: number, b: number) {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Known group names → a group the UI names in every language. */
export function colorGroupKey(group: string): 'core' | 'neutral' | 'accent' | null {
  const g = fold(group)
  if (/^(core|primary|primar[io]|main|principal[ei]?|brand|base)$/.test(g)) return 'core'
  if (/^(neutral[s]?|neutr[oi]|grays?|greys?|grigi|supporto|support)$/.test(g)) return 'neutral'
  if (/^(accents?|accent[oi]|secondary|secondar[io]|highlights?)$/.test(g)) return 'accent'
  return null
}
