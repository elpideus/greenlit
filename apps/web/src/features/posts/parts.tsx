import { type Account, type Post, type PostTarget, postThumbnail } from '@greenlit/shared'
import { ExternalLink, Image as ImageIcon, MoreHorizontal } from 'lucide-react'
import { Link } from 'react-router'
import { menuEntries } from '@/app/registry'
import { PlatformIcon } from '@/components/PlatformIcon'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { formatDate, formatRelative, formatTime, useTimeZone } from '@/lib/time'
import { IconButton, openContextMenu, Tally, type Tone, Tooltip, useContextMenu } from '@/ui'
import { postMenuOwnItems } from './menus'

export function targetTone(t: Pick<PostTarget, 'state' | 'scheduleAt'>): Tone {
  switch (t.state) {
    case 'published':
      return 'live'
    case 'scheduled':
      return 'scheduled'
    case 'failed':
      return 'failed'
    case 'queued':
      return t.scheduleAt && new Date(t.scheduleAt).getTime() > Date.now() + 60_000 ? 'scheduled' : 'review'
    case 'preparing':
    case 'uploading':
      return 'review'
    default:
      return 'draft'
  }
}

export function postTone(status: Post['status']): Tone {
  switch (status) {
    case 'published':
      return 'live'
    case 'scheduled':
      return 'scheduled'
    case 'failed':
      return 'failed'
    case 'partial':
    case 'publishing':
      return 'review'
    default:
      return 'draft'
  }
}

/** "Instagram Reel" in the user's language. */
export function useWhere() {
  const t = useT('posts')
  return (platform: string, placement?: string) => {
    const name =
      { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' }[platform] ??
      platform
    return placement ? `${name} ${t(`placement.${placement}`)}` : name
  }
}

/** A version on one account: platform tile, placement, its lamp and time. */
export function TargetChip({
  target,
  account,
  compact,
  className,
}: {
  target: PostTarget
  account?: Account
  compact?: boolean
  className?: string
}) {
  const t = useT('posts')
  const tz = useTimeZone()
  const tone = targetTone(target)
  const when = target.publishedAt ?? target.scheduleAt
  const label = `${account?.name ?? target.platform} · ${t(`placement.${target.placement}`)} · ${t(`state.${target.state}`)}`
  return (
    <Tooltip label={target.error ? `${label}: ${target.error}` : label}>
      <span
        className={cn(
          'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-tag bg-hover pr-2 pl-1 t-caption text-ink-2 shadow-[inset_0_0_0_.5px_var(--line)]',
          !target.enabled && 'opacity-45',
          className,
        )}
      >
        <PlatformIcon platform={target.platform} size={16} tile />
        {!compact && <span className="text-ink">{t(`placement.${target.placement}`)}</span>}
        <Tally
          tone={tone}
          size={6}
          pulse={['queued', 'preparing', 'uploading'].includes(target.state) && tone === 'review'}
        />
        {!compact && when && (
          <span className="t-meta text-ink-3">
            {formatDate(when, tz, { day: 'numeric', month: 'short' })}
          </span>
        )}
      </span>
    </Tooltip>
  )
}

/** One post in a list: frame, name or caption, versions, time. Right-click for its menu. */
export function PostRow({
  post,
  accounts,
  className,
}: {
  post: Post
  accounts: Account[]
  className?: string
}) {
  const t = useT('posts')
  const tz = useTimeZone()
  const me = useSession()
  const items = () => menuEntries('post', { post, me }, postMenuOwnItems(post, me, t))
  const menu = useContextMenu(items)
  const m = post.media[0]
  const f = m?.formats[0]
  const thumb = postThumbnail(post)
  const live = post.targets.filter((x) => x.state !== 'removed')
  const when =
    post.status === 'published'
      ? live
          .map((x) => x.publishedAt)
          .filter(Boolean)
          .sort()
          .at(-1)
      : post.scheduleAt
  const remote = live.find((x) => x.remoteUrl)
  return (
    <Link
      to={`/posts/${post.id}`}
      {...menu}
      className={cn(
        'press group relative flex items-center gap-4 rounded-panel px-2.5 py-2.5 hover-device:hover:bg-hover',
        className,
      )}
    >
      <div className="relative aspect-[4/3] w-[92px] shrink-0 overflow-hidden rounded-tile bg-stage">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[#5c605d]">
            <ImageIcon size={18} strokeWidth={1.5} />
          </span>
        )}
        {post.media.length > 1 && (
          <span className="force-dark absolute top-1 right-1 rounded-[4px] bg-black/55 px-1 t-meta text-[10px] text-white backdrop-blur-md">
            {post.media.length}
          </span>
        )}
        {f?.duration ? (
          <span className="force-dark absolute right-1 bottom-1 rounded-[4px] bg-black/55 px-1 t-meta text-[10px] text-white backdrop-blur-md">
            {formatDuration(f.duration)}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Tally tone={postTone(post.status)} size={7} pulse={post.status === 'publishing'} />
          <span className="truncate t-callout font-[550] text-ink">
            {post.name || post.title || firstLine(post.caption) || t('untitled')}
          </span>
          <span className="shrink-0 t-caption text-ink-3">{t(`status.${post.status}`)}</span>
        </div>
        <div className="mt-0.5 truncate t-caption text-ink-3">
          {post.name && post.caption ? firstLine(post.caption) : post.caption ? '' : t('noText')}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {live.length ? (
            live.map((x) => (
              <TargetChip key={x.id} target={x} account={accounts.find((a) => a.id === x.accountId)} />
            ))
          ) : (
            <span className="t-caption text-ink-4">{t('noDestinations')}</span>
          )}
        </div>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        {when ? (
          <>
            <span className="t-meta text-ink-2">
              {formatDate(when, tz, { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
            <span className="t-meta text-ink-3">{formatTime(when, tz)}</span>
          </>
        ) : (
          <span className="t-meta text-ink-4">{formatRelative(post.updatedAt, tz)}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {remote?.remoteUrl && (
          <IconButton
            size="sm"
            icon={ExternalLink}
            label={t('composer.openOnPlatform', { where: remote.platform })}
            onClick={(e) => {
              e.preventDefault()
              window.open(remote.remoteUrl!, '_blank', 'noopener')
            }}
          />
        )}
        <IconButton
          size="sm"
          icon={MoreHorizontal}
          label={t('common:more')}
          onClick={(e) => {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            openContextMenu(r.left, r.bottom + 4, items())
          }}
        />
      </div>
    </Link>
  )
}

export function firstLine(s: string) {
  return (
    s
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? ''
  )
}
