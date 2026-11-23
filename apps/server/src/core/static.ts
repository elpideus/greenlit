import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import type { Hono } from 'hono'

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.exr': 'image/x-exr',
  '.pfm': 'image/x-portable-floatmap',
  '.figcraft': 'application/x-figcraft',
}

/** Serves the built web app; unknown paths fall back to index.html so client-side routes work. */
// biome-ignore lint/suspicious/noExplicitAny: works for any Hono env
export function serveWebApp(app: Hono<any>, dist: string) {
  const index = join(dist, 'index.html')
  if (!existsSync(index)) return false
  app.get('*', (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname)
    if (path.startsWith('/api/')) return c.notFound()
    const file = normalize(join(dist, path))
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
      const immutable = path.startsWith('/assets/')
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        headers: {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
          'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
        },
      })
    }
    return new Response(Readable.toWeb(createReadStream(index)) as ReadableStream, {
      headers: { 'content-type': MIME['.html']!, 'cache-control': 'no-cache' },
    })
  })
  return true
}
