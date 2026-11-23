import { DecideInput, ReviewRequest, SendForReviewInput } from '@greenlit/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Actor, actorUserId, isAdmin } from '../../core/actor.ts'
import { badRequest, forbidden, notFound } from '../../core/errors.ts'
import { IdParams, route } from '../../core/http.ts'
import { defineModule, type ModuleContext } from '../../core/module.ts'
import { media } from '../media/schema.ts'
import { reviewAssignments, reviewRequests } from './schema.ts'

declare module '../../core/events.ts' {
  interface Events {
    'review.requested': { id: string; mediaId: string }
    'review.closed': { id: string; mediaId: string; status: string }
  }
}

export default defineModule({
  id: 'reviews',
  name: 'Reviews & approval',
  description:
    'Send media to reviewers, collect approvals or change requests, and keep media status in step.',
  dependsOn: ['users', 'media'],
  after: ['notifications'],
  permissions: {
    'reviews.send': { description: 'Send media to people for review', roles: [] },
    'reviews.decide': { description: 'Approve or request changes on media sent to you', roles: ['reviewer'] },
    'reviews.read': { description: 'See review requests', roles: ['reviewer'] },
  },
  setup(ctx) {
    const svc = build(ctx)
    const tags = ['Reviews']

    route(ctx.api, {
      method: 'post',
      path: '/reviews',
      summary: 'Send media for review to one or more people',
      tags,
      access: 'reviews.send',
      body: SendForReviewInput,
      response: z.array(ReviewRequest),
      status: 201,
      handler: ({ actor, body }) => svc.send(body, actor),
    })
    route(ctx.api, {
      method: 'get',
      path: '/reviews',
      summary: 'Review requests for a media item, or every open one',
      tags,
      access: 'reviews.read',
      query: z.object({
        mediaId: z.uuid().optional(),
        status: z.enum(['open', 'closed', 'all']).default('open'),
      }),
      response: z.array(ReviewRequest),
      handler: ({ actor, query }) => svc.list(actor, query),
    })
    route(ctx.api, {
      method: 'get',
      path: '/reviews/inbox',
      summary: 'What is waiting for my decision',
      tags,
      access: 'reviews.decide',
      response: z.array(ReviewRequest),
      handler: ({ actor }) => svc.inbox(actor),
    })
    route(ctx.api, {
      method: 'post',
      path: '/reviews/{id}/decide',
      summary: 'Approve, or ask for changes',
      tags,
      access: 'reviews.decide',
      params: IdParams,
      body: DecideInput,
      response: ReviewRequest,
      handler: ({ actor, params, body }) => svc.decide(params.id, body, actor),
    })
    route(ctx.api, {
      method: 'post',
      path: '/reviews/{id}/cancel',
      summary: 'Withdraw a review request',
      tags,
      access: 'reviews.send',
      params: IdParams,
      response: ReviewRequest,
      handler: ({ actor, params }) => svc.cancel(params.id, actor),
    })

    ctx.mcp.tool({
      name: 'reviews_send',
      description:
        'Send media items for review to people (use users_list for ids). Sets them In review and notifies the reviewers.',
      input: {
        mediaIds: z.array(z.uuid()).min(1),
        reviewerIds: z.array(z.uuid()).min(1),
        message: z.string().optional(),
      },
      access: 'reviews.send',
      handler: async ({ mediaIds, reviewerIds, message }, { actor }) =>
        (await svc.send({ mediaIds, reviewerIds, message: message ?? '', dueAt: null }, actor)).map((r) => ({
          id: r.id,
          mediaId: r.mediaId,
          status: r.status,
        })),
    })
    ctx.mcp.tool({
      name: 'reviews_list',
      description:
        'Open (or all) review requests, optionally for one media item, with every reviewer decision.',
      input: { mediaId: z.uuid().optional(), status: z.enum(['open', 'closed', 'all']).optional() },
      access: 'reviews.read',
      readOnly: true,
      handler: ({ mediaId, status }, { actor }) => svc.list(actor, { mediaId, status: status ?? 'open' }),
    })
  },
})

function build(ctx: ModuleContext) {
  const { db } = ctx

  const views = async (rows: (typeof reviewRequests.$inferSelect)[]): Promise<ReviewRequest[]> => {
    if (!rows.length) return []
    const assigns = await db
      .select()
      .from(reviewAssignments)
      .where(
        inArray(
          reviewAssignments.requestId,
          rows.map((r) => r.id),
        ),
      )
    const refs = await ctx.services.users.refs([
      ...rows.map((r) => r.requestedBy),
      ...assigns.map((a) => a.userId),
    ])
    const unknown = {
      id: '00000000-0000-0000-0000-000000000000',
      displayName: 'Former user',
      avatarUrl: null,
    }
    return rows.map((r) => {
      const mine = assigns.filter((a) => a.requestId === r.id)
      return {
        id: r.id,
        mediaId: r.mediaId,
        requestedBy: refs.get(r.requestedBy) ?? unknown,
        reviewers: mine.map((a) => refs.get(a.userId) ?? unknown),
        message: r.message,
        dueAt: r.dueAt?.toISOString() ?? null,
        status: r.status as ReviewRequest['status'],
        decisions: mine
          .filter((a) => a.decision)
          .map((a) => ({
            reviewer: refs.get(a.userId) ?? unknown,
            decision: a.decision as 'approved' | 'changes_requested',
            note: a.note,
            at: a.decidedAt!.toISOString(),
          })),
        createdAt: r.createdAt.toISOString(),
      }
    })
  }

  const get = async (id: string) => {
    const [r] = await db.select().from(reviewRequests).where(eq(reviewRequests.id, id))
    if (!r) throw notFound('Review request not found')
    return r
  }

  const close = async (id: string, status: string, actor: Actor) => {
    const r = await get(id)
    await db.update(reviewRequests).set({ status, closedAt: new Date() }).where(eq(reviewRequests.id, id))
    if (status !== 'cancelled')
      await ctx.services.media.setStatus(r.mediaId, status as 'approved' | 'changes_requested', actor)
    ctx.events.emit('review.closed', { id, mediaId: r.mediaId, status })
    ctx.realtime.publish(`media:${r.mediaId}`, 'review.updated', { id })
    ctx.realtime.publish('reviews', 'review.updated', { id })
  }

  return {
    async send(input: z.infer<typeof SendForReviewInput>, actor: Actor) {
      const requestedBy = actorUserId(actor)
      if (!requestedBy) throw badRequest('Reviews are sent by a person')
      const created: string[] = []
      for (const mediaId of input.mediaIds) {
        const m = await ctx.services.media.get(mediaId, actor)
        // An open request for the same media is replaced by the new one.
        await db
          .update(reviewRequests)
          .set({ status: 'cancelled', closedAt: new Date() })
          .where(and(eq(reviewRequests.mediaId, mediaId), eq(reviewRequests.status, 'open')))
        const [r] = await db
          .insert(reviewRequests)
          .values({
            mediaId,
            requestedBy,
            message: input.message,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
          })
          .returning()
        await db
          .insert(reviewAssignments)
          .values(input.reviewerIds.map((userId) => ({ requestId: r!.id, userId })))
        // Make sure the reviewers can see it.
        if ((m.hiddenFrom ?? []).some((u) => input.reviewerIds.includes(u))) {
          await ctx.services.media.update(
            mediaId,
            { hiddenFrom: (m.hiddenFrom ?? []).filter((u) => !input.reviewerIds.includes(u)) },
            actor,
          )
        }
        await ctx.services.media.setStatus(mediaId, 'in_review', actor)
        created.push(r!.id)
        ctx.events.emit('review.requested', { id: r!.id, mediaId })
        ctx.realtime.publish(`media:${mediaId}`, 'review.updated', { id: r!.id })
        await ctx.services.notifications?.notify(input.reviewerIds, {
          kind: 'review.requested',
          title: `${actor.kind === 'user' ? actor.user.displayName : 'Greenlit'} asks you to review ${m.title || 'a media item'}`,
          body: input.message,
          link: `/media/${mediaId}`,
          actorId: requestedBy,
          entityType: 'media',
          entityId: mediaId,
        })
      }
      ctx.realtime.publish('reviews', 'review.updated', {})
      const rows = await db.select().from(reviewRequests).where(inArray(reviewRequests.id, created))
      return views(rows)
    },

    async list(actor: Actor, q: { mediaId?: string; status: 'open' | 'closed' | 'all' }) {
      const where = [
        q.mediaId ? eq(reviewRequests.mediaId, q.mediaId) : undefined,
        q.status === 'open'
          ? eq(reviewRequests.status, 'open')
          : q.status === 'closed'
            ? sql`${reviewRequests.status} <> 'open'`
            : undefined,
      ]
      let rows = await db
        .select()
        .from(reviewRequests)
        .where(and(...where))
        .orderBy(desc(reviewRequests.createdAt))
        .limit(200)
      if (!isAdmin(actor)) {
        const visible = new Set(
          (await ctx.services.media.many([...new Set(rows.map((r) => r.mediaId))], actor)).map((m) => m.id),
        )
        rows = rows.filter((r) => visible.has(r.mediaId))
      }
      return views(rows)
    },

    async inbox(actor: Actor) {
      const uid = actorUserId(actor)!
      const rows = await db
        .select({ r: reviewRequests })
        .from(reviewRequests)
        .innerJoin(reviewAssignments, eq(reviewAssignments.requestId, reviewRequests.id))
        .innerJoin(media, eq(media.id, reviewRequests.mediaId))
        .where(
          and(
            eq(reviewRequests.status, 'open'),
            eq(reviewAssignments.userId, uid),
            isNull(reviewAssignments.decision),
            isNull(media.deletedAt),
          ),
        )
        .orderBy(desc(reviewRequests.createdAt))
      return views(rows.map((x) => x.r))
    },

    async decide(id: string, input: z.infer<typeof DecideInput>, actor: Actor) {
      const r = await get(id)
      const uid = actorUserId(actor)!
      if (r.status !== 'open') throw badRequest('This review is closed')
      const [assignment] = await db
        .select()
        .from(reviewAssignments)
        .where(and(eq(reviewAssignments.requestId, id), eq(reviewAssignments.userId, uid)))
      if (!assignment) {
        // Admins can decide for everyone (useful when the boss doesn't mind).
        if (!isAdmin(actor)) throw forbidden('This review was not sent to you')
        await db
          .insert(reviewAssignments)
          .values({
            requestId: id,
            userId: uid,
            decision: input.decision,
            note: input.note,
            decidedAt: new Date(),
          })
      } else {
        await db
          .update(reviewAssignments)
          .set({ decision: input.decision, note: input.note, decidedAt: new Date() })
          .where(and(eq(reviewAssignments.requestId, id), eq(reviewAssignments.userId, uid)))
      }
      const all = await db.select().from(reviewAssignments).where(eq(reviewAssignments.requestId, id))
      if (input.decision === 'changes_requested') await close(id, 'changes_requested', actor)
      else if (isAdmin(actor) || all.every((a) => a.decision === 'approved'))
        await close(id, 'approved', actor)
      ctx.realtime.publish(`media:${r.mediaId}`, 'review.updated', { id })
      const m = await ctx.services.media.get(r.mediaId, { kind: 'system', source: 'system' })
      await ctx.services.notifications?.notify(
        [r.requestedBy].filter((x) => x !== uid),
        {
          kind: 'review.decided',
          title: `${actor.kind === 'user' ? actor.user.displayName : 'Someone'} ${input.decision === 'approved' ? 'approved' : 'asked for changes on'} ${m.title || 'a media item'}`,
          body: input.note,
          link: `/media/${r.mediaId}`,
          actorId: uid,
          entityType: 'media',
          entityId: r.mediaId,
        },
      )
      const [v] = await views([await get(id)])
      return v!
    },

    async cancel(id: string, actor: Actor) {
      await close(id, 'cancelled', actor)
      const [v] = await views([await get(id)])
      return v!
    },
  }
}
