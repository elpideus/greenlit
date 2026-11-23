import { open } from 'node:fs/promises'

/**
 * Reads what a TrueType / OpenType font file says about itself, from its table directory only (a few KB, never the
 * glyphs): its names, weight, slant and, for variable fonts, the weight range.
 */

export interface FontNames {
  family: string
  style: string
}

export interface FontInfo extends FontNames {
  /** usWeightClass (100–900; a variable font: its default instance). */
  weight: number
  italic: boolean
  /** Has an `fvar` table: one file for a range of weights (and maybe widths). */
  variable: boolean
  /** The `wght` axis, when variable. */
  weightRange: [number, number] | null
}

/**
 * The family and style a font file calls itself (the typographic names, 16/17, when it has them: "Cinzel" +
 * "Medium" rather than "Cinzel Medium" + "Regular"), or null when it isn't a TrueType/OpenType font.
 */
export async function readFontNames(path: string): Promise<FontNames | null> {
  const info = await readFontInfo(path)
  return info ? { family: info.family, style: info.style } : null
}

export async function readFontInfo(path: string): Promise<FontInfo | null> {
  const fh = await open(path, 'r')
  try {
    const read = async (offset: number, length: number) => {
      const b = Buffer.alloc(length)
      const { bytesRead } = await fh.read(b, 0, length, offset)
      return b.subarray(0, bytesRead)
    }
    let base = 0
    let head = await read(0, 12)
    if (head.length < 12) return null
    if (head.toString('latin1', 0, 4) === 'ttcf') {
      // A collection: the first font's names.
      base = (await read(12, 4)).readUInt32BE(0)
      head = await read(base, 12)
    }
    const version = head.readUInt32BE(0)
    const tag = head.toString('latin1', 0, 4)
    if (version !== 0x00010000 && tag !== 'OTTO' && tag !== 'true') return null
    const numTables = head.readUInt16BE(4)
    if (!numTables || numTables > 512) return null
    const records = await read(base + 12, numTables * 16)
    const tables = new Map<string, { offset: number; length: number }>()
    for (let r = 0; r + 16 <= records.length; r += 16)
      tables.set(records.toString('latin1', r, r + 4), {
        offset: records.readUInt32BE(r + 8),
        length: records.readUInt32BE(r + 12),
      })
    const nameT = tables.get('name')
    if (!nameT || nameT.length < 6 || nameT.length > 1024 * 1024) return null
    const names = parseNames(await read(nameT.offset, nameT.length))
    const family = names.get(16) ?? names.get(1)
    if (!family) return null
    const style = names.get(17) ?? names.get(2) ?? 'Regular'

    let weight = weightFromStyle(style)
    let italic = /italic|oblique/i.test(style)
    const os2 = tables.get('OS/2')
    if (os2 && os2.length >= 64) {
      const b = await read(os2.offset, 64)
      const w = b.readUInt16BE(4)
      if (w >= 1 && w <= 1000) weight = w < 10 ? w * 100 : w
      if (b.readUInt16BE(62) & 0x1) italic = true
    }
    let weightRange: [number, number] | null = null
    const fvar = tables.get('fvar')
    if (fvar && fvar.length >= 16) {
      const b = await read(fvar.offset, Math.min(fvar.length, 16 + 20 * 16))
      const axesOffset = b.readUInt16BE(4)
      const axisCount = b.readUInt16BE(8)
      const axisSize = b.readUInt16BE(10)
      for (let i = 0; i < axisCount; i++) {
        const at = axesOffset + i * axisSize
        if (at + 20 > b.length) break
        if (b.toString('latin1', at, at + 4) !== 'wght') continue
        weightRange = [Math.round(b.readInt32BE(at + 4) / 65536), Math.round(b.readInt32BE(at + 12) / 65536)]
        weight = Math.round(b.readInt32BE(at + 8) / 65536)
      }
    }
    return { family, style, weight, italic, variable: !!fvar, weightRange }
  } finally {
    await fh.close()
  }
}

function parseNames(name: Buffer) {
  const count = name.readUInt16BE(2)
  const strings = name.readUInt16BE(4)
  // nameID → best string found so far, with its score (Windows English first).
  const best = new Map<number, { score: number; value: string }>()
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12
    if (r + 12 > name.length) break
    const platform = name.readUInt16BE(r)
    const encoding = name.readUInt16BE(r + 2)
    const language = name.readUInt16BE(r + 4)
    const id = name.readUInt16BE(r + 6)
    const length = name.readUInt16BE(r + 8)
    const offset = name.readUInt16BE(r + 10)
    if (![1, 2, 16, 17].includes(id)) continue
    const start = strings + offset
    if (start + length > name.length) continue
    const raw = name.subarray(start, start + length)
    let value: string
    let score: number
    if (platform === 3 || platform === 0) {
      value = utf16be(raw)
      score = platform === 3 && (language === 0x409 || encoding === 0) ? 3 : 2
    } else if (platform === 1 && encoding === 0) {
      value = raw.toString('latin1')
      score = 1
    } else continue
    value = value.replace(/\0/g, '').trim()
    if (!value) continue
    const was = best.get(id)
    if (!was || score > was.score) best.set(id, { score, value })
  }
  return new Map([...best].map(([id, v]) => [id, v.value]))
}

function utf16be(b: Buffer) {
  const s: string[] = []
  for (let i = 0; i + 1 < b.length; i += 2) s.push(String.fromCharCode(b.readUInt16BE(i)))
  return s.join('')
}

const WEIGHT_WORDS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra ?light|ultra ?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi ?bold|demi ?bold/i, 600],
  [/extra ?bold|ultra ?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
]

export function weightFromStyle(style: string) {
  for (const [re, w] of WEIGHT_WORDS) if (re.test(style)) return w
  return 400
}
