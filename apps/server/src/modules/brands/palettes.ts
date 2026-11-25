import {
  type BrandColor,
  type BrandFontUse,
  colorGroupKey,
  normalizeHex,
  PALETTE_FILE,
  rgbToHex,
} from '@greenlit/shared'

/**
 * Reads the colours (and, from design tokens and CSS, the fonts) a kit's palette files carry: design tokens (W3C
 * `$value`, Style Dictionary `value`, or plain `"name": "#hex"`), Adobe Swatch Exchange (.ase), GIMP palettes
 * (.gpl) and CSS custom properties. Different files of one kit usually list the same colours: `mergeColors` joins
 * them by value, keeping the best name, the usage and the print values from whichever file has them.
 */

export interface ParsedColor {
  name: string
  hex: string
  cmyk: string | null
  usage: string
  group: string
}

export type FontFound = Required<Omit<BrandFontUse, 'letterSpacing'>> & { letterSpacing: number | null }

export function isPaletteFile(filename: string) {
  return PALETTE_FILE.test(filename) || /\.(json|css|scss)$/i.test(filename)
}

export function parsePalette(filename: string, data: Buffer): { colors: ParsedColor[]; fonts: FontFound[] } {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  try {
    if (ext === 'ase') return { colors: parseAse(data), fonts: [] }
    if (ext === 'gpl') return { colors: parseGpl(data.toString('utf8')), fonts: [] }
    if (ext === 'css' || ext === 'scss') return parseCss(data.toString('utf8'))
    if (ext === 'json') return parseTokens(JSON.parse(data.toString('utf8')))
  } catch {}
  return { colors: [], fonts: [] }
}

// ── design tokens ───────────────────────────────────────────────────────────

const COLOR_STRING = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([^)]*\))$/i
const USAGE_KEYS = ['$description', 'description', 'comment', 'usage', 'use', 'role', 'ruolo', 'uso', 'note']
const GROUP_KEYS = ['group', 'type', 'tipo', 'category', 'categoria', 'kind']
const CMYK_KEYS = /^(cmyk.*|print)$/i
const COLOR_ROOTS = /^(colou?rs?|colori|palette|swatch(es)?)$/i
const FONT_ROOTS = /^(fonts?|typography|type|font-?famil(y|ies)|caratteri|tipografia)$/i

function colorValue(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!COLOR_STRING.test(s)) return null
  if (s.startsWith('#')) return normalizeHex(s)
  const n = s.match(/[\d.]+/g)?.map(Number) ?? []
  return n.length >= 3 ? rgbToHex(n[0]!, n[1]!, n[2]!) : null
}

const pretty = (key: string) =>
  key
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()

const text = (node: Record<string, unknown>, keys: string[]) => {
  for (const k of keys)
    if (typeof node[k] === 'string' && (node[k] as string).trim()) return (node[k] as string).trim()
  return ''
}

function parseTokens(root: unknown): { colors: ParsedColor[]; fonts: FontFound[] } {
  const colors: ParsedColor[] = []
  const fonts: FontFound[] = []
  const walk = (node: unknown, path: string[]) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    const obj = node as Record<string, unknown>
    for (const [key, v] of Object.entries(obj)) {
      if (key.startsWith('$') && key !== '$value') continue
      const direct = colorValue(v)
      if (direct && !['value', '$value'].includes(key)) {
        colors.push({ name: pretty(key), hex: direct, cmyk: null, usage: '', group: groupOf(path) })
        continue
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const child = v as Record<string, unknown>
        const hex = colorValue(child.$value ?? child.value ?? child.hex)
        if (hex) {
          const cmykKey = Object.keys(child).find((k) => CMYK_KEYS.test(k))
          const cmyk = cmykKey && typeof child[cmykKey] === 'string' ? (child[cmykKey] as string) : null
          colors.push({
            name: text(child, ['name', 'label', 'nome']) || pretty(key),
            hex,
            cmyk:
              cmyk?.trim() ||
              (Array.isArray(child[cmykKey ?? '']) ? (child[cmykKey!] as number[]).join(' ') : null),
            usage: text(child, USAGE_KEYS),
            group: text(child, GROUP_KEYS) || groupOf(path),
          })
          continue
        }
        if (FONT_ROOTS.test(path[0] ?? '') || FONT_ROOTS.test(key)) {
          const family = fontFamily(child.family ?? child.fontFamily ?? child.$value ?? child.value)
          if (family) {
            fonts.push({
              family,
              role: /display|heading|title|titol|headline/i.test(key)
                ? 'display'
                : /text|body|testo|copy|paragraph/i.test(key)
                  ? 'text'
                  : 'other',
              weights: weightsOf(child.weight ?? child.weights ?? child.fontWeight),
              uppercase: /upper|maiusc/i.test(String(child.case ?? child.textTransform ?? '')),
              letterSpacing: emOf(child.letterSpacing ?? child.tracking),
              usage: text(child, USAGE_KEYS),
            })
            continue
          }
        }
        walk(child, [...path, key])
      }
    }
  }
  const groupOf = (path: string[]) => {
    const p = path.filter((s) => !COLOR_ROOTS.test(s))
    return p.length ? pretty(p[p.length - 1]!) : ''
  }
  walk(root, [])
  return { colors, fonts }
}

function fontFamily(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const first = v
    .split(',')[0]!
    .trim()
    .replace(/^['"]|['"]$/g, '')
  return first || null
}

function weightsOf(v: unknown): number[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
  return list
    .map((w) =>
      typeof w === 'string'
        ? (({ bold: 700, regular: 400, light: 300, medium: 500 } as Record<string, number>)[
            w.toLowerCase()
          ] ?? Number(w))
        : Number(w),
    )
    .filter((w) => Number.isFinite(w) && w >= 100 && w <= 1000)
}

function emOf(v: unknown): number | null {
  if (typeof v === 'number') return Math.abs(v) < 1 ? v : null
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(-?[\d.]+)\s*(em|%)?$/)
  if (!m) return null
  const n = Number(m[1])
  return m[2] === '%' ? n / 100 : Math.abs(n) < 1 ? n : null
}

// ── CSS custom properties ───────────────────────────────────────────────────

function parseCss(css: string): { colors: ParsedColor[]; fonts: FontFound[] } {
  const colors: ParsedColor[] = []
  const fonts: FontFound[] = []
  const props = [...css.matchAll(/--([\w-]+)\s*:\s*([^;]+);[ \t]*(?:\/\*\s*(.*?)\s*\*\/)?/g)]
  // A prefix every property shares ("acme-") isn't part of the names.
  const names = props.map((p) => p[1]!)
  const prefix = names.length > 1 ? sharedPrefix(names) : ''
  for (const [, name, value, comment] of props) {
    const key = name!.slice(prefix.length)
    const hex = colorValue(value!.trim())
    if (hex) {
      colors.push({ name: pretty(key), hex, cmyk: null, usage: comment ?? '', group: '' })
      continue
    }
    if (/font/i.test(key)) {
      const family = fontFamily(value!)
      if (family)
        fonts.push({
          family,
          role: /display|heading|title/i.test(key)
            ? 'display'
            : /text|body|copy/i.test(key)
              ? 'text'
              : 'other',
          weights: [],
          uppercase: /maiuscol|uppercase|capitals/i.test(comment ?? ''),
          letterSpacing: null,
          usage: comment ?? '',
        })
    }
  }
  return { colors, fonts }
}

function sharedPrefix(names: string[]) {
  const first = names[0]!.split('-')
  let n = 0
  while (n < first.length - 1 && names.every((x) => x.split('-')[n] === first[n])) n++
  return n ? `${first.slice(0, n).join('-')}-` : ''
}

// ── GIMP palette ────────────────────────────────────────────────────────────

function parseGpl(src: string): ParsedColor[] {
  const out: ParsedColor[] = []
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*(.*)$/)
    if (!m) continue
    const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]))
    const name = m[4]!.trim()
    out.push({ name: /^untitled$/i.test(name) ? '' : name, hex, cmyk: null, usage: '', group: '' })
  }
  return out
}

// ── Adobe Swatch Exchange ───────────────────────────────────────────────────

export function parseAse(b: Buffer): ParsedColor[] {
  if (b.length < 12 || b.toString('latin1', 0, 4) !== 'ASEF') return []
  const count = b.readUInt32BE(8)
  const out: ParsedColor[] = []
  let at = 12
  let group = ''
  for (let i = 0; i < count && at + 6 <= b.length; i++) {
    const type = b.readUInt16BE(at)
    const length = b.readUInt32BE(at + 2)
    const body = b.subarray(at + 6, at + 6 + length)
    at += 6 + length
    if (type === 0xc002) {
      group = ''
      continue
    }
    if (body.length < 2) continue
    const nameLen = body.readUInt16BE(0)
    const name = utf16(body.subarray(2, 2 + nameLen * 2))
    if (type === 0xc001) {
      group = name
      continue
    }
    if (type !== 0x0001) continue
    let p = 2 + nameLen * 2
    const model = body.toString('latin1', p, p + 4).trim()
    p += 4
    const f = (k: number) => body.readFloatBE(p + k * 4)
    let hex: string | null = null
    let cmyk: string | null = null
    if (model === 'RGB') hex = rgbToHex(f(0) * 255, f(1) * 255, f(2) * 255)
    else if (model === 'CMYK') {
      const [c, m, y, k] = [f(0), f(1), f(2), f(3)]
      hex = rgbToHex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k))
      cmyk = `C${Math.round(c * 100)} M${Math.round(m * 100)} Y${Math.round(y * 100)} K${Math.round(k * 100)}`
    } else if (model === 'Gray') hex = rgbToHex(f(0) * 255, f(0) * 255, f(0) * 255)
    else if (model === 'LAB') hex = labToHex(f(0) * 100, f(1), f(2))
    if (hex) out.push({ name, hex, cmyk, usage: '', group })
  }
  return out
}

function utf16(b: Buffer) {
  let s = ''
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i))
  return s.replace(/\0+$/, '').trim()
}

function labToHex(l: number, a: number, bb: number) {
  let y = (l + 16) / 116
  let x = a / 500 + y
  let z = y - bb / 200
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
  x = 0.95047 * f(x)
  y = f(y)
  z = 1.08883 * f(z)
  const lin = [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.204 + z * 1.057,
  ].map((v) => (v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v) * 255)
  return rgbToHex(lin[0]!, lin[1]!, lin[2]!)
}

// ── merging ─────────────────────────────────────────────────────────────────

/** A name that is only the colour's value or a key ("dark-gray") loses to one people wrote ("Acme Dark Gray"). */
const nameScore = (n: string) => (!n ? 0 : /^#?[0-9a-f]{6}$/i.test(n) ? 1 : /[A-Z].*\s|\s/.test(n) ? 3 : 2)

/**
 * Joins colours read from several files of one kit: the same value is one colour. The first file's order wins;
 * each field comes from whichever file has the best of it.
 */
export function mergeColors(existing: BrandColor[], found: ParsedColor[]): BrandColor[] {
  const out = existing.map((c) => ({ ...c }))
  const byHex = new Map(out.map((c) => [c.hex, c]))
  for (const f of found) {
    const was = byHex.get(f.hex)
    if (was) {
      const fuller = f.name.length > was.name.length && f.name.toLowerCase().includes(was.name.toLowerCase())
      if (nameScore(f.name) > nameScore(was.name) || (fuller && nameScore(f.name) >= nameScore(was.name)))
        was.name = f.name
      if (!was.usage && f.usage) was.usage = f.usage
      if (!was.cmyk && f.cmyk) was.cmyk = f.cmyk
      if (!was.group && f.group) was.group = f.group
      continue
    }
    const c: BrandColor = {
      id: uniqueId(f.name || f.hex, out),
      name: f.name || f.hex,
      hex: f.hex,
      cmyk: f.cmyk,
      usage: f.usage,
      group: f.group,
    }
    out.push(c)
    byHex.set(c.hex, c)
  }
  return out
}

function uniqueId(name: string, taken: BrandColor[]) {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'colour'
  let id = base
  for (let n = 2; taken.some((c) => c.id === id); n++) id = `${base}-${n}`
  return id
}

/** Font uses found in several files: one per family, the richest description wins. */
export function mergeFonts(existing: BrandFontUse[], found: FontFound[]): BrandFontUse[] {
  const out = existing.map((f) => ({ ...f }))
  for (const f of found) {
    const was = out.find((x) => x.family.toLowerCase() === f.family.toLowerCase())
    if (!was) {
      out.push({ ...f })
      continue
    }
    if (was.role === 'other' && f.role !== 'other') was.role = f.role
    if (!was.weights.length && f.weights.length) was.weights = f.weights
    if (!was.uppercase && f.uppercase) was.uppercase = true
    if (was.letterSpacing === null && f.letterSpacing !== null) was.letterSpacing = f.letterSpacing
    if (!was.usage && f.usage) was.usage = f.usage
  }
  return out
}

/** Sorted the way kits present them: core, then neutrals, then accents, then the rest, each in kit order. */
export function groupRank(group: string) {
  const k = colorGroupKey(group)
  return k === 'core' ? 0 : k === 'neutral' ? 1 : k === 'accent' ? 2 : 3
}
