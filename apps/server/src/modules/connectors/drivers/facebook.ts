import type { Placement } from '@greenlit/shared/areas/posts'
import { graphAs } from './graph.ts'
import {
  ConnectorUnsupported,
  type DriverAccount,
  type DriverRun,
  noCapabilities,
  type PublishRequest,
  type RemotePost,
} from './types.ts'
import { firstUrl, num, str } from './util.ts'

/**
 * The Facebook Page side of the Meta driver: posting goes through the Business Suite composer (meta.ts);
 * reading back, editing and deleting Page posts use the Graph calls Business Suite itself makes.
 */

export const facebookCapabilities = {
  ...noCapabilities,
  placements: ['feed', 'reel', 'story'] as Placement[],
  nativeSchedule: true,
  editAfterPublish: true,
  delete: true,
  music: true,
  audioMix: false,
  thumbnail: true,
  location: true,
  firstComment: true,
  sync: true,
  stats: true,
}

/** Business Suite books Page posts 10 minutes to 29 days ahead (reels and posts alike). */
export const META_SCHEDULE = { minLeadMinutes: 10, maxLeadDays: 29 }

type Edge<T> = { data?: T[]; paging?: { next?: string } }

export async function listFacebook(
  run: DriverRun,
  account: DriverAccount,
  since?: Date,
): Promise<RemotePost[]> {
  const pageId = account.platformIds.pageId || account.externalId
  const sinceParam: Record<string, string> = since
    ? { since: String(Math.floor(since.getTime() / 1000)) }
    : {}
  const out = new Map<string, RemotePost>()
  const fields =
    'id,message,permalink_url,created_time,full_picture,is_published,scheduled_publish_time,attachments{media_type,media,url,target},reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares'
  const published = await graphAs<Edge<Record<string, unknown>>>(
    run,
    { pageId },
    `${pageId}/published_posts`,
    { fields, limit: '50', ...sinceParam },
  )
  for (const p of published.data ?? []) out.set(str(p.id), fbPost(p, 'published'))
  const scheduled = await graphAs<Edge<Record<string, unknown>>>(
    run,
    { pageId },
    `${pageId}/scheduled_posts`,
    {
      fields:
        'id,message,permalink_url,created_time,full_picture,scheduled_publish_time,attachments{media_type,media,url}',
      limit: '50',
    },
  ).catch(() => ({ data: [] }))
  for (const p of scheduled.data ?? []) out.set(str(p.id), fbPost(p, 'scheduled'))
  const reels = await graphAs<Edge<Record<string, unknown>>>(run, { pageId }, `${pageId}/video_reels`, {
    fields:
      'id,description,permalink_url,created_time,updated_time,picture,status,scheduled_publish_time,post_id',
    limit: '50',
    ...sinceParam,
  }).catch(() => ({ data: [] }))
  for (const r of reels.data ?? []) {
    const status = r.status as Record<string, unknown> | undefined
    const sched = num(r.scheduled_publish_time)
    const scheduled = !!sched && sched * 1000 > Date.now()
    out.set(str(r.id), {
      remoteId: str(r.id),
      url: str(r.permalink_url) ? new URL(str(r.permalink_url), 'https://www.facebook.com').toString() : null,
      placement: 'reel',
      title: '',
      caption: str(r.description),
      thumbnailUrl: str(r.picture) || null,
      mediaUrl: null,
      state: scheduled || /SCHEDULED/i.test(str(status?.video_status)) ? 'scheduled' : 'published',
      scheduledAt: sched ? new Date(sched * 1000).toISOString() : null,
      publishedAt: scheduled
        ? null
        : str(r.created_time)
          ? new Date(str(r.created_time)).toISOString()
          : null,
      stats: null,
    })
  }
  return [...out.values()]
}

function fbPost(p: Record<string, unknown>, state: 'published' | 'scheduled'): RemotePost {
  const att = ((p.attachments as Edge<Record<string, unknown>> | undefined)?.data ?? [])[0] ?? {}
  const type = str(att.media_type)
  const sched = num(p.scheduled_publish_time)
  const stats: Record<string, number> = {}
  const likes = num(
    ((p.reactions as Record<string, unknown> | undefined)?.summary as Record<string, unknown> | undefined)
      ?.total_count,
  )
  const comments = num(
    ((p.comments as Record<string, unknown> | undefined)?.summary as Record<string, unknown> | undefined)
      ?.total_count,
  )
  const shares = num((p.shares as Record<string, unknown> | undefined)?.count)
  if (likes !== null) stats.reactions = likes
  if (comments !== null) stats.comments = comments
  if (shares !== null) stats.shares = shares
  return {
    remoteId: str(p.id),
    url: str(p.permalink_url) || null,
    placement: /video/i.test(type) && /reel/i.test(str(att.url)) ? 'reel' : 'feed',
    title: '',
    caption: str(p.message),
    thumbnailUrl: str(p.full_picture) || firstUrl((att.media as Record<string, unknown> | undefined)?.image),
    mediaUrl: str((att.media as Record<string, unknown> | undefined)?.source) || null,
    state,
    scheduledAt: sched ? new Date(sched * 1000).toISOString() : null,
    publishedAt:
      state === 'published' && str(p.created_time) ? new Date(str(p.created_time)).toISOString() : null,
    stats: Object.keys(stats).length ? stats : null,
  }
}

export async function updateFacebook(
  run: DriverRun,
  account: DriverAccount,
  remoteId: string,
  patch: Partial<PublishRequest>,
) {
  const pageId = account.platformIds.pageId || account.externalId
  const unsupported = (['files', 'music', 'thumbnailPath', 'location', 'placement'] as const).filter(
    (k) => patch[k] !== undefined,
  )
  if (unsupported.length)
    throw new ConnectorUnsupported(
      unsupported.join(', '),
      'Facebook keeps the media, cover, sound and place of a post once it is on the Page. Delete it and post again.',
    )
  const isReel = !remoteId.includes('_')
  const fields: Record<string, string> = {}
  if (patch.caption !== undefined) fields[isReel ? 'description' : 'message'] = patch.caption
  // A new time for a post that is still scheduled (null = leave it as it is).
  if (patch.scheduleAt instanceof Date && patch.scheduleAt.getTime() > Date.now())
    fields.scheduled_publish_time = String(Math.floor(patch.scheduleAt.getTime() / 1000))
  if (!Object.keys(fields).length) return
  await graphAs(run, { pageId }, remoteId, fields, 'POST')
  run.step(`Updated ${remoteId} on Facebook`)
}

export async function removeFacebook(run: DriverRun, account: DriverAccount, remoteId: string) {
  const pageId = account.platformIds.pageId || account.externalId
  await graphAs(run, { pageId }, remoteId, {}, 'DELETE')
  run.step(`Deleted ${remoteId} from Facebook`)
}

export async function commentFacebook(
  run: DriverRun,
  account: DriverAccount,
  remoteId: string,
  message: string,
) {
  const pageId = account.platformIds.pageId || account.externalId
  await graphAs(run, { pageId }, `${remoteId}/comments`, { message }, 'POST')
  run.step('First comment posted')
}
