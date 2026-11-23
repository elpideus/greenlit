import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DesignFrame, DesignInfo, DesignPage } from '@greenlit/shared'
import sharp from 'sharp'
import { ZipReader } from '../../lib/zip.ts'

/**
 * Reading FigCraft documents (`.figcraft`: a zip with `document.json`, `images/<sha256>`, `thumbnail.png` and an
 * optional version history). Greenlit never edits them: FigCraft itself does, in the browser (see webapp.ts).
 */

/** Largest document.json we parse (FigCraft's own limit is in the same range). */
const MAX_DOCUMENT = 256 * 1024 * 1024
/** Longest side of the poster Greenlit renders (thumbnails come from it). */
const POSTER_SIDE = 2400
const RENDER_TIMEOUT_MS = 90_000

/** The layer types that sit at the top of a page as boards to look at. */
const FRAME_TYPES = new Set(['frame', 'section', 'component', 'componentSet', 'instance', 'group'])

type Node = {
  id?: number
  name?: string
  type?: string
  children?: number[]
  width?: number
  height?: number
  transform?: number[]
  style?: { font_family?: string } | null
  runs?: { style?: { font_family?: string } | null }[] | null
}

type Doc = {
  format?: string
  version?: number
  name?: string
  pages?: number[]
  nodes?: Record<string, Node>
  styles?: { type?: string; kind?: string }[]
  variables?: { variables?: unknown[] }
  imageIndex?: unknown[]
  comments?: unknown[]
}

export class NotADesign extends Error {}

/** What the document holds, and its own thumbnail (FigCraft writes a small one on every save). */
export async function readDesign(path: string): Promise<{ info: DesignInfo; thumbnail: Buffer | null }> {
  let zip: ZipReader
  try {
    zip = await ZipReader.open(path)
  } catch {
    throw new NotADesign('This is not a FigCraft file (it is not a zip archive)')
  }
  try {
    const raw = await zip.read('document.json', MAX_DOCUMENT)
    if (!raw) throw new NotADesign('This is not a FigCraft file (no document.json inside)')
    let doc: Doc
    try {
      doc = JSON.parse(raw.toString('utf8')) as Doc
    } catch {
      throw new NotADesign('The FigCraft document is damaged (document.json is not JSON)')
    }
    if (doc.format !== 'figcraft' || !doc.nodes) throw new NotADesign('This is not a FigCraft document')
    const thumbnail = await zip.read('thumbnail.png', 32 * 1024 * 1024).catch(() => null)
    const versions = zip.entries.filter(
      (e) => /^versions\/[^/]+\.json$/.test(e.name) && e.name !== 'versions/index.json',
    ).length
    return { info: describe(doc, !!thumbnail, versions), thumbnail }
  } finally {
    await zip.close()
  }
}

function describe(doc: Doc, thumbnail: boolean, versions: number): DesignInfo {
  const nodes = doc.nodes ?? {}
  const node = (id: number) => nodes[String(id)]
  const pages: DesignPage[] = (doc.pages ?? []).flatMap((pid) => {
    const p = node(pid)
    if (!p) return []
    const frames: DesignFrame[] = (p.children ?? []).flatMap((cid) => {
      const c = node(cid)
      if (!c || !FRAME_TYPES.has(c.type ?? '')) return []
      return [
        {
          id: cid,
          name: c.name ?? '',
          type: c.type ?? 'frame',
          x: round(c.transform?.[4] ?? 0),
          y: round(c.transform?.[5] ?? 0),
          width: round(c.width ?? 0),
          height: round(c.height ?? 0),
        },
      ]
    })
    return [{ id: pid, name: p.name ?? '', frames }]
  })
  const fonts = new Set<string>()
  let layers = 0
  let components = 0
  for (const n of Object.values(nodes)) {
    if (n.type !== 'page') layers++
    if (n.type === 'component' || n.type === 'componentSet') components++
    if (n.style?.font_family) fonts.add(n.style.font_family)
    for (const r of n.runs ?? []) if (r.style?.font_family) fonts.add(r.style.font_family)
  }
  const styles = doc.styles ?? []
  return {
    app: 'figcraft',
    formatVersion: doc.version ?? 1,
    name: doc.name ?? '',
    pages,
    layers,
    components,
    textStyles: styles.filter((s) => (s.type ?? s.kind) === 'text').length,
    styles: styles.length,
    variables: doc.variables?.variables?.length ?? 0,
    images: doc.imageIndex?.length ?? 0,
    comments: doc.comments?.length ?? 0,
    versions,
    fonts: [...fonts].sort((a, b) => a.localeCompare(b)),
    thumbnail,
    rendered: 'none',
  }
}

const round = (n: number) => Math.round(n * 100) / 100

/** The single board of a one-frame design (a 1080 × 1350 post): the item's size. Otherwise none. */
export function soleFrame(info: DesignInfo) {
  const frames = info.pages.flatMap((p) => p.frames)
  return frames.length === 1 ? frames[0]! : null
}

/** Where figcraft-cli finds fonts: `$XDG_DATA_HOME/fonts` (fonts.ts keeps Greenlit's there). */
export interface Renderer {
  cli: string
  xdgDataHome: string
}

/**
 * Makes the derived files of a design: poster.webp + thumb.webp (rendered from the first page with figcraft-cli when
 * it is installed, else from the document's own thumbnail) and design.json (the DesignInfo the viewer shows).
 */
export async function processDesign(
  src: string,
  out: string,
  renderer: Renderer | null,
  signal: AbortSignal,
): Promise<{ info: DesignInfo; derived: string[] }> {
  const { info, thumbnail } = await readDesign(src)
  const derived: string[] = []
  let picture: Buffer | null = null
  if (renderer && info.pages.length) {
    try {
      picture = await renderPage(renderer, src, info, signal)
      if (picture) info.rendered = 'cli'
    } catch (err) {
      if (signal.aborted) throw err
      picture = null
    }
  }
  if (!picture && thumbnail) {
    picture = thumbnail
    info.rendered = 'embedded'
  }
  if (picture) {
    await sharp(picture, { failOn: 'none' })
      .resize(POSTER_SIDE, POSTER_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88 })
      .toFile(join(out, 'poster.webp'))
    await sharp(picture, { failOn: 'none' })
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join(out, 'thumb.webp'))
    derived.push('poster.webp', 'thumb.webp')
  }
  await writeFile(join(out, 'design.json'), JSON.stringify(info))
  derived.push('design.json')
  return { info, derived }
}

/** The first page as PNG, its longest side about POSTER_SIDE (big pages scaled down, small ones up). */
async function renderPage(r: Renderer, src: string, info: DesignInfo, signal: AbortSignal) {
  const page = info.pages[0]!
  const side = pageSide(page)
  const scale = side > 0 ? Math.min(4, Math.max(0.05, Math.floor((POSTER_SIDE / side) * 1000) / 1000)) : 1
  // The renderer may only read the document's folder and write its own.
  const dir = join(r.xdgDataHome, 'tmp', crypto.randomUUID())
  await mkdir(dir, { recursive: true })
  const outFile = join(dir, 'page.png')
  try {
    const args = ['render', src, '--out', outFile, '--page', page.name, '--scale', String(scale)]
    await runCli(r, args, dirname(src), dir, signal)
    if (!existsSync(outFile)) return null
    return await sharp(outFile).png().toBuffer()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The longest side of the box around a page's frames. */
function pageSide(page: DesignPage) {
  if (!page.frames.length) return 0
  const x0 = Math.min(...page.frames.map((f) => f.x))
  const y0 = Math.min(...page.frames.map((f) => f.y))
  const x1 = Math.max(...page.frames.map((f) => f.x + f.width))
  const y1 = Math.max(...page.frames.map((f) => f.y + f.height))
  return Math.max(x1 - x0, y1 - y0)
}

/** Exports layers (frames) of a document as image files into `dir`; returns the files written. */
export async function exportNodes(
  r: Renderer,
  src: string,
  nodes: { id: number; page: string; name: string }[],
  opts: { format: 'png' | 'jpg' | 'webp' | 'svg' | 'pdf'; scale: number },
  signal: AbortSignal,
): Promise<{ id: number; name: string; file: string }[]> {
  const dir = join(r.xdgDataHome, 'tmp', crypto.randomUUID())
  await mkdir(dir, { recursive: true })
  const done: { id: number; name: string; file: string }[] = []
  for (const n of nodes) {
    const file = join(dir, `${n.id}.${opts.format}`)
    const args = [
      'export',
      src,
      '--out',
      file,
      '--page',
      n.page,
      '--node',
      String(n.id),
      '--format',
      opts.format,
    ]
    if (opts.format !== 'svg' && opts.format !== 'pdf') args.push('--scale', String(opts.scale))
    await runCli(r, args, dirname(src), dir, signal)
    if (existsSync(file)) done.push({ id: n.id, name: n.name, file })
  }
  return done
}

/** The folder exportNodes wrote into (to clean up after). */
export function exportDir(files: { file: string }[]) {
  return files[0] ? dirname(files[0].file) : null
}

function runCli(r: Renderer, args: string[], readRoot: string, writeRoot: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      r.cli,
      [args[0]!, '--automation-read-root', readRoot, '--automation-write-root', writeRoot, ...args.slice(1)],
      {
        signal,
        timeout: RENDER_TIMEOUT_MS,
        env: { ...process.env, XDG_DATA_HOME: r.xdgDataHome, HOME: r.xdgDataHome },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    let err = ''
    child.stderr.on('data', (d) => {
      if (err.length < 4000) err += String(d)
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`figcraft-cli ${args[0]} failed: ${err.trim() || code}`)),
    )
  })
}

/** Leftover render folders from a crash. */
export async function cleanRenderTmp(xdgDataHome: string) {
  const dir = join(xdgDataHome, 'tmp')
  for (const name of await readdir(dir).catch(() => [] as string[]))
    await rm(join(dir, name), { recursive: true, force: true })
}
