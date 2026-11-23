import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Account,
  Connectable,
  MusicTrack,
  RemoteSession,
  SoundWaveform,
} from '@greenlit/shared/areas/connectors'
import { AudioMix, MusicChoice, Placement, Platform } from '@greenlit/shared/areas/posts'
import { z } from 'zod'
import { can } from '../../core/actor.ts'
import { badRequest, HttpError, notFound } from '../../core/errors.ts'
import { IdParams, Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { drivers } from './drivers/index.ts'
import { type ConnectorsService, ConnectorUnsupported, type PublishFile } from './drivers/types.ts'
import type { InputMessage } from './remote.ts'
import { Connectors, platformName } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    /** Social accounts signed in through their own browser profile (optional: posts work without it as drafts). */
    connectors?: ConnectorsService
  }
}

/** Driver failures reach the web as readable errors (never a bare 500). */
async function web<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (err) {
    if (err instanceof HttpError) throw err
    if (err instanceof ConnectorUnsupported) throw badRequest(err.message)
    throw new HttpError('unavailable', (err as Error).message.slice(0, 500))
  }
}

const SessionView = RemoteSession.extend({ title: z.string().optional() })
const PlatformInfo = z.object({
  platform: Platform,
  name: z.string(),
  driver: z.string(),
  /** The tool Greenlit drives (Meta Business Suite serves Facebook and Instagram with one sign-in). */
  driverName: z.string(),
  signIn: z.object({
    method: z.enum(['password', 'qr']),
    host: z.string(),
    cookieDomains: z.array(z.string()),
  }),
  capabilities: Account.shape.capabilities,
})
const RemotePostView = z.object({
  remoteId: z.string(),
  url: z.string().nullable(),
  placement: Placement,
  title: z.string(),
  caption: z.string(),
  thumbnailUrl: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  state: z.enum(['scheduled', 'published', 'removed']),
  scheduledAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  stats: z.record(z.string(), z.number()).nullable(),
})
const DryRunView = z.object({
  remoteId: z.string(),
  url: z.string().nullable(),
  state: z.enum(['scheduled', 'published']),
  dryRun: z
    .object({
      steps: z.array(z.string()),
      warnings: z.array(z.string()),
      screenshot: z.string().nullable(),
      wouldPress: z.string().nullable(),
      requests: z
        .array(
          z.object({
            op: z.string(),
            method: z.string(),
            url: z.string(),
            headers: z.record(z.string(), z.string()),
            body: z.string().nullable(),
            files: z.array(
              z.object({ path: z.string(), bytes: z.number(), filename: z.string().nullable() }),
            ),
          }),
        )
        .optional(),
    })
    .optional(),
})

export default defineModule({
  id: 'connectors',
  name: 'Connected accounts',
  description:
    'Instagram, Facebook, TikTok and YouTube accounts, signed in once in a browser profile of their own (no developer apps or keys).',
  dependsOn: ['users', 'platform'],
  after: ['notifications', 'files', 'media'],
  permissions: {
    'connectors.read': {
      description: 'See which social accounts are connected (names and pictures) and browse their music',
      roles: ['reviewer'],
    },
    'connectors.manage': { description: 'Connect, reconnect and disconnect social accounts', roles: [] },
  },
  setup(ctx) {
    const svc = new Connectors(ctx)
    ctx.services.provide('connectors', svc)
    ctx.onStop(() => svc.shutdown())
    const tags = ['Connected accounts']

    // ── realtime: the remote sign-in stream and account changes ─────────
    ctx.realtime.guard('connectors', (actor) => can(actor, 'connectors.read'))
    ctx.realtime.guard(
      'connector-session',
      (actor, topic) => can(actor, 'connectors.manage') && !!svc.streams.get(topic.split(':')[1]!),
    )
    ctx.realtime.onMessage('connector-session', async (client, msg) => {
      if (msg.event !== 'input' || !can(client.actor, 'connectors.manage')) return
      const id = msg.topic.split(':')[1]!
      const data = msg.data as InputMessage
      if (!data || typeof data !== 'object' || typeof (data as { type?: unknown }).type !== 'string') return
      if (data.type === 'hello') {
        const last = svc.lastFrame(id)
        if (last) {
          ctx.realtime.sendTo(client, msg.topic, 'state', last.state)
          if (last.frame) ctx.realtime.sendTo(client, msg.topic, 'frame', last.frame)
        }
      }
      await svc.input(id, data)
    })

    // ── background: health every 6 hours, sync every 15 minutes ─────────
    ctx.jobs.define('connectors.health', {
      concurrency: 1,
      retryLimit: 0,
      expireInSeconds: 3600,
      handler: async () => {
        await svc.scanDevice().catch(() => null)
        return svc.checkAll().then((a) => ({ checked: a.length }))
      },
    })
    ctx.jobs.define('connectors.sync', {
      concurrency: 1,
      retryLimit: 0,
      expireInSeconds: 3600,
      handler: () => svc.syncAll(),
    })
    ctx.jobs.define('connectors.prune', { retryLimit: 0, handler: () => svc.pruneRuns() })
    ctx.onStart(() => {
      // Nothing runs yet: files staged by runs a restart cut short can go.
      void svc.pruneRuns(0).catch(() => {})
      // Accounts saved by an older version get what their connectors do now, and are merged if they were not.
      void svc
        .refreshCapabilities()
        .catch((err) => ctx.log.warn({ err }, 'account capabilities not refreshed'))
        .then(() => svc.mergeDuplicates())
        .catch((err) => ctx.log.warn({ err }, 'accounts not merged'))
      ctx.jobs.schedule('connectors.health', '20 */6 * * *')
      ctx.jobs.schedule('connectors.sync', '*/15 * * * *')
      ctx.jobs.schedule('connectors.prune', '50 4 * * *')
      // What is signed in on Greenlit's Android device joins the accounts it belongs to.
      setTimeout(
        () => void svc.scanDevice().catch((err) => ctx.log.info({ err }, 'device not scanned')),
        15_000,
      )
    })

    // ── API ─────────────────────────────────────────────────────────────
    route(ctx.api, {
      method: 'get',
      path: '/connectors/accounts',
      summary: 'Connected social accounts',
      tags,
      access: 'connectors.read',
      response: z.array(Account),
      handler: () => svc.accounts(),
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/device/scan',
      summary: 'Find who is signed in to the platforms’ apps on Greenlit’s Android device',
      description:
        'Each app’s account joins the connected account it is (merged into it) and helps it with what only the app does (YouTube Shorts sounds). An app account that matches no connected account is left out: a sign-in on the device never connects one by itself. An app signed out there leaves its accounts needing a sign-in.',
      tags,
      access: 'connectors.manage',
      response: z.object({
        joined: z.array(Account),
        signedOut: z.array(z.string()),
        /** Accounts the apps are signed in to that match no connected account (so they joined none). */
        unmatched: z.array(
          z.object({
            app: z.string(),
            platform: Platform,
            name: z.string(),
            handle: z.string(),
            /** The platform's id of it (a channel, user or profile id). */
            id: z.string(),
          }),
        ),
      }),
      handler: () => web(svc.scanDevice()),
    })
    route(ctx.api, {
      method: 'get',
      path: '/connectors/platforms',
      summary: 'Platforms that can be connected, how you sign in to each and what they can do',
      tags,
      access: 'connectors.read',
      response: z.array(PlatformInfo),
      handler: () =>
        // Device apps are found on Greenlit's Android device, not signed in to from here.
        drivers
          .filter((d) => !d.device)
          .flatMap((d) =>
            d.platforms.map((platform) => ({
              platform,
              name: platformName(platform),
              driver: d.id,
              driverName: d.name,
              signIn: {
                method: d.signIn.method as 'password' | 'qr',
                host: new URL(d.signIn.url).host,
                cookieDomains: d.signIn.cookieDomains,
              },
              capabilities: d.capabilities(platform),
            })),
          ),
    })
    route(ctx.api, {
      method: 'get',
      path: '/connectors/accounts/{id}',
      summary: 'One connected account',
      tags,
      access: 'connectors.read',
      params: IdParams,
      response: Account,
      handler: ({ params }) => svc.account(params.id),
    })
    ctx.api.get('/connectors/accounts/:id/avatar', async (c) => {
      const actor = c.get('actor')
      if (!can(actor, 'connectors.read')) throw new HttpError(actor ? 'forbidden' : 'unauthenticated')
      const id = c.req.param('id')
      if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound()
      try {
        return new Response(new Uint8Array(await readFile(svc.avatarPath(id))), {
          headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=86400' },
        })
      } catch {
        throw notFound()
      }
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/accounts/{id}/check',
      summary: 'Check now that the account is still signed in',
      tags,
      access: 'connectors.manage',
      params: IdParams,
      response: Account,
      handler: ({ params }) => svc.check(params.id),
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/accounts/{id}/enabled',
      summary: 'Turn an account off (kept connected, left out of publishing and the sync) or back on',
      tags,
      access: 'connectors.manage',
      params: IdParams,
      body: z.object({ enabled: z.boolean() }),
      response: Account,
      handler: ({ params, body }) => svc.setEnabled(params.id, body.enabled),
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/check',
      summary: 'Check every account now',
      tags,
      access: 'connectors.manage',
      response: z.array(Account),
      handler: () => svc.checkAll(),
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/accounts/{id}/sync',
      summary: 'Read the account’s posts from the platform now',
      tags,
      access: 'connectors.manage',
      params: IdParams,
      response: z.object({ posts: z.number() }),
      handler: ({ params }) => web(svc.sync(params.id)),
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/sync',
      summary: 'Read every connected account’s posts now',
      tags,
      access: 'connectors.manage',
      response: z.object({ posts: z.number() }),
      handler: () => svc.syncAll(),
    })
    route(ctx.api, {
      method: 'get',
      path: '/connectors/accounts/{id}/posts',
      summary: 'Posts on the platform right now (scheduled and published), read live',
      tags,
      access: 'connectors.read',
      params: IdParams,
      response: z.array(RemotePostView),
      handler: ({ params }) => web(svc.list(params.id)),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/connectors/accounts/{id}',
      summary: 'Disconnect an account (deletes its saved sign-in when no other account shares it)',
      tags,
      access: 'connectors.manage',
      params: IdParams,
      response: Ok,
      handler: async ({ params }) => {
        await svc.disconnect(params.id)
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'get',
      path: '/connectors/accounts/{id}/available',
      summary: 'Everything this account’s sign-in can publish to (Meta: each managed Page and its Instagram)',
      description:
        'Entries with an `accountId` are already connected. Reading it opens the platform, so it takes a few seconds; the answer is reused for five minutes unless `fresh` is set.',
      tags,
      access: 'connectors.manage',
      params: IdParams,
      query: z.object({ fresh: z.enum(['true', 'false']).optional() }),
      response: z.array(Connectable),
      handler: ({ params, query }) => web(svc.available(params.id, query.fresh === 'true')),
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/accounts/{id}/available',
      summary: 'Connect more of what this account’s sign-in reaches, without signing in again',
      tags,
      access: 'connectors.manage',
      params: IdParams,
      body: z.object({ keys: z.array(z.string().max(200)).min(1).max(500) }),
      response: z.array(Account),
      handler: ({ actor, params, body }) => web(svc.connectAvailable(params.id, body.keys, actor)),
    })
    route(ctx.api, {
      method: 'get',
      path: '/connectors/accounts/{id}/music',
      summary: 'Search the platform’s own music library (tracks stay linked on the platform)',
      tags,
      access: 'connectors.read',
      params: IdParams,
      query: z.object({ q: z.string().max(200).default(''), placement: Placement }),
      response: z.array(MusicTrack),
      handler: ({ params, query }) => web(svc.searchMusic(params.id, query.q, query.placement)),
    })

    // A sound to listen to in the composer, before and after choosing it: Greenlit reads the platform's audio once
    // (sounds.ts) and serves it from its cache, with its waveform.
    const SoundParams = z.object({ id: z.uuid(), trackId: z.string().min(1).max(200) })
    const SoundQuery = z.object({ u: z.string().max(4000).optional() })
    route(ctx.api, {
      method: 'get',
      path: '/connectors/accounts/{id}/sounds/{trackId}/waveform',
      summary: 'A sound’s preview: its length, where in the track it starts and its waveform peaks',
      description:
        '`u` is the track’s own preview address (`previewUrl`) when it has one. The audio is at `…/audio`. Only for listening: the platform attaches its own sound to the post.',
      tags,
      access: 'connectors.read',
      params: SoundParams,
      query: SoundQuery,
      response: SoundWaveform,
      handler: async ({ params, query }) => {
        const { file: _file, ...wave } = await web(svc.soundPreview(params.id, params.trackId, query.u))
        return wave
      },
    })
    ctx.api.get('/connectors/accounts/:id/sounds/:trackId/audio', async (c) => {
      const actor = c.get('actor')
      if (!can(actor, 'connectors.read')) throw new HttpError(actor ? 'forbidden' : 'unauthenticated')
      const p = SoundParams.safeParse(c.req.param())
      if (!p.success) throw badRequest('Bad sound')
      const preview = await web(svc.soundPreview(p.data.id, p.data.trackId, c.req.query('u')))
      return ctx.services.files.serveFile(c, preview.file, { mime: 'audio/mp4' })
    })

    route(ctx.api, {
      method: 'post',
      path: '/connectors/sessions',
      summary: 'Open a remote sign-in window on the platform (or reconnect an account)',
      description:
        'Subscribe to the realtime topic `connector-session:<id>` for frames and state; send `input` messages back.',
      tags,
      access: 'connectors.manage',
      body: z.object({
        platform: Platform,
        /** Which connector, when the platform has several (GET /connectors/platforms lists them). */
        driver: z.string().max(60).nullable().optional(),
        accountId: z.uuid().nullable().optional(),
        width: z.number().int().min(360).max(2560).optional(),
        height: z.number().int().min(320).max(1600).optional(),
        dpr: z.number().min(1).max(3).optional(),
        /** Development builds only: start on another https page instead of the sign-in page. */
        startUrl: z.url().optional(),
      }),
      response: SessionView,
      status: 201,
      handler: ({ actor, body }) => svc.startSession(body, actor),
    })
    route(ctx.api, {
      method: 'get',
      path: '/connectors/sessions/{id}',
      summary: 'A remote sign-in window',
      tags,
      access: 'connectors.manage',
      params: z.object({ id: z.uuid() }),
      response: SessionView,
      handler: ({ params }) => svc.session(params.id),
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/sessions/{id}/choose',
      summary: 'Connect the accounts picked after signing in (when the sign-in is in the `choosing` state)',
      description:
        'A login that reaches several accounts (Meta Business Suite: every Page it manages, its own and its business portfolios’, plus their linked Instagram accounts) waits in `choosing` with `choices`; send the keys to connect.',
      tags,
      access: 'connectors.manage',
      params: z.object({ id: z.uuid() }),
      body: z.object({ keys: z.array(z.string().max(200)).min(1).max(500) }),
      response: z.array(Account),
      handler: ({ params, body }) => svc.choose(params.id, body.keys),
    })
    route(ctx.api, {
      method: 'delete',
      path: '/connectors/sessions/{id}',
      summary: 'Close a remote sign-in window',
      tags,
      access: 'connectors.manage',
      params: z.object({ id: z.uuid() }),
      response: Ok,
      handler: async ({ params }) => {
        await svc.closeSession(params.id, 'Closed')
        return { ok: true as const }
      },
    })
    route(ctx.api, {
      method: 'post',
      path: '/connectors/cookies',
      summary:
        'Sign in by pasting exported cookies (cookies.txt or JSON) — the fallback when the remote sign-in is refused',
      tags,
      access: 'connectors.manage',
      body: z.object({
        platform: Platform,
        /** Which connector, when the platform has several (GET /connectors/platforms lists them). */
        driver: z.string().max(60).nullable().optional(),
        accountId: z.uuid().nullable().optional(),
        cookies: z.string().min(10).max(2_000_000),
      }),
      response: z.array(Account),
      handler: ({ actor, body }) => svc.importCookies(body, actor),
    })

    route(ctx.api, {
      method: 'post',
      path: '/connectors/accounts/{id}/dry-run',
      summary:
        'Go through the platform’s composer with library media and stop before the final Publish (nothing is posted)',
      description:
        'Returns every step, warnings and a picture of the composer right before the final click. YouTube Studio creates a private draft while uploading and deletes it again. API connectors (kind `api`) send no write at all: they return the requests they would send, with the sign-in’s values masked, and may rehearse an account whose publishing is not switched on yet.',
      tags,
      access: 'connectors.manage',
      params: IdParams,
      body: z.object({
        placement: Placement,
        media: z
          .array(z.object({ mediaId: z.uuid(), formatKey: z.string().optional() }))
          .min(1)
          .max(20),
        thumbnailMediaId: z.uuid().nullable().optional(),
        title: z.string().max(5000).default(''),
        caption: z.string().max(70_000).default(''),
        tags: z.array(z.string()).default([]),
        firstComment: z.string().max(5000).default(''),
        location: z
          .object({ name: z.string(), platformId: z.string().nullable().default(null) })
          .nullable()
          .default(null),
        translations: z
          .record(z.string(), z.object({ title: z.string().default(''), caption: z.string().default('') }))
          .default({}),
        music: MusicChoice.nullable().default(null),
        audio: AudioMix.default({ original: 1, music: 1 }),
        options: z.record(z.string(), z.unknown()).default({}),
        scheduleAt: z.iso.datetime({ offset: true }).nullable().default(null),
      }),
      response: DryRunView,
      handler: async ({ params, body }) => {
        const files: PublishFile[] = []
        for (const m of body.media) files.push(await fileOf(m.mediaId, m.formatKey))
        const thumb = body.thumbnailMediaId ? (await fileOf(body.thumbnailMediaId)).path : null
        return web(
          svc.publish({
            ...body,
            accountId: params.id,
            files,
            thumbnailPath: thumb,
            scheduleAt: body.scheduleAt ? new Date(body.scheduleAt) : null,
            timeZone: svc.timeZone(),
            dryRun: true,
          }),
        )
      },
    })
    // Pictures taken during dry runs and failed runs.
    ctx.api.get('/connectors/runs/:run/:file', async (c) => {
      const actor = c.get('actor')
      if (!can(actor, 'connectors.manage')) throw new HttpError(actor ? 'forbidden' : 'unauthenticated')
      const run = c.req.param('run')
      const file = c.req.param('file')
      if (!/^[\w-]+$/.test(run) || !/^[\w-]+\.(jpg|txt)$/.test(file)) throw notFound()
      try {
        const body = await readFile(join(svc.runsDir(), run, file))
        return new Response(new Uint8Array(body), {
          headers: {
            'content-type': file.endsWith('.jpg') ? 'image/jpeg' : 'text/plain; charset=utf-8',
            'cache-control': 'private, no-store',
          },
        })
      } catch {
        throw notFound()
      }
    })

    async function fileOf(mediaId: string, formatKey?: string): Promise<PublishFile> {
      if (!ctx.has('media')) throw badRequest('The media library is not available')
      const formats = await ctx.services.media.formatsOf(mediaId)
      const f = formats.find((x) => x.key === formatKey) ?? formats.find((x) => x.isPrimary) ?? formats[0]
      if (!f) throw notFound('That media item has no file')
      const blob = await ctx.services.files.get(f.blobId)
      const kind = f.kind === 'image' ? 'image' : f.kind === 'video' ? 'video' : null
      if (!kind) throw badRequest('Only videos and pictures can be published')
      return { path: await ctx.services.files.readablePath(blob), mime: blob.mime, kind }
    }

    // ── MCP ─────────────────────────────────────────────────────────────
    ctx.mcp.tool({
      name: 'accounts_list',
      title: 'Connected social accounts',
      description:
        'The Instagram, Facebook, TikTok and YouTube accounts Greenlit can publish to: id, platform, name, handle, state (connected / needs_login / error), what each can do (placements, native scheduling, music, edit/delete after publishing) and when they were last checked and synced.',
      input: {},
      access: 'connectors.read',
      readOnly: true,
      handler: async () =>
        (await svc.accounts()).map((a) => ({
          id: a.id,
          platform: a.platform,
          name: a.name,
          handle: a.handle,
          state: a.state,
          stateMessage: a.stateMessage,
          capabilities: a.capabilities,
          lastCheckedAt: a.lastCheckedAt,
          lastSyncedAt: a.lastSyncedAt,
        })),
    })
    ctx.mcp.tool({
      name: 'accounts_check',
      title: 'Check connected accounts',
      description:
        'Checks now that an account (or every account, without accountId) is still signed in on its platform. An account that needs a new sign-in becomes needs_login; only a person can sign in again (Settings → Connected accounts → Reconnect).',
      input: { accountId: z.uuid().optional() },
      access: 'connectors.manage',
      handler: async ({ accountId }) => {
        const list = accountId ? [await svc.check(accountId)] : await svc.checkAll()
        return list.map((a) => ({
          id: a.id,
          platform: a.platform,
          name: a.name,
          state: a.state,
          message: a.stateMessage,
        }))
      },
    })
    ctx.mcp.tool({
      name: 'music_search',
      title: 'Search platform music',
      description:
        'Searches the platform’s own music library for an account (TikTok sounds, Facebook reel music). Returns trackId, title, artist, duration, preview URL and how many posts use it. Put the chosen track on a post target as `music` ({ trackId, title, artist, startAt }): the platform attaches it, nothing is mixed into the file. Returns [] when the platform’s web tools have no music library (YouTube, Instagram).',
      input: { accountId: z.uuid(), query: z.string().max(200), placement: Placement.default('reel') },
      access: 'connectors.read',
      readOnly: true,
      handler: ({ accountId, query, placement }) => svc.searchMusic(accountId, query, placement),
    })
    ctx.mcp.tool({
      name: 'accounts_available',
      title: 'Pages and accounts a sign-in reaches',
      description:
        'Lists everything a connected account’s sign-in can publish to: every YouTube channel of the Google sign-in, a Facebook profile and every Page it can act as, or (Meta Business Suite) each managed Page and its linked Instagram. A sign-in connects them all; entries with an accountId are connected. Pass `connect` (keys from this list) to connect ones that appeared since, without signing in again.',
      input: {
        accountId: z.uuid(),
        connect: z.array(z.string().max(200)).max(500).optional(),
      },
      access: 'connectors.manage',
      handler: async ({ accountId, connect }, { actor }) => {
        if (connect?.length) {
          const added = await svc.connectAvailable(accountId, connect, actor)
          return added.map((a) => ({ id: a.id, platform: a.platform, name: a.name, handle: a.handle }))
        }
        return svc.available(accountId)
      },
    })
    ctx.mcp.instruct(
      'Social accounts: accounts_list shows where Greenlit can publish and what each platform allows (music, scheduling, editing). Publishing itself happens through posts; music for a post comes from music_search on the target account.',
    )
  },
})
