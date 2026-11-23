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
import { num, str } from './util.ts'

/**
 * The Instagram side of the Meta driver. Instagram's own website has no scheduler and no music picker, so posts
 * go through Meta Business Suite, which publishes to the Instagram professional account linked to the Page and
 * keeps the schedule on Meta's side. Reading back uses the Graph calls Business Suite makes.
 *
 * Instagram cannot change a caption or delete a post through these tools; those stay in the Instagram app.
 */

export const instagramCapabilities = {
  ...noCapabilities,
  placements: ['feed', 'reel', 'story'] as Placement[],
  nativeSchedule: true,
  editAfterPublish: false,
  delete: false,
  // Business Suite's reel composer offers music for Facebook reels; for Instagram it is not proven yet.
  music: false,
  audioMix: false,
  thumbnail: true,
  location: true,
  firstComment: true,
  sync: true,
  stats: true,
}

type Edge<T> = { data?: T[] }

export async function listInstagram(
  run: DriverRun,
  account: DriverAccount,
  since?: Date,
): Promise<RemotePost[]> {
  const igId = account.platformIds.igUserId || account.externalId
  const params: Record<string, string> = {
    fields:
      'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
    limit: '50',
  }
  if (since) params.since = String(Math.floor(since.getTime() / 1000))
  const res = await graphAs<Edge<Record<string, unknown>>>(run, 'user', `${igId}/media`, params)
  return (res.data ?? []).map((m) => {
    const product = str(m.media_product_type)
    const stats: Record<string, number> = {}
    const likes = num(m.like_count)
    const comments = num(m.comments_count)
    if (likes !== null) stats.likes = likes
    if (comments !== null) stats.comments = comments
    return {
      remoteId: str(m.id),
      url: str(m.permalink) || null,
      placement: product === 'REELS' ? 'reel' : product === 'STORY' ? 'story' : 'feed',
      title: '',
      caption: str(m.caption),
      thumbnailUrl: str(m.thumbnail_url) || (str(m.media_type) === 'IMAGE' ? str(m.media_url) : '') || null,
      mediaUrl: str(m.media_url) || null,
      state: 'published' as const,
      scheduledAt: null,
      publishedAt: str(m.timestamp) ? new Date(str(m.timestamp)).toISOString() : null,
      stats: Object.keys(stats).length ? stats : null,
    }
  })
}

export function updateInstagram(_patch: Partial<PublishRequest>): never {
  throw new ConnectorUnsupported(
    'caption',
    'Instagram posts can only be edited in the Instagram app. Scheduled ones can be deleted in Business Suite and scheduled again.',
  )
}

export function removeInstagram(): never {
  throw new ConnectorUnsupported('delete', 'Instagram posts can only be deleted in the Instagram app.')
}

export async function commentInstagram(
  run: DriverRun,
  account: DriverAccount,
  remoteId: string,
  message: string,
) {
  await graphAs(run, 'user', `${remoteId}/comments`, { message }, 'POST')
  run.step('First comment posted')
  void account
}
