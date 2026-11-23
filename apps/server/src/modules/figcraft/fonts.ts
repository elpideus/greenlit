import { copyFile, link, mkdir, readdir, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'

export { type FontNames, readFontNames } from '../../lib/fonts.ts'

/**
 * Font files for design documents. FigCraft ships a few dozen open fonts; brand fonts (Cinzel, Jost for GEM) have
 * to come from somewhere, so Greenlit keeps the ones people add: the browser build loads them when a document asks
 * for their family, and figcraft-cli finds them in `$XDG_DATA_HOME/fonts` when it renders thumbnails.
 */

export const FONT_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.otc'] as const

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
