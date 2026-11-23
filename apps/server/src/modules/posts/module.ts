import { getPlacement, validateForPlacement } from '@greenlit/platforms'
import { CalendarEntry, CalendarQuery, Post, SavePostInput } from '@greenlit/shared'
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Actor, actorUserId, assertCan } from '../../core/actor.ts'
import { badRequest } from '../../core/errors.ts'
import { IdParams, Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { prepareTarget, registerPostJobs, scheduleQuestion, timeToWaitFor } from './publish.ts'
import { postMedia, posts, postTargets } from './schema.ts'
import { PostsService } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    posts: PostsService
  }
}

export default defineModule({
  id: 'posts',
  name: 'Posts & publishing',
  description:
    'Posts for Instagram, Facebook, TikTok and YouTube from library media: per-platform text, covers, music, schedules.',
  dependsOn: ['users', 'files', 'media', 'projects'],
  after: ['links', 'connectors', 'notifications'],
  permissions: {
    'posts.read': { description: 'See posts and the publishing calendar', roles: ['reviewer'] },
    'posts.edit': { description: 'Create and change posts', roles: [] },
    'posts.publish': { description: 'Publish and schedule posts on the connected accounts', roles: [] },
    'calendar.read': { description: 'See the publishing calendar', roles: ['reviewer'] },
  },
  setup(ctx) {
    const svc = new PostsService(ctx)
    ctx.services.provide('posts', svc)
    registerPostJobs(ctx, svc)
    const tags = ['Posts']

    ctx.versions.register('post', {
      labels: {
        name: 'name',
        caption: 'caption',
        title: 'title',
        hashtags: 'hashtags',
        translations: 'translations',
        media: 'media',
        targets: 'platforms',
      },
      coalesceSeconds: 60,
      snapshot: async (id) => {
        const [p] = await ctx.db.select().from(posts).where(eq(posts.id, id))
        if (!p) return null
        const input = await svc.inputOf(id)
        return {
          ...input,
          targets: input.targets.map(({ ...t }) => {
            const {
              state: _s,
              remoteId: _r,
              remoteUrl: _u,
              error: _e,
              publishedAt: _p,
              syncedAt: _y,
              stats: _st,
              ...rest
            } = t as Record<string, unknown>
            return rest
          }),
          deletedAt: p.deletedAt?.toISOString() ?? null,
        } as Record<string, unknown>
      },
      restore: async (id, d, actor) => {
        await svc.update(id, d as never, actor)
      },
    })
    ctx.entities.register('post', {
      canView: (id, actor) => svc.canView(id, actor),
      summarize: async (ids, actor) => {
        const out = []
        for (const id of ids) {
          if (!(await svc.canView(id, actor))) continue
          const p = await svc.get(id, actor).catch(() => null)
          if (p)
            out.push({
              type: 'post',
              id,
              title: p.name || p.title || p.caption.slice(0, 60) || 'Post',
              thumbnailUrl: p.media[0]?.thumbnailUrl ?? null,
              kind: 'post',
              href: `/posts/${id}`,
              projectId: p.projectId,
            })
        }
        return out
      },
    })
    ctx.realtime.guard('post', (actor, topic) => svc.canView(topic.split(':')[1]!, actor))

    // Media used by a post scheduled in the future must stay hot (not archived).
    ctx.hooks.add(
      'storage.inUse' as never,
      (async ({ blobIds }: { blobIds: string[] }) => {
        if (!blobIds.length) return []
        const rows = await ctx.db.execute<{ blob_id: string }>(sql`
        select distinct f.blob_id from media_formats f
        join ${postMedia} pm on pm.media_id = f.media_id
        join ${postTargets} t on t.post_id = pm.post_id
        where t.state in ('draft','queued','preparing','uploading','scheduled') and (t.schedule_at is null or t.schedule_at > now())
          and f.blob_id in (${sql.join(
            blobIds.map((b) => sql`${b}::uuid`),
            sql`, `,
          )})`)
        return rows.map((r) => r.blob_id)
      }) as never,
    )
    // Share links that point at a post may show its media.
    ctx.hooks.add('share.allowsMedia', async ({ actor, mediaId }) => {
      if (actor.kind !== 'user' || actor.share?.targetType !== 'post' || !actor.share.targetId)
        return undefined
      const [r] = await ctx.db
        .select()
        .from(postMedia)
        .where(and(eq(postMedia.postId, actor.share.targetId), eq(postMedia.mediaId, mediaId)))
      return r ? true : undefined
    })

    const startPublish = async (
      id: string,
      actor: Actor,
      opts: { targetIds?: string[]; dryRun?: boolean } = {},
    ) => {
      const post = await svc.get(id, actor)
      if (!post.media.length) throw badRequest('Add media to the post first')
      const ready = post.targets.filter(
        (t) =>
          t.enabled &&
          ['draft', 'failed'].includes(t.state) &&
          (!opts.targetIds || opts.targetIds.includes(t.id)),
      )
      if (!ready.length) throw badRequest('Nothing to publish: choose at least one account')
      const problems: string[] = []
      for (const t of ready) {
        const spec = getPlacement(t.platform, t.placement)
        if (!spec) problems.push(`${t.platform} ${t.placement} is not supported`)
        else {
          const issues = validateForPlacement(spec, null, {
            caption: PostsService.composeCaption(post, t),
            title: t.title ?? post.title,
          })
          for (const i of issues) if (i.level === 'error') problems.push(`${t.platform}: ${i.message}`)
        }
      }
      if (problems.length) throw badRequest(problems.join(' · '), { problems })
      const tasks: string[] = []
      const connectors = ctx.services.connectors
      for (const t of ready) {
        // A time the platform does not keep itself waits in Greenlit: the version is queued, and posts.due sends
        // it at its time (a dry run rehearses now).
        const at = timeToWaitFor(t.scheduleAt)
        if (
          !opts.dryRun &&
          connectors &&
          at &&
          !(await connectors.holdsSchedule(scheduleQuestion(t, post.translations), at))
        ) {
          await svc.setTargetState(t.id, { state: 'queued', error: null })
          continue
        }
        await svc.setTargetState(t.id, { state: 'queued', error: null })
        const { taskId } = await ctx.jobs.send(
          'posts.publish',
          { targetId: t.id, userId: actorUserId(actor), dryRun: opts.dryRun },
          {
            singletonKey: `publish:${t.id}`,
            task: {
              kind: 'posts.publish',
              title: `${opts.dryRun ? 'Rehearsing' : 'Publishing'} on ${t.platform}`,
              entityType: 'post',
              entityId: id,
              createdBy: actorUserId(actor),
            },
          },
        )
        if (taskId) tasks.push(taskId)
      }
      return { tasks }
    }

    // ── API ─────────────────────────────────────────────────────────────
    route(ctx.api, {
      method: 'get',
      path: '/posts',
      summary: 'Posts (optionally of a project or using a media item)',
      tags,
      access: 'posts.read',
      query: z.object({
        projectId: z.uuid().optional(),
        mediaId: z.uuid().optional(),
        status: z.string().optional(),
      }),
      response: z.array(Post),
      handler: ({ actor, query }) => svc.list(actor, query),
    })
    route(ctx.api, {
      method: 'post',
      path: '/posts',
      summary: 'Create a post',
      tags,
      access: 'posts.edit',
      body: SavePostInput,
      response: Post,
      status: 201,
      handler: ({ actor, body }) => svc.create(body, actor),
    })
    route(ctx.api, {
      method: 'get',
      path: '/posts/{id}',
      summary: 'One post with every platform version',
      tags,
      access: 'posts.read',
      params: IdParams,
      response: Post,
      handler: ({ actor, params }) => svc.get(params.id, actor),
    })
    route(ctx.api, {
      method: 'patch',
      path: '/posts/{id}',
      summary: 'Change a post (versions already on a platform are updated there too)',
      tags,
      access: 'posts.edit',
      params: IdParams,
      body: SavePostInput,
      response: Post,
      handler: ({ actor, params, body }) => svc.update(params.id, body, actor),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/posts/{id}',
      summary: 'Delete a post that is not on any platform',
      tags,
      access: 'posts.edit',
      params: IdParams,
      response: Ok,
      handler: async ({ actor, params }) => {
        await svc.remove(params.id, actor)
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/posts/{id}/publish',
      summary: 'Publish now or schedule on the platforms (each target uses its own schedule time)',
      tags,
      access: 'posts.publish',
      params: IdParams,
      body: z.object({ targetIds: z.array(z.uuid()).optional(), dryRun: z.boolean().optional() }),
      response: z.object({ tasks: z.array(z.string()) }),
      status: 202,
      handler: ({ actor, params, body }) => startPublish(params.id, actor, body),
    })
    route(ctx.api, {
      method: 'post',
      path: '/posts/{id}/targets/{targetId}/remove',
      summary: 'Take a version off its platform (delete it there)',
      tags,
      access: 'posts.publish',
      params: IdParams.extend({ targetId: z.uuid() }),
      response: Ok,
      handler: async ({ params }) => {
        await ctx.jobs.send('posts.remove', { targetId: params.targetId })
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/posts/{id}/targets/{targetId}/reschedule',
      summary: 'Move a target to another time (moved on the platform too when already scheduled there)',
      tags,
      access: 'posts.publish',
      params: IdParams.extend({ targetId: z.uuid() }),
      body: z.object({ scheduleAt: z.iso.datetime({ offset: true }) }),
      response: Ok,
      handler: async ({ actor, params, body }) => {
        const t = await svc.targetRow(params.targetId)
        if (t.state === 'published') throw badRequest('Already published')
        await svc.setTargetState(t.id, { scheduleAt: new Date(body.scheduleAt) })
        await ctx.versions.record('post', params.id, actor)
        if (t.remoteId && t.state === 'scheduled') await ctx.jobs.send('posts.update', { targetId: t.id })
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/posts/{id}/targets/{targetId}/package',
      summary:
        'Make the platform-optimised file(s) and return them with the final caption (for posting by hand)',
      tags,
      access: 'posts.edit',
      params: IdParams.extend({ targetId: z.uuid() }),
      response: z.object({
        files: z.array(z.object({ url: z.string(), mime: z.string() })),
        caption: z.string(),
        title: z.string(),
        thumbnailUrl: z.string().nullable(),
      }),
      handler: async ({ params }) => {
        const t = await svc.targetRow(params.targetId)
        const p = await svc.row(t.postId)
        const { files } = await prepareTarget(ctx, t)
        return {
          files: files.map((f) => ({
            url: ctx.services.files.sign(`/api/files/${f.blobId}`, 24 * 3600),
            mime: f.mime,
          })),
          caption: PostsService.composeCaption(p, t),
          title: t.title ?? p.title,
          thumbnailUrl: null,
        }
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/posts/{id}/check',
      summary: 'What each platform will say about this post (limits, aspect ratio, caption length…)',
      tags,
      access: 'posts.read',
      params: IdParams,
      response: z.array(
        z.object({
          targetId: z.string(),
          issues: z.array(z.object({ level: z.string(), code: z.string(), message: z.string() })),
        }),
      ),
      handler: async ({ actor, params }) => {
        const post = await svc.get(params.id, actor)
        const accounts = (await ctx.services.connectors?.accounts()) ?? []
        return post.targets.map((t) => {
          const spec = getPlacement(t.platform, t.placement)
          const account = accounts.find((a) => a.id === t.accountId)
          if (account?.state === 'disabled')
            return {
              targetId: t.id,
              issues: [
                {
                  level: 'error',
                  code: 'account_off',
                  message: 'This account is turned off in Connected accounts',
                },
              ],
            }
          if (account?.capabilities.publish === false)
            return {
              targetId: t.id,
              issues: [
                {
                  level: 'error',
                  code: 'account_read_only',
                  message: 'Greenlit cannot publish to this account yet',
                },
              ],
            }
          const m = post.media[0]
          const f = m?.formats.find((x) => x.key === t.formats[m.mediaId]) ?? m?.formats[0]
          const src =
            f?.width && f.height
              ? {
                  kind: (m!.kind === 'image' ? 'image' : 'video') as 'video' | 'image',
                  width: f.width,
                  height: f.height,
                  durationSec: f.duration,
                }
              : null
          return {
            targetId: t.id,
            issues: spec
              ? validateForPlacement(spec, src, {
                  caption: PostsService.composeCaption(post, t),
                  title: t.title ?? post.title,
                  hashtags: t.hashtags ?? post.hashtags,
                  items: post.media.length,
                })
              : [],
          }
        })
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/calendar',
      summary: 'Scheduled and published posts between two dates',
      tags: ['Calendar'],
      access: 'calendar.read',
      query: CalendarQuery,
      response: z.array(CalendarEntry),
      handler: ({ actor, query }) => svc.calendar(actor, new Date(query.from), new Date(query.to), query),
    })

    // ── MCP ─────────────────────────────────────────────────────────────
    ctx.mcp.tool({
      name: 'posts_list',
      description:
        'Posts with their status per platform (draft, scheduled, published…). Filter by projectId or mediaId.',
      input: { projectId: z.uuid().optional(), mediaId: z.uuid().optional() },
      access: 'posts.read',
      readOnly: true,
      handler: async (i, { actor }) =>
        (await svc.list(actor, i)).map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          caption: p.caption.slice(0, 200),
          media: p.media.map((m) => m.mediaId),
          targets: p.targets.map((t) => ({
            id: t.id,
            platform: t.platform,
            placement: t.placement,
            state: t.state,
            scheduleAt: t.scheduleAt,
            url: t.remoteUrl,
          })),
        })),
    })
    ctx.mcp.tool({
      name: 'posts_get',
      description:
        'Everything about a post: text per platform, translations, music, cover, schedule, state on each platform.',
      input: { id: z.uuid() },
      access: 'posts.read',
      readOnly: true,
      handler: ({ id }, { actor }) => svc.get(id, actor),
    })
    ctx.mcp.tool({
      name: 'posts_save',
      description:
        'Create (no id) or change a post. targets: one per account+placement (accounts_list for ids; placements feed|reel|story|video|short|photo|post). Per target you can override title/caption/hashtags, set tags (YouTube), thumbnail {mode:frame,time}|{mode:media,mediaId}, translations {it:{title,caption}}, music (from music_search), audio {original,music}, options, scheduleAt (ISO with offset; platform time zone applies). It does not publish — use posts_publish.',
      input: { id: z.uuid().optional(), post: SavePostInput },
      access: 'posts.edit',
      handler: async ({ id, post }, { actor }) =>
        id ? svc.update(id, post, actor) : svc.create(post, actor),
    })
    ctx.mcp.tool({
      name: 'posts_check',
      description:
        'Check a post against each platform’s rules (caption length, hashtags, aspect ratio, duration) before publishing.',
      input: { id: z.uuid() },
      access: 'posts.read',
      readOnly: true,
      handler: async ({ id }, { actor }) => {
        const post = await svc.get(id, actor)
        return post.targets.map((t) => {
          const spec = getPlacement(t.platform, t.placement)
          return {
            target: `${t.platform} ${t.placement}`,
            issues: spec
              ? validateForPlacement(spec, null, {
                  caption: PostsService.composeCaption(post, t),
                  title: t.title ?? post.title,
                })
              : [{ level: 'error', message: 'unsupported' }],
          }
        })
      },
    })
    ctx.mcp.tool({
      name: 'posts_publish',
      description:
        'Publish or schedule a post on its platforms (a scheduled target is scheduled on the platform when the platform keeps that kind of post that far ahead; otherwise Greenlit holds it and publishes it at its time, so Greenlit must be running then). This posts publicly — only do it when the user asked for it. dryRun=true rehearses everything without the final click.',
      input: { id: z.uuid(), targetIds: z.array(z.uuid()).optional(), dryRun: z.boolean().optional() },
      access: 'posts.publish',
      destructive: true,
      handler: ({ id, targetIds, dryRun }, { actor }) => startPublish(id, actor, { targetIds, dryRun }),
    })
    ctx.mcp.tool({
      name: 'calendar',
      description: 'Scheduled and published posts between two ISO dates, in time order.',
      input: { from: z.string(), to: z.string() },
      access: 'calendar.read',
      readOnly: true,
      handler: ({ from, to }, { actor }) => svc.calendar(actor, new Date(from), new Date(to)),
    })

    // Media panel: which posts use this media item (counts on media cards could use it later).
    ctx.hooks.add('media.decorate', async () => ({}))

    // Targets that should have been published by Greenlit (no native schedule) and are due.
    ctx.jobs.define('posts.due', {
      handler: async () => {
        const due = await ctx.db
          .select({ id: postTargets.id, postId: postTargets.postId })
          .from(postTargets)
          .innerJoin(posts, eq(posts.id, postTargets.postId))
          .where(
            and(
              isNull(posts.deletedAt),
              eq(postTargets.state, 'queued'),
              gt(sql`now()`, postTargets.scheduleAt),
            ),
          )
        for (const d of due)
          await ctx.jobs.send(
            'posts.publish',
            { targetId: d.id, userId: null },
            { singletonKey: `publish:${d.id}` },
          )
        return { due: due.length }
      },
    })
    ctx.onStart(() => ctx.jobs.schedule('posts.due', '* * * * *'))
    void assertCan
    void inArray
  },
})
