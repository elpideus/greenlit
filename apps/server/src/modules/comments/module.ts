import { readFile } from 'node:fs/promises'
import { Comment, CommentPin, CommentTargetType, CreateCommentInput } from '@greenlit/shared'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { type Actor, actorUserId, assertCan, can, isAdmin } from '../../core/actor.ts'
import { badRequest, forbidden, notFound } from '../../core/errors.ts'
import { IdParams, Ok, route } from '../../core/http.ts'
import { McpContent } from '../../core/mcp.ts'
import { defineModule, type ModuleContext } from '../../core/module.ts'
import { ffmpeg } from '../../lib/ffmpeg.ts'
import { users } from '../users/schema.ts'
import { commentAttachments, comments } from './schema.ts'

type Row = typeof comments.$inferSelect
type AttRow = typeof commentAttachments.$inferSelect

declare module '../../core/events.ts' {
  interface Events {
    'comment.created': {
      id: string
      targetType: string
      targetId: string
      authorId: string
      parentId: string | null
    }
    'comment.resolved': { id: string; targetType: string; targetId: string; done: boolean }
  }
}

export interface CommentsService {
  list: (targetType: string, targetId: string, actor: Actor) => Promise<Comment[]>
  create: (input: z.infer<typeof CreateCommentInput>, actor: Actor) => Promise<Comment>
}
declare module '../../core/services.ts' {
  interface Services {
    comments: CommentsService
  }
}

export default defineModule({
  id: 'comments',
  name: 'Comments & change requests',
  description: 'Feedback on media pinned to a spot on the frame and a moment in the video, with attachments.',
  dependsOn: ['users', 'files', 'media'],
  after: ['notifications'],
  permissions: {
    'comments.read': { description: 'Read comments', roles: ['reviewer'] },
    'comments.create': { description: 'Write comments and replies', roles: ['reviewer'] },
    'comments.resolve': { description: 'Mark comments as done', roles: [] },
    'comments.moderate': { description: "Edit or delete other people's comments", roles: [] },
  },
  setup(ctx) {
    const svc = build(ctx)
    ctx.services.provide('comments', svc)
    const tags = ['Comments']

    route(ctx.api, {
      method: 'get',
      path: '/comments',
      summary: 'Comments on an item, as threads (oldest first)',
      tags,
      access: 'comments.read',
      query: z.object({ targetType: CommentTargetType, targetId: z.uuid() }),
      response: z.array(Comment),
      handler: ({ actor, query }) => svc.list(query.targetType, query.targetId, actor),
    })
    route(ctx.api, {
      method: 'post',
      path: '/comments',
      summary: 'Write a comment or a reply (optionally pinned to a spot and a moment)',
      tags,
      access: 'comments.create',
      body: CreateCommentInput,
      response: Comment,
      status: 201,
      handler: ({ actor, body }) => svc.create(body, actor),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/comments/{id}',
      summary: 'Edit a comment',
      tags,
      access: 'comments.create',
      params: IdParams,
      body: z.object({
        body: z.string().min(1).max(20_000).optional(),
        pin: CommentPin.nullable().optional(),
      }),
      response: Comment,
      handler: ({ actor, params, body }) => svc.edit(params.id, body, actor),
    })
    route(ctx.api, {
      method: 'post',
      path: '/comments/{id}/resolve',
      summary: 'Mark a comment as done (or open it again)',
      tags,
      access: 'comments.resolve',
      params: IdParams,
      body: z.object({ done: z.boolean() }),
      response: Comment,
      handler: ({ actor, params, body }) => svc.resolve(params.id, body.done, actor),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/comments/{id}',
      summary: 'Delete a comment',
      tags,
      access: 'comments.create',
      params: IdParams,
      response: Ok,
      handler: async ({ actor, params }) => {
        await svc.remove(params.id, actor)
        return { ok: true as const }
      },
    })

    // Attachments uploaded from a device or pasted: they only belong to the comment.
    ctx.services.files.purpose('comment.attachment', {
      access: 'comments.create',
      maxBytes: 4 * 1024 ** 3,
      usage: 'attachment',
      handle: async (blob) => {
        if (blob.mime.startsWith('image/')) {
          try {
            const dir = ctx.services.files.derivedDir(blob.id)
            await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }))
            await sharp(ctx.services.files.absPath(blob), { failOn: 'none' })
              .rotate()
              .resize(480, 480, { fit: 'inside' })
              .webp({ quality: 80 })
              .toFile(`${dir}/thumb.webp`)
          } catch {}
        }
        return { id: blob.id, name: blob.filename, mime: blob.mime, size: blob.size }
      },
    })
    ctx.hooks.add('files.access', async ({ blobId, actor }) => {
      const [att] = await ctx.db
        .select({ commentId: commentAttachments.commentId })
        .from(commentAttachments)
        .where(eq(commentAttachments.blobId, blobId))
        .limit(1)
      if (!att) {
        // A just-uploaded attachment is visible to its uploader before the comment is posted.
        const blob = await ctx.services.files.get(blobId).catch(() => null)
        if (blob?.usage === 'attachment' && actor.kind === 'user' && blob.createdBy === actor.user.id)
          return true
        return undefined
      }
      const [c] = await ctx.db.select().from(comments).where(eq(comments.id, att.commentId))
      return c ? ctx.entities.canView(c.targetType, c.targetId, actor) : false
    })

    ctx.hooks.add('media.decorate', async ({ ids }) => {
      const rows = await ctx.db
        .select({
          id: comments.targetId,
          total: sql<number>`count(*)::int`,
          open: sql<number>`count(*) filter (where ${comments.status} = 'open' and ${comments.parentId} is null)::int`,
        })
        .from(comments)
        .where(
          and(eq(comments.targetType, 'media'), inArray(comments.targetId, ids), isNull(comments.deletedAt)),
        )
        .groupBy(comments.targetId)
      return Object.fromEntries(rows.map((r) => [r.id, { commentCount: r.total, openCommentCount: r.open }]))
    })

    ctx.versions.register('comment', {
      labels: { body: 'text', status: 'status', pin: 'pin' },
      coalesceSeconds: 30,
      snapshot: async (id) => {
        const [c] = await ctx.db.select().from(comments).where(eq(comments.id, id))
        return c
          ? {
              body: c.body,
              status: c.status,
              pin: c.pin as Record<string, unknown> | null,
              deletedAt: c.deletedAt?.toISOString() ?? null,
            }
          : null
      },
      restore: async (id, d) => {
        await ctx.db
          .update(comments)
          .set({
            body: d.body as string,
            status: d.status as string,
            pin: d.pin ?? null,
            deletedAt: d.deletedAt ? new Date(d.deletedAt as string) : null,
          })
          .where(eq(comments.id, id))
      },
    })

    // ── MCP ─────────────────────────────────────────────────────────────
    ctx.mcp.tool({
      name: 'comments_list',
      description:
        'Read the feedback on a media item (or composition/post): threads with the spot on the frame (x,y from 0 to 1), the time in seconds for videos, status open/done and attachments. Use comments_view to SEE what a comment points at.',
      input: {
        targetId: z.uuid(),
        targetType: CommentTargetType.optional(),
        status: z.enum(['open', 'done', 'all']).optional(),
      },
      access: 'comments.read',
      readOnly: true,
      handler: async ({ targetId, targetType, status }, { actor }) => {
        const list = await svc.list(targetType ?? 'media', targetId, actor)
        return list
          .filter((c) => !status || status === 'all' || c.status === status)
          .map((c) => ({
            id: c.id,
            author: c.author.displayName,
            body: c.body,
            time: c.time,
            pin: c.pin?.point ?? null,
            region: c.pin?.region ?? null,
            format: c.formatId,
            status: c.status,
            attachments: c.attachments.map((a) =>
              a.kind === 'media' ? { media: a.mediaId, title: a.title } : { file: a.name, url: a.url },
            ),
            replies: ((c.replies ?? []) as Comment[]).map((r) => ({
              id: r.id,
              author: r.author.displayName,
              body: r.body,
            })),
          }))
      },
    })
    ctx.mcp.tool({
      name: 'comments_view',
      description:
        'Shows the frame a comment refers to with the pinned spot, box and drawing marked on it, so you can see exactly what the reviewer means.',
      input: { id: z.uuid() },
      access: 'comments.read',
      readOnly: true,
      handler: async ({ id }, { actor }) => {
        const c = await svc.row(id)
        if (!(await ctx.entities.canView(c.targetType, c.targetId, actor))) throw notFound()
        if (c.targetType !== 'media') return 'Only media comments can be shown as a frame.'
        const formats = await ctx.services.media.formatsOf(c.targetId)
        const f = formats.find((x) => x.id === c.formatId) ?? formats.find((x) => x.isPrimary) ?? formats[0]
        if (!f) throw notFound()
        const blob = await ctx.services.files.get(f.blobId)
        let image: Buffer
        if (f.kind === 'video') {
          const out = await ctx.services.files.tmpPath('.jpg')
          await ffmpeg([
            '-ss',
            String(c.time ?? 0),
            '-i',
            await ctx.services.files.readablePath(blob),
            '-frames:v',
            '1',
            '-q:v',
            '3',
            out,
          ])
          image = await readFile(out)
        } else
          image = await readFile(
            ctx.services.files.hasDerived(blob.id, 'poster.webp')
              ? ctx.services.files.derivedPath(blob.id, 'poster.webp')
              : await ctx.services.files.readablePath(blob),
          )
        const base = sharp(image).resize(1280, 1280, { fit: 'inside' })
        const meta = await base.clone().toBuffer({ resolveWithObject: true })
        const W = meta.info.width
        const H = meta.info.height
        const pin = c.pin as z.infer<typeof CommentPin> | null
        let svg = ''
        if (pin) {
          if (pin.region)
            svg += `<rect x="${pin.region.x * W}" y="${pin.region.y * H}" width="${pin.region.w * W}" height="${pin.region.h * H}" fill="none" stroke="#ffcc00" stroke-width="4"/>`
          for (const s of pin.strokes ?? [])
            svg += `<polyline points="${s.map((p) => `${p.x * W},${p.y * H}`).join(' ')}" fill="none" stroke="#ff3b30" stroke-width="4" stroke-linecap="round"/>`
          svg += `<circle cx="${pin.point.x * W}" cy="${pin.point.y * H}" r="18" fill="none" stroke="#ffcc00" stroke-width="5"/><circle cx="${pin.point.x * W}" cy="${pin.point.y * H}" r="4" fill="#ffcc00"/>`
        }
        const out = await sharp(meta.data)
          .composite(
            svg
              ? [
                  {
                    input: Buffer.from(
                      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`,
                    ),
                  },
                ]
              : [],
          )
          .jpeg({ quality: 84 })
          .toBuffer()
        return new McpContent([
          { type: 'text', text: `"${c.body}"${c.time !== null ? ` at ${c.time.toFixed(2)} s` : ''}` },
          { type: 'image', data: out.toString('base64'), mimeType: 'image/jpeg' },
        ])
      },
    })
    ctx.mcp.tool({
      name: 'comments_reply',
      description: 'Reply to a comment (e.g. to say what you changed).',
      input: { id: z.uuid(), body: z.string().min(1) },
      access: 'comments.create',
      handler: async ({ id, body }, { actor }) => {
        const parent = await svc.row(id)
        return svc.create(
          CreateCommentInput.parse({
            targetType: parent.targetType,
            targetId: parent.targetId,
            parentId: parent.parentId ?? parent.id,
            body,
          }),
          actor,
        )
      },
    })
    ctx.mcp.tool({
      name: 'comments_resolve',
      description:
        'Mark a comment (change request) as done once it has been addressed, or reopen it with done=false.',
      input: { id: z.uuid(), done: z.boolean().default(true) },
      access: 'comments.resolve',
      handler: ({ id, done }, { actor }) => svc.resolve(id, done, actor),
    })
  },
})

function build(ctx: ModuleContext) {
  const { db } = ctx
  const files = ctx.services.files

  const row = async (id: string) => {
    const [r] = await db.select().from(comments).where(eq(comments.id, id))
    if (!r || r.deletedAt) throw notFound('Comment not found')
    return r
  }

  const views = async (rows: Row[], actor: Actor): Promise<Comment[]> => {
    const ids = rows.map((r) => r.id)
    const atts = ids.length
      ? await db
          .select()
          .from(commentAttachments)
          .where(inArray(commentAttachments.commentId, ids))
          .orderBy(asc(commentAttachments.position))
      : []
    const refs = await ctx.services.users.refs(rows.flatMap((r) => [r.authorId, r.resolvedBy]))
    const mediaIds = atts.filter((a) => a.kind === 'media' && a.mediaId).map((a) => a.mediaId!)
    const media = new Map((await ctx.services.media.many(mediaIds, actor)).map((m) => [m.id, m]))
    const attView = (a: AttRow) => {
      if (a.kind === 'media') {
        const m = media.get(a.mediaId!)
        return {
          kind: 'media' as const,
          mediaId: a.mediaId!,
          formatId: a.formatId,
          title: m?.title ?? 'Unavailable',
          thumbnailUrl: m?.thumbnailUrl ?? null,
          mediaKind: m?.kind ?? 'other',
        }
      }
      return {
        kind: 'file' as const,
        id: a.blobId!,
        name: a.name ?? 'file',
        mime: a.mime ?? 'application/octet-stream',
        size: a.size ?? 0,
        url: `/api/files/${a.blobId}`,
        thumbnailUrl: a.mime?.startsWith('image/') ? `/api/files/${a.blobId}/d/thumb.webp` : null,
      }
    }
    const unknown = {
      id: '00000000-0000-0000-0000-000000000000',
      displayName: 'Former user',
      avatarUrl: null,
    }
    return rows.map((r) => ({
      id: r.id,
      targetType: r.targetType as Comment['targetType'],
      targetId: r.targetId,
      formatId: r.formatId,
      parentId: r.parentId,
      author: refs.get(r.authorId) ?? unknown,
      body: r.body,
      pin: (r.pin as Comment['pin']) ?? null,
      time: r.time,
      frame: r.frame,
      fileRevision: r.fileRevision,
      attachments: atts.filter((a) => a.commentId === r.id).map(attView),
      status: r.status as 'open' | 'done',
      resolvedBy: r.resolvedBy ? (refs.get(r.resolvedBy) ?? null) : null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
    }))
  }

  const ensureTarget = async (type: string, id: string, actor: Actor) => {
    if (!(await ctx.entities.canView(type, id, actor))) throw notFound('Item not found')
  }

  const publish = (r: Pick<Row, 'targetType' | 'targetId' | 'id'>, event: string) => {
    ctx.realtime.publish(`${r.targetType}:${r.targetId}`, event, { id: r.id })
    if (r.targetType === 'media') ctx.realtime.publish('library', 'media.updated', { id: r.targetId })
  }

  const notifyFor = async (c: Row, actor: Actor) => {
    const notifications = ctx.services.notifications
    if (!notifications || actor.kind !== 'user') return
    const recipients = new Set<string>()
    // Reviewers' feedback goes to the admins; replies go to everyone in the thread.
    if (actor.user.role !== 'admin') {
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.disabled, false)))
      for (const a of admins) recipients.add(a.id)
    }
    if (c.parentId) {
      const thread = await db
        .select({ a: comments.authorId })
        .from(comments)
        .where(sql`${comments.id} = ${c.parentId} or ${comments.parentId} = ${c.parentId}`)
      for (const t of thread) recipients.add(t.a)
    }
    // @mentions by display name
    const people = await db.select({ id: users.id, name: users.displayName }).from(users)
    for (const p of people)
      if (c.body.toLowerCase().includes(`@${p.name.toLowerCase()}`)) recipients.add(p.id)
    recipients.delete(actor.user.id)
    const [summary] = await ctx.entities
      .summarize([{ type: c.targetType, id: c.targetId }], { kind: 'system', source: 'system' })
      .then((m) => [...m.values()])
    await notifications.notify([...recipients], {
      kind: c.parentId ? 'comment.reply' : 'comment.created',
      title: `${actor.user.displayName} ${c.parentId ? 'replied' : 'commented'} on ${summary?.title ?? 'an item'}`,
      body: c.body.slice(0, 280),
      link: `${summary?.href ?? '/'}?tab=comments&comment=${c.id}${c.time !== null ? `&t=${c.time}` : ''}`,
      actorId: actor.user.id,
      entityType: c.targetType,
      entityId: c.targetId,
    })
  }

  return {
    row,
    async list(targetType: string, targetId: string, actor: Actor) {
      await ensureTarget(targetType, targetId, actor)
      const rows = await db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.targetType, targetType),
            eq(comments.targetId, targetId),
            isNull(comments.deletedAt),
          ),
        )
        .orderBy(asc(comments.createdAt))
      const all = await views(rows, actor)
      const top = all.filter((c) => !c.parentId)
      for (const t of top) t.replies = all.filter((c) => c.parentId === t.id)
      return top
    },
    async create(input: z.infer<typeof CreateCommentInput>, actor: Actor) {
      await ensureTarget(input.targetType, input.targetId, actor)
      const authorId = actorUserId(actor)
      if (!authorId) throw badRequest('Comments need a person as author')
      let parentId = input.parentId
      if (parentId) {
        const parent = await row(parentId)
        if (parent.targetId !== input.targetId) throw badRequest('Reply to a comment on the same item')
        parentId = parent.parentId ?? parent.id
      }
      let fileRevision: number | null = null
      if (input.formatId && input.targetType === 'media') {
        const f = await ctx.services.media.formatRow(input.formatId).catch(() => null)
        fileRevision = f?.fileRevision ?? null
      }
      const [c] = await db
        .insert(comments)
        .values({
          targetType: input.targetType,
          targetId: input.targetId,
          formatId: input.formatId,
          parentId,
          authorId,
          body: input.body.trim(),
          pin: input.pin,
          time: input.time,
          frame: input.frame,
          fileRevision,
        })
        .returning()
      let pos = 0
      for (const a of input.attachments) {
        if (a.kind === 'media') {
          if (!(await ctx.services.media.canView(a.mediaId, actor))) continue
          await db
            .insert(commentAttachments)
            .values({
              commentId: c!.id,
              kind: 'media',
              mediaId: a.mediaId,
              formatId: a.formatId,
              position: pos++,
            })
        } else {
          const blob = await files.get(a.id)
          if (blob.createdBy !== authorId && !isAdmin(actor)) throw forbidden('That file is not yours')
          await db
            .insert(commentAttachments)
            .values({
              commentId: c!.id,
              kind: 'file',
              blobId: blob.id,
              name: blob.filename,
              mime: blob.mime,
              size: blob.size,
              position: pos++,
            })
        }
      }
      await ctx.versions.record('comment', c!.id, actor, { force: true })
      publish(c!, 'comment.created')
      ctx.events.emit('comment.created', {
        id: c!.id,
        targetType: c!.targetType,
        targetId: c!.targetId,
        authorId,
        parentId,
      })
      void notifyFor(c!, actor).catch((err) => ctx.log.warn({ err }, 'comment notification failed'))
      const [view] = await views([c!], actor)
      return view!
    },
    async edit(id: string, patch: { body?: string; pin?: z.infer<typeof CommentPin> | null }, actor: Actor) {
      const c = await row(id)
      if (c.authorId !== actorUserId(actor) && !can(actor, 'comments.moderate'))
        throw forbidden('Only the author can edit this comment')
      await db
        .update(comments)
        .set({
          ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
          ...(patch.pin !== undefined ? { pin: patch.pin } : {}),
          editedAt: new Date(),
        })
        .where(eq(comments.id, id))
      await ctx.versions.record('comment', id, actor)
      publish(c, 'comment.updated')
      const [view] = await views([await row(id)], actor)
      return view!
    },
    async resolve(id: string, done: boolean, actor: Actor) {
      const c = await row(id)
      assertCan(actor, 'comments.resolve')
      await db
        .update(comments)
        .set({
          status: done ? 'done' : 'open',
          resolvedBy: done ? actorUserId(actor) : null,
          resolvedAt: done ? new Date() : null,
        })
        .where(eq(comments.id, id))
      await ctx.versions.record('comment', id, actor, { force: true })
      publish(c, 'comment.updated')
      ctx.events.emit('comment.resolved', { id, targetType: c.targetType, targetId: c.targetId, done })
      if (done && ctx.services.notifications && c.authorId !== actorUserId(actor)) {
        const [s] = [
          ...(
            await ctx.entities.summarize([{ type: c.targetType, id: c.targetId }], {
              kind: 'system',
              source: 'system',
            })
          ).values(),
        ]
        await ctx.services.notifications.notify([c.authorId], {
          kind: 'comment.resolved',
          title: `Done: "${c.body.slice(0, 60)}${c.body.length > 60 ? '…' : ''}"`,
          body: `${actor.kind === 'user' ? actor.user.displayName : 'Greenlit'} marked your comment on ${s?.title ?? 'an item'} as done`,
          link: `${s?.href ?? '/'}?tab=comments&comment=${c.id}`,
          actorId: actorUserId(actor),
          entityType: c.targetType,
          entityId: c.targetId,
        })
      }
      const [view] = await views([await row(id)], actor)
      return view!
    },
    async remove(id: string, actor: Actor) {
      const c = await row(id)
      if (c.authorId !== actorUserId(actor) && !can(actor, 'comments.moderate'))
        throw forbidden('Only the author can delete this comment')
      await db
        .update(comments)
        .set({ deletedAt: new Date() })
        .where(sql`${comments.id} = ${id} or ${comments.parentId} = ${id}`)
      await ctx.versions.record('comment', id, actor, { force: true })
      publish(c, 'comment.deleted')
    },
  }
}
