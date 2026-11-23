import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createBrotliCompress, createGzip, constants as zlib } from 'node:zlib'
import { MIME } from '../../core/static.ts'
import { ZipReader } from '../../lib/zip.ts'

/**
 * The FigCraft browser build (MIT OR Apache-2.0, storytold/figcraft): the official release zip, pinned and checked by
 * its SHA-256, unpacked once and served from Greenlit's own origin so the viewer can frame it in host mode
 * (`?host=parent` only talks to a same-origin parent). The Docker image has it baked in; elsewhere it is fetched the
 * first time the server starts.
 */
export const FIGCRAFT_WEB = {
  version: '0.18.1',
  url: 'https://github.com/storytold/figcraft/releases/download/v0.18.1/figcraft-web-0.18.1.zip',
  sha256: '2fbeb93f5022b0a7cc9d8528f1ed7e2b54c94d213ef79e65128aa898c399f02b',
} as const

/** Written last, so a half-unpacked folder is never taken for a ready one. */
const READY_MARK = '.greenlit-ready'
const COMPRESSIBLE = new Set(['.wasm', '.js', '.html'])

export type WebAppState = 'ready' | 'installing' | 'missing' | 'failed'

export class FigcraftWebApp {
  readonly dir: string
  state: WebAppState
  error: string | null = null
  private installing: Promise<void> | null = null

  constructor(dir: string) {
    this.dir = dir
    this.state = isReady(dir) ? 'ready' : 'missing'
  }

  /** Fetch and unpack the pinned build unless it is here already. Safe to call more than once. */
  ensure(log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
    if (this.state === 'ready') return Promise.resolve()
    this.installing ??= (async () => {
      this.state = 'installing'
      this.error = null
      try {
        await removeLeftovers(this.dir)
        log?.info({ version: FIGCRAFT_WEB.version }, 'fetching the FigCraft browser build')
        await installWebApp(this.dir)
        this.state = 'ready'
        log?.info({ dir: this.dir }, 'FigCraft browser build ready')
      } catch (err) {
        this.state = 'failed'
        this.error = (err as Error).message
        log?.warn({ err: this.error }, 'could not install the FigCraft browser build')
      } finally {
        this.installing = null
      }
    })()
    return this.installing
  }

  /** A file of the build, compressed when the browser takes it; null when there is no such file. */
  async serve(path: string, acceptEncoding: string) {
    if (this.state !== 'ready') return null
    const rel = path.replace(/^\/+/, '') || 'index.html'
    if (rel.split('/').some((p) => p.startsWith('.'))) return null
    const root = normalize(this.dir)
    const file = normalize(join(root, rel))
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return null
    const ext = extname(file)
    const headers: Record<string, string> = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      // Hashed names (figcraft-web-<hash>.js) never change; the page itself is small and checked each time.
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      vary: 'accept-encoding',
    }
    let body = file
    if (COMPRESSIBLE.has(ext)) {
      if (/\bbr\b/.test(acceptEncoding) && existsSync(`${file}.br`)) {
        body = `${file}.br`
        headers['content-encoding'] = 'br'
      } else if (/\bgzip\b/.test(acceptEncoding) && existsSync(`${file}.gz`)) {
        body = `${file}.gz`
        headers['content-encoding'] = 'gzip'
      }
    }
    headers['content-length'] = String((await stat(body)).size)
    return new Response(Readable.toWeb(createReadStream(body)) as ReadableStream, { headers })
  }
}

/** Half-made folders of installs a restart cut short. */
async function removeLeftovers(dir: string) {
  const parent = join(dir, '..')
  const base = `${dir.slice(parent.length + 1)}.part-`
  for (const name of await readdir(parent).catch(() => [] as string[]))
    if (name.startsWith(base)) await rm(join(parent, name), { recursive: true, force: true })
}

function isReady(dir: string) {
  return existsSync(join(dir, READY_MARK)) && existsSync(join(dir, 'index.html'))
}

/**
 * Downloads the release zip (or reads `from`), checks its SHA-256, unpacks its folder into `dir` and precompresses
 * the big files (the wasm is ~25 MB raw, ~5 MB with Brotli). Replaces `dir` only once everything worked.
 */
export async function installWebApp(dir: string, from?: string) {
  const work = `${dir}.part-${process.pid}-${Date.now()}`
  await mkdir(work, { recursive: true })
  try {
    const zipPath = join(work, 'figcraft-web.zip')
    const hash = createHash('sha256')
    const tap = new Transform({
      transform(chunk, _enc, done) {
        hash.update(chunk)
        done(null, chunk)
      },
    })
    if (from) await pipeline(createReadStream(from), tap, createWriteStream(zipPath))
    else {
      const res = await fetch(FIGCRAFT_WEB.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10 * 60_000),
      })
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
      await pipeline(Readable.fromWeb(res.body as never), tap, createWriteStream(zipPath))
    }
    const got = hash.digest('hex')
    if (got !== FIGCRAFT_WEB.sha256)
      throw new Error(`the download's checksum is wrong (${got}, expected ${FIGCRAFT_WEB.sha256})`)
    const unpacked = join(work, 'unpacked')
    const zip = await ZipReader.open(zipPath)
    try {
      await zip.extractAll(unpacked)
    } finally {
      await zip.close()
    }
    // The release keeps everything in figcraft-web-<version>/.
    const top = (await readdir(unpacked)).find((n) => existsSync(join(unpacked, n, 'index.html')))
    const site = top ? join(unpacked, top) : unpacked
    if (!existsSync(join(site, 'index.html'))) throw new Error('the archive has no index.html')
    for (const name of await readdir(site)) {
      if (!COMPRESSIBLE.has(extname(name))) continue
      const file = join(site, name)
      await pipeline(createReadStream(file), createGzip({ level: 9 }), createWriteStream(`${file}.gz`))
      await pipeline(
        createReadStream(file),
        createBrotliCompress({
          params: {
            [zlib.BROTLI_PARAM_QUALITY]: 10,
            [zlib.BROTLI_PARAM_SIZE_HINT]: (await stat(file)).size,
          },
        }),
        createWriteStream(`${file}.br`),
      )
    }
    await writeFile(join(site, READY_MARK), `${FIGCRAFT_WEB.version}\n`)
    await rm(dir, { recursive: true, force: true })
    await mkdir(join(dir, '..'), { recursive: true })
    await rename(site, dir)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
