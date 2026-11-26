import { getPlacement, type Issue, validateForPlacement } from '@greenlit/platforms'
import type { Post, PostTarget } from '@greenlit/shared'
import type { Account } from '@greenlit/shared/areas/connectors'
import { PostsService } from './service.ts'

/**
 * What a platform will say about one version of a post: its account, its text and its media, all its pictures and
 * videos counted (a story takes one, a carousel up to the platform's most). The post page, posts_check and publishing
 * all ask this, so what the page shows is what stops a publish.
 */
export function checkTarget(
  post: Pick<Post, 'caption' | 'title' | 'hashtags' | 'media'>,
  t: Pick<PostTarget, 'platform' | 'placement' | 'caption' | 'title' | 'hashtags' | 'formats' | 'versions'>,
  account?: Pick<Account, 'state' | 'capabilities'>,
): Issue[] {
  if (account?.state === 'disabled')
    return [
      {
        level: 'error',
        code: 'account_off',
        message: 'This account is turned off in Connected accounts',
        params: {},
      },
    ]
  if (account?.capabilities.publish === false)
    return [
      {
        level: 'error',
        code: 'account_read_only',
        message: 'Greenlit cannot publish to this account yet',
        params: {},
      },
    ]
  const spec = getPlacement(t.platform, t.placement)
  if (!spec)
    return [
      {
        level: 'error',
        code: 'unsupported',
        message: `${t.platform} ${t.placement} is not supported`,
        params: {},
      },
    ]
  const m = post.media[0]
  const id = m?.mediaId ?? ''
  const fs = m?.versions.find((v) => v.key === t.versions[id])?.formats ?? m?.formats
  const f = fs?.find((x) => x.key === t.formats[id]) ?? fs?.[0]
  const src =
    m && f?.width && f.height
      ? {
          kind: (m.kind === 'image' ? 'image' : 'video') as 'video' | 'image',
          width: f.width,
          height: f.height,
          durationSec: f.duration,
        }
      : null
  return validateForPlacement(spec, src, {
    caption: PostsService.composeCaption(post, t),
    title: t.title ?? post.title,
    hashtags: t.hashtags ?? post.hashtags,
    items: post.media.length,
  })
}
