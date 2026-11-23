import type { Account, Placement } from '@greenlit/shared'
import { Check, Link2 } from 'lucide-react'
import { Link } from 'react-router'
import { PLATFORM_NAME, PlatformIcon } from '@/components/PlatformIcon'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Avatar, Button, Tally, Tooltip } from '@/ui'
import { newTarget, onPlatform, PLATFORM_ORDER, publishableAccounts, targetKey } from '../model'
import { Panel } from './bits'
import { useComposer } from './state'

/**
 * Where the post goes: every connected account (one sign-in can reach several channels and Pages), with the
 * placements each one takes. A project's next post starts with what its last one used.
 */
export function DestinationsSection() {
  const t = useT('posts')
  const c = useComposer()
  const accounts = publishableAccounts(c.accounts)
  const hasVideo = c.media.some((m) => m.kind === 'video')
  const hasImage = c.media.some((m) => m.kind === 'image')

  const toggle = (a: Account, placement: Placement) => {
    const key = targetKey(a.id, placement)
    const existing = c.draft.targets.find((x) => x.key === key)
    const server = c.post.targets.find((x) => x.accountId === a.id && x.placement === placement)
    c.update((d) => {
      if (existing) {
        // A version on its platform is never dropped silently: it is switched off (remove it there explicitly).
        if (server && onPlatform(server))
          return { ...d, targets: d.targets.map((x) => (x.key === key ? { ...x, enabled: !x.enabled } : x)) }
        if (!existing.enabled)
          return { ...d, targets: d.targets.map((x) => (x.key === key ? { ...x, enabled: true } : x)) }
        return { ...d, targets: d.targets.filter((x) => x.key !== key) }
      }
      return { ...d, targets: [...d.targets, newTarget(a.id, placement)] }
    })
    if (!existing) c.select(key)
  }

  if (!accounts.length)
    return (
      <Panel title={t('composer.destinations')}>
        <div className="flex items-center gap-4 rounded-[10px] px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="flex -space-x-1.5">
            {PLATFORM_ORDER.map((p) => (
              <PlatformIcon key={p} platform={p} size={26} tile className="shadow-[0_0_0_2px_var(--panel)]" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="t-callout font-[550] text-ink">{t('composer.noAccounts')}</div>
            <div className="t-caption text-ink-3">{t('composer.noAccountsBody')}</div>
          </div>
          <Link to="/settings/accounts">
            <Button icon={Link2}>{t('composer.connectAccounts')}</Button>
          </Link>
        </div>
      </Panel>
    )

  return (
    <Panel title={t('composer.destinations')} hint={t('composer.destinationsHint')}>
      <div className="flex flex-col gap-1">
        {PLATFORM_ORDER.flatMap((platform) =>
          accounts
            .filter((a) => a.platform === platform)
            .map((a) => {
              const readOnly = a.capabilities.publish === false
              const needsLogin = a.state === 'needs_login'
              const broken = a.state === 'error'
              const visible = a.capabilities.placements
                .filter((p) => p !== 'post')
                // Hide what the media cannot be (a reel needs a video, a TikTok photo post pictures) unless already chosen.
                .filter(
                  (p) =>
                    !c.media.length ||
                    c.draft.targets.some((x) => x.key === targetKey(a.id, p)) ||
                    (p === 'photo' ? hasImage : ['video', 'short', 'reel'].includes(p) ? hasVideo : true),
                )
              return (
                <div
                  key={a.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] px-2 py-2',
                    readOnly && 'opacity-55',
                  )}
                >
                  <span className="relative shrink-0">
                    <Avatar user={{ id: a.id, displayName: a.name, avatarUrl: a.avatarUrl }} size={34} />
                    <PlatformIcon
                      platform={a.platform}
                      size={16}
                      tile
                      className="absolute -right-1 -bottom-1 shadow-[0_0_0_2px_var(--panel)]"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 whitespace-nowrap">
                      <span className="truncate t-callout font-[550] text-ink">{a.name}</span>
                      {needsLogin && (
                        <span className="inline-flex items-center gap-1 t-caption text-cut">
                          <Tally tone="changes" size={6} />
                          {t('composer.needsLogin')}
                        </span>
                      )}
                      {broken && (
                        <Tooltip label={a.stateMessage ?? undefined}>
                          <span className="inline-flex items-center gap-1 t-caption text-review">
                            <Tally tone="review" size={6} />
                            {t('composer.accountError')}
                          </span>
                        </Tooltip>
                      )}
                      {readOnly && <span className="t-caption text-ink-3">{t('composer.readOnly')}</span>}
                    </div>
                    <div className="truncate t-caption text-ink-3">
                      {[
                        a.handle,
                        a.signIn.name && a.signIn.name !== a.name ? a.signIn.name : null,
                        PLATFORM_NAME[a.platform],
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5 max-sm:basis-full max-sm:justify-start max-sm:pl-[46px]">
                    {visible.length === 0 && (
                      <span className="t-caption text-ink-4">
                        {hasVideo ? t('composer.needsPictures') : t('composer.needsVideo')}
                      </span>
                    )}
                    {visible.map((p) => {
                      const key = targetKey(a.id, p)
                      const target = c.draft.targets.find((x) => x.key === key)
                      const on = !!target?.enabled
                      const server = c.post.targets.find((x) => x.accountId === a.id && x.placement === p)
                      const live = server && onPlatform(server)
                      return (
                        <Tooltip key={p} label={live ? t(`state.${server.state}`) : undefined}>
                          <button
                            type="button"
                            disabled={!c.editable || readOnly}
                            aria-pressed={on}
                            onClick={() => toggle(a, p)}
                            className={cn(
                              'press inline-flex h-7 items-center gap-1.5 rounded-control px-2.5 t-callout transition-[background-color,box-shadow,color] duration-150 disabled:pointer-events-none',
                              on
                                ? 'bg-signal-soft font-[550] text-signal shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--signal)_45%,transparent)]'
                                : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover hover:text-ink',
                            )}
                          >
                            {on && <Check size={13} strokeWidth={2.6} />}
                            {t(`placement.${p}`)}
                            {live && (
                              <Tally tone={server.state === 'published' ? 'live' : 'scheduled'} size={6} />
                            )}
                          </button>
                        </Tooltip>
                      )
                    })}
                  </div>
                </div>
              )
            }),
        )}
      </div>
    </Panel>
  )
}
