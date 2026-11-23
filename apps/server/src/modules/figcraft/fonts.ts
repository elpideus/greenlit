import { copyFile, link, mkdir, open, readdir, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'

/**
 * Font files for design documents. FigCraft ships a few dozen open fonts; brand fonts (Cinzel, Jost for GEM) have
 * to come from somewhere, so Greenlit keeps the ones people add: the browser build loads them when a document asks
 * for their family, and figcraft-cli finds them in `$XDG_DATA_HOME/fonts` when it renders thumbnails.
 */

export const FONT_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.otc'] as const

export interface FontNames {
  family: string
  style: string
}

/**
 * The family and style a font file calls itself (the typographic names, 16/17, when it has them: "Cinzel" +
 * "Medium" rather than "Cinzel Medium" + "Regular"), or null when it isn't a TrueType/OpenType font.
 */
export async function readFontNames(path: string): Promise<FontNames | null> {
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
    const tag = head.toString('latin1', 0, 4)
    if (tag === 'ttcf') {
      // A collection: the first font's names.
      base = (await read(12, 4)).readUInt32BE(0)
      head = await read(base, 12)
    }
    const version = head.readUInt32BE(0)
    if (
      version !== 0x00010000 &&
      head.toString('latin1', 0, 4) !== 'OTTO' &&
      head.toString('latin1', 0, 4) !== 'true'
    )
      return null
    const numTables = head.readUInt16BE(4)
    if (!numTables || numTables > 512) return null
    const records = await read(base + 12, numTables * 16)
    let nameOffset = -1
    let nameLength = 0
    for (let i = 0; i < numTables; i++) {
      if (records.toString('latin1', i * 16, i * 16 + 4) === 'name') {
        nameOffset = records.readUInt32BE(i * 16 + 8)
        nameLength = records.readUInt32BE(i * 16 + 12)
      }
    }
    if (nameOffset < 0 || nameLength < 6 || nameLength > 1024 * 1024) return null
    const name = await read(nameOffset, nameLength)
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
    const family = best.get(16)?.value ?? best.get(1)?.value
    const style = best.get(17)?.value ?? best.get(2)?.value ?? 'Regular'
    return family ? { family, style } : null
  } finally {
    await fh.close()
  }
}

function utf16be(b: Buffer) {
  const s: string[] = []
  for (let i = 0; i + 1 < b.length; i += 2) s.push(String.fromCharCode(b.readUInt16BE(i)))
  return s.join('')
}

export interface StoredFont {
  id: string
  blobId: string
  family: string
  style: string
  filename: string
  size: number
  createdAt: string
}

/**
 * Makes `dir` hold exactly these fonts (hard links to the blobs, which never change; copies across file systems),
 * named so figcraft-cli can tell their type.
 */
export async function syncFontDir(dir: string, fonts: StoredFont[], pathOf: (blobId: string) => string) {
  await mkdir(dir, { recursive: true })
  const wanted = new Map(fonts.map((f) => [`${f.id}${extOf(f.filename)}`, f]))
  for (const name of await readdir(dir)) if (!wanted.has(name)) await rm(join(dir, name), { force: true })
  const have = new Set(await readdir(dir))
  for (const [name, f] of wanted) {
    if (have.has(name)) continue
    const dest = join(dir, name)
    try {
      await link(pathOf(f.blobId), dest)
    } catch {
      await copyFile(pathOf(f.blobId), dest).catch(() => {})
    }
  }
}

export function extOf(filename: string) {
  const ext = extname(filename).toLowerCase()
  return (FONT_EXTENSIONS as readonly string[]).includes(ext) ? ext : '.ttf'
}
