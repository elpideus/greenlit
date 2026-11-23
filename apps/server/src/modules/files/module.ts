import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { UploadMetadata } from '@greenlit/shared'
import { FileStore } from '@tus/file-store'
import { Server as TusServer } from '@tus/server'
import { can } from '../../core/actor.ts'
import { HttpError, notFound } from '../../core/errors.ts'
import type { Ctx } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { configureFfmpeg } from '../../lib/ffmpeg.ts'
import { FilesService } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    files: FilesService
  }
}

const USER_HEADER = 'x-greenlit-uploader'

export default defineModule({
  id: 'files',
  name: 'Files',
  description:
    'Stores every file once, resumable uploads (tus), streaming with range requests and signed links.',
  dependsOn: ['users'],
  setup(ctx) {
    configureFfmpeg(ctx.config.ffmpeg, ctx.config.ffprobe)
    const files = new FilesService(ctx)
    ctx.services.provide('files', files)
    for (const d of ['blobs', 'derived', 'tmp', 'uploads', 'archive'] as const)
      mkdirSync(files.dir(d), { recursive: true })

    ctx.jobs.define<{ blobId: string }>('files.hash', {
      concurrency: 1,
      handler: async ({ blobId }) => files.hash(blobId),
    })

    // ── resumable uploads ────────────────────────────────────────────────
    const store = new FileStore({ directory: files.dir('uploads') })
    const tus = new TusServer({
      path: '/api/uploads',
      datastore: store,
      relativeLocation: true,
      respectForwardedHeaders: true,
      maxSize: 200 * 1024 ** 3,
      async onUploadCreate(req, upload) {
        const userId = req.headers.get(USER_HEADER)
        const meta = UploadMetadata.safeParse(upload.metadata ?? {})
        if (!userId || !meta.success)
          throw { status_code: 400, body: 'Upload metadata must include purpose and filename' }
        const def = files.purposes.get(meta.data.purpose)
        if (!def) throw { status_code: 400, body: `Unknown upload purpose ${meta.data.purpose}` }
        const actor = ctx.services.users.actorFor(await ctx.services.users.get(userId), 'web')
        if (!can(actor, def.access)) throw { status_code: 403, body: 'You may not upload this' }
        if (def.maxBytes && upload.size && upload.size > def.maxBytes)
          throw { status_code: 413, body: 'File too large' }
        return { metadata: { ...upload.metadata, userId } }
      },
      async onUploadFinish(req, upload) {
        const meta = UploadMetadata.parse(upload.metadata ?? {})
        const userId = upload.metadata?.userId
        if (!userId || userId !== req.headers.get(USER_HEADER))
          throw { status_code: 403, body: 'Not your upload' }
        const def = files.purposes.get(meta.purpose)!
        const user = await ctx.services.users.get(userId)
        const actor = ctx.services.users.actorFor(user, 'web')
        const source = join(files.dir('uploads'), upload.id)
        const blob = await files.ingest(source, {
          filename: meta.filename,
          mime: meta.filetype || 'application/octet-stream',
          createdBy: userId,
          usage: def.usage,
        })
        await rm(`${source}.json`, { force: true })
        let target: Record<string, unknown> = {}
        try {
          target = JSON.parse(meta.target || '{}')
        } catch {}
        const result = await def.handle(blob, target, actor)
        return {
          status_code: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ uploadId: upload.id, purpose: meta.purpose, blobId: blob.id, result }),
        }
      },
    })

    const handleTus = async (c: Ctx) => {
      const actor = c.get('actor')
      if (!actor || actor.kind !== 'user' || actor.share)
        throw new HttpError('unauthenticated', 'Sign in to upload')
      const headers = new Headers(c.req.raw.headers)
      headers.set(USER_HEADER, actor.user.id)
      const req = new Request(c.req.raw.url, {
        method: c.req.method,
        headers,
        body: ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) ? undefined : c.req.raw.body,
        // @ts-expect-error Node needs duplex for streaming request bodies
        duplex: 'half',
      })
      return tus.handleWeb(req)
    }
    ctx.api.all('/uploads', handleTus)
    ctx.api.all('/uploads/*', handleTus)

    // ── downloads & streaming ───────────────────────────────────────────
    const authorize = async (c: Ctx, blobId: string) => {
      const url = new URL(c.req.url)
      const exp = url.searchParams.get('exp') ?? undefined
      const sig = url.searchParams.get('sig') ?? undefined
      if (sig && files.verify(url.pathname, exp, sig)) return
      if (!(await files.canAccess(blobId, c.get('actor')))) {
        throw c.get('actor')
          ? new HttpError('forbidden', 'You cannot open this file')
          : new HttpError('unauthenticated')
      }
    }

    const original = async (c: Ctx) => {
      const id = c.req.param('id')!
      if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound()
      await authorize(c, id)
      const blob = await files.get(id)
      const download = c.req.query('download') === '1'
      return files.serveBlob(c, blob, download, c.req.query('name') || undefined)
    }
    ctx.api.on(['GET', 'HEAD'], '/files/:id', original)

    ctx.api.on(['GET', 'HEAD'], '/files/:id/d/:name', async (c) => {
      const id = c.req.param('id')
      const name = c.req.param('name')
      if (!/^[0-9a-f-]{36}$/.test(id) || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw notFound()
      await authorize(c, id)
      const file = files.derivedPath(id, name)
      const ext = name.slice(name.lastIndexOf('.'))
      const mime =
        {
          '.jpg': 'image/jpeg',
          '.webp': 'image/webp',
          '.png': 'image/png',
          '.mp4': 'video/mp4',
          '.json': 'application/json',
          '.m4a': 'audio/mp4',
          '.vtt': 'text/vtt',
        }[ext] ?? 'application/octet-stream'
      return files.serveFile(c, file, {
        mime,
        download: c.req.query('download') === '1' ? name : null,
        immutable: !!c.req.query('v'),
      })
    })
  },
})
