import { createHash, randomBytes } from 'node:crypto'
import { CreateShareLinkInput, ShareLink } from '@greenlit/shared'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { actorUserId } from '../../core/actor.ts'
import { badRequest, HttpError } from '../../core/errors.ts'
import { IdParams, Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { setSessionCookie } from '../users/module.ts'
import { shareLinks } from './schema.ts'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** Where a share link lands in the web app. */
function pathFor(type: string, id: string | null) {
  switch (type) {
    case 'post':
      return `/posts/${id}`
    case 'media':
      return `/media/${id}`
    case 'project':
      return `/projects/${id}`
    default:
      return '/calendar'
  }
}

export default defineModule({
  id: 'share',
  name: 'Share links',
  description:
    'Single-use links that sign a chosen person in and open a post, media item, project or the calendar.',
  dependsOn: ['users'],
  after: ['posts', 'media', 'projects'],
  permissions: {
    'share.create': { description: 'Create share links for people', roles: [] },
  },
  setup(ctx) {
    const users = ctx.services.users
    const tags = ['Share']

    // Share sessions may open what the link points at, and what is inside it.
    ctx.hooks.add('share.allowsMedia', ({ actor, mediaId, projectId }) => {
      if (actor.kind !== 'user' || !actor.share) return undefined
      if (actor.share.targetType === 'media') return actor.share.targetId === mediaId
      if (actor.share.targetType === 'project') return actor.share.targetId === projectId
      return undefined
    })
    ctx.hooks.add('share.allowsProject', ({ actor, projectId }) => {
      if (actor.kind !== 'user' || !actor.share) return undefined
      return actor.share.targetType === 'project' && actor.share.targetId === projectId
    })

    const view = async (r: typeof shareLinks.$inferSelect): Promise<ShareLink> => {
      const refs = await users.refs([r.userId, r.createdBy])
      const [summary] = r.targetId
        ? [
            ...(
              await ctx.entities.summarize([{ type: r.targetType, id: r.targetId }], {
                kind: 'system',
                source: 'system',
              })
            ).values(),
          ]
        : []
      const unknown = { id: r.userId, displayName: 'Former user', avatarUrl: null }
      return {
        id: r.id,
        user: refs.get(r.userId) ?? unknown,
        targetType: r.targetType as ShareLink['targetType'],
        targetId: r.targetId,
        targetTitle: summary?.title ?? (r.targetType === 'calendar' ? 'Calendar' : ''),
        expiresAt: r.expiresAt.toISOString(),
        usedAt: r.usedAt?.toISOString() ?? null,
        createdBy: refs.get(r.createdBy) ?? unknown,
        createdAt: r.createdAt.toISOString(),
      }
    }

    route(ctx.api, {
      method: 'post',
      path: '/share-links',
      summary: 'Create a single-use link that signs this person in and opens the item',
      tags,
      access: 'share.create',
      body: CreateShareLinkInput,
      response: ShareLink,
      status: 201,
      handler: async ({ actor, body }) => {
        const user = await users.get(body.userId)
        if (user.disabled) throw badRequest('That account is disabled')
        if (body.targetType !== 'calendar') {
          if (!body.targetId) throw badRequest('Choose what the link opens')
          if (!(await ctx.entities.canView(body.targetType, body.targetId, users.actorFor(user, 'web'))))
            throw badRequest(`${user.displayName} cannot see this item`)
        }
        const token = randomBytes(24).toString('base64url')
        const [r] = await ctx.db
          .insert(shareLinks)
          .values({
            tokenHash: sha256(token),
            userId: user.id,
            targetType: body.targetType,
            targetId: body.targetId,
            expiresAt: new Date(Date.now() + body.expiresInHours * 3600_000),
            createdBy: actorUserId(actor)!,
          })
          .returning()
        const base = ctx.config.isProd
          ? ctx.services.platform?.settings().publicUrl || ctx.config.publicUrl
          : ctx.config.webUrl
        return { ...(await view(r!)), url: `${base.replace(/\/$/, '')}/s/${token}` }
      },
    })

    route(ctx.api, {
      method: 'get',
      path: '/share-links',
      summary: 'Share links (open ones first)',
      tags,
      access: 'share.create',
      query: z.object({ targetId: z.uuid().optional() }),
      response: z.array(ShareLink),
      handler: async ({ query }) => {
        const rows = await ctx.db
          .select()
          .from(shareLinks)
          .where(query.targetId ? eq(shareLinks.targetId, query.targetId) : undefined)
          .orderBy(desc(shareLinks.createdAt))
          .limit(200)
        return Promise.all(rows.map(view))
      },
    })

    route(ctx.api, {
      method: 'delete',
      path: '/share-links/{id}',
      summary: 'Revoke a share link',
      tags,
      access: 'share.create',
      params: IdParams,
      response: Ok,
      handler: async ({ params }) => {
        await ctx.db.delete(shareLinks).where(eq(shareLinks.id, params.id))
        return { ok: true as const }
      },
    })

    // Opening the link: sign in as the assigned person (limited to the item), burn the link, go to the item.
    ctx.api.get('/share/redeem/:token', async (c) => {
      const hash = sha256(c.req.param('token'))
      const [r] = await ctx.db
        .update(shareLinks)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(shareLinks.tokenHash, hash),
            isNull(shareLinks.usedAt),
            gt(shareLinks.expiresAt, new Date()),
          ),
        )
        .returning()
      if (!r) {
        const [used] = await ctx.db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hash))
        throw new HttpError(
          'gone',
          used
            ? used.usedAt
              ? 'This link was already used'
              : 'This link has expired'
            : 'This link does not exist',
        )
      }
      const user = await users.get(r.userId)
      if (user.disabled) throw new HttpError('forbidden', 'This account is disabled')
      const hours = Math.max(1, Math.ceil((r.expiresAt.getTime() - Date.now()) / 3600_000))
      const token = await users.createSession(user.id, {
        days: Math.max(1, Math.ceil(hours / 24)),
        userAgent: c.req.header('user-agent'),
        share: { linkId: r.id, targetType: r.targetType, targetId: r.targetId },
      })
      setSessionCookie(c, token, Math.max(1, Math.ceil(hours / 24)), ctx.config.publicUrl)
      await ctx.services.notifications?.notify([r.createdBy], {
        kind: 'share.used',
        title: `${user.displayName} opened your link`,
        link: pathFor(r.targetType, r.targetId),
        actorId: user.id,
      })
      return c.json({ redirect: pathFor(r.targetType, r.targetId) })
    })
  },
})
