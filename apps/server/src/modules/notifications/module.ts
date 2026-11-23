import { Notification } from '@greenlit/shared'
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { actorUserId } from '../../core/actor.ts'
import { route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { notifications } from './schema.ts'

export interface NotifyInput {
  kind: string
  title: string
  body?: string
  link?: string | null
  actorId?: string | null
  entityType?: string | null
  entityId?: string | null
}

export interface NotificationsService {
  notify: (userIds: string[], n: NotifyInput) => Promise<void>
}

declare module '../../core/services.ts' {
  interface Services {
    /** Optional: modules call `ctx.services.notifications?.notify(...)`. */
    notifications?: NotificationsService
  }
}

export default defineModule({
  id: 'notifications',
  name: 'Notifications',
  description: 'In-app notifications, pushed live to the people they are for.',
  dependsOn: ['users'],
  setup(ctx) {
    const notify: NotificationsService['notify'] = async (userIds, n) => {
      const ids = [...new Set(userIds)].filter(Boolean)
      if (!ids.length) return
      const rows = await ctx.db
        .insert(notifications)
        .values(
          ids.map((userId) => ({
            userId,
            kind: n.kind,
            title: n.title,
            body: n.body ?? '',
            link: n.link ?? null,
            actorId: n.actorId ?? null,
            entityType: n.entityType ?? null,
            entityId: n.entityId ?? null,
          })),
        )
        .returning()
      const actor = await ctx.services.users.ref(n.actorId)
      for (const r of rows) ctx.realtime.publish(`user:${r.userId}`, 'notification.created', view(r, actor))
    }
    ctx.services.provide('notifications', { notify })

    const view = (
      r: typeof notifications.$inferSelect,
      actor: Awaited<ReturnType<typeof ctx.services.users.ref>>,
    ) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      link: r.link,
      actor,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })

    route(ctx.api, {
      method: 'get',
      path: '/notifications',
      summary: 'My notifications, newest first',
      tags: ['Notifications'],
      access: 'signed-in',
      query: z.object({
        before: z.iso.datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().max(100).default(30),
      }),
      response: z.object({ items: z.array(Notification), unread: z.number() }),
      handler: async ({ actor, query }) => {
        const uid = actorUserId(actor)!
        const rows = await ctx.db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, uid),
              query.before ? lt(notifications.createdAt, new Date(query.before)) : undefined,
            ),
          )
          .orderBy(desc(notifications.createdAt))
          .limit(query.limit)
        const refs = await ctx.services.users.refs(rows.map((r) => r.actorId))
        const [{ n } = { n: 0 }] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.userId, uid), isNull(notifications.readAt)))
        return {
          items: rows.map((r) => view(r, r.actorId ? (refs.get(r.actorId) ?? null) : null)),
          unread: n,
        }
      },
    })

    route(ctx.api, {
      method: 'post',
      path: '/notifications/read',
      summary: 'Mark notifications as read (all when no ids are given)',
      tags: ['Notifications'],
      access: 'signed-in',
      body: z.object({ ids: z.array(z.uuid()).optional() }),
      response: z.object({ ok: z.literal(true) }),
      handler: async ({ actor, body }) => {
        const uid = actorUserId(actor)!
        await ctx.db
          .update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(notifications.userId, uid),
              isNull(notifications.readAt),
              body.ids?.length ? inArray(notifications.id, body.ids) : undefined,
            ),
          )
        ctx.realtime.publish(`user:${uid}`, 'notification.read', { ids: body.ids ?? null })
        return { ok: true as const }
      },
    })

    // Keep the table small: drop read notifications after 90 days.
    ctx.jobs.define('notifications.prune', {
      handler: async () => {
        await ctx.db.delete(notifications).where(sql`${notifications.readAt} < now() - interval '90 days'`)
      },
    })
    ctx.onStart(() => ctx.jobs.schedule('notifications.prune', '40 4 * * *'))
  },
})
