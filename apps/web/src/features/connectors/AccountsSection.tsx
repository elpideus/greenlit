import type { Account, Platform } from '@greenlit/shared'
import {
  ExternalLink,
  Link2,
  LogIn,
  MoreHorizontal,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { PLATFORM_NAME, PlatformIcon } from '@/components/PlatformIcon'
import { SettingsGroup, SettingsSection } from '@/components/SettingsSection'
import { useAccounts } from '@/data/accounts'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { stagger } from '@/lib/motion'
import { useCan } from '@/lib/session'
import { formatRelative, useTimeZone } from '@/lib/time'
import {
  Avatar,
  Button,
  Chip,
  confirm,
  EmptyState,
  IconButton,
  Menu,
  type MenuEntry,
  Skeleton,
  Tally,
  Tooltip,
  toast,
  toneFor,
  useContextMenu,
} from '@/ui'
import { accountsApi, driverLabel, usePlatforms, useRefreshAccounts } from './api'
import { ChooseAccountsDialog } from './ChooseAccounts'
import { ConnectDialog } from './ConnectDialog'

const PLATFORM_ORDER: Platform[] = ['instagram', 'facebook', 'tiktok', 'youtube']

export default function AccountsSection() {
  const t = useT('connectors')
  const manage = useCan('connectors.manage')
  const { data: accounts, isLoading } = useAccounts()
  const [connect, setConnect] = useState<{ platform?: Platform; driver?: string; accountId?: string } | null>(
    null,
  )
  const [more, setMore] = useState<Account | null>(null)

  /** Main accounts (merged ones are folded into theirs), grouped by the sign-in that reaches them. */
  const groups = useMemo(() => {
    const main = (accounts ?? []).filter((a) => !a.mergedInto)
    const by = new Map<string, Account[]>()
    for (const a of main) {
      const key = `${a.platform}:${a.signIn.id}`
      by.set(key, [...(by.get(key) ?? []), a])
    }
    return [...by.values()]
      .map((list) =>
        list.sort(
          (a, b) =>
            Number(a.state === 'disabled') - Number(b.state === 'disabled') || a.name.localeCompare(b.name),
        ),
      )
      .sort((a, b) => PLATFORM_ORDER.indexOf(a[0]!.platform) - PLATFORM_ORDER.indexOf(b[0]!.platform))
  }, [accounts])

  return (
    <SettingsSection
      title={t('section')}
      description={t('description')}
      actions={
        manage && (
          <Button variant="primary" icon={Plus} onClick={() => setConnect({})}>
            {t('connect')}
          </Button>
        )
      }
    >
      {isLoading ? (
        <>
          <Skeleton className="h-40 rounded-panel" />
          <Skeleton className="h-28 rounded-panel" />
        </>
      ) : groups.length === 0 ? (
        <div className="rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
          <EmptyState
            icon={Link2}
            title={t('empty')}
            body={t('emptyBody')}
            action={
              manage && (
                <Button variant="primary" icon={Plus} onClick={() => setConnect({})}>
                  {t('connect')}
                </Button>
              )
            }
          />
        </div>
      ) : (
        groups.map((list) => (
          <SignInGroup
            key={`${list[0]!.platform}:${list[0]!.signIn.id}`}
            accounts={list}
            onSignInAgain={(a) => setConnect({ platform: a.platform, driver: a.driver, accountId: a.id })}
            onConnectMore={setMore}
          />
        ))
      )}

      {connect && <ConnectDialog initial={connect} onClose={() => setConnect(null)} />}
      {more && <ChooseAccountsDialog account={more} onClose={() => setMore(null)} />}
    </SettingsSection>
  )
}

function SignInGroup({
  accounts,
  onSignInAgain,
  onConnectMore,
}: {
  accounts: Account[]
  onSignInAgain: (a: Account) => void
  onConnectMore: (a: Account) => void
}) {
  const t = useT('connectors')
  const manage = useCan('connectors.manage')
  const { data: platforms } = usePlatforms()
  const first = accounts[0]!
  const signIn = first.signIn
  const driver = driverLabel(first.driver, platforms, (p) => t('appOnDevice', { platform: p }))
  return (
    <SettingsGroup
      title={
        <span className="flex items-center gap-2.5">
          <PlatformIcon platform={first.platform} size={18} tile />
          <span className="min-w-0 truncate">
            {signIn.name || signIn.handle || PLATFORM_NAME[first.platform]}
          </span>
        </span>
      }
      description={
        <span>
          {PLATFORM_NAME[first.platform]}
          {driver !== PLATFORM_NAME[first.platform] && ` · ${t('via', { driver })}`} ·{' '}
          {t('accounts', { count: accounts.length })}
        </span>
      }
      aside={
        manage && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={LogIn} onClick={() => onSignInAgain(first)}>
              {t('actions.signInAgain').replace('…', '')}
            </Button>
            <Menu
              align="end"
              trigger={<IconButton icon={MoreHorizontal} label={t('common:more')} size="sm" />}
              items={[
                { label: t('actions.connectMore'), icon: Plus, onSelect: () => onConnectMore(first) },
                { label: t('actions.signInAgain'), icon: LogIn, onSelect: () => onSignInAgain(first) },
              ]}
            />
          </div>
        )
      }
    >
      {accounts.map((a, i) => (
        <AccountRow
          key={a.id}
          account={a}
          index={i}
          onSignInAgain={() => onSignInAgain(a)}
          onConnectMore={() => onConnectMore(a)}
        />
      ))}
    </SettingsGroup>
  )
}

function capabilityChips(a: Account, t: (k: string) => string) {
  const c = a.capabilities
  const chips: string[] = []
  if (c.publish === false) chips.push(t('caps.readOnly'))
  if (c.nativeSchedule) chips.push(t('caps.schedule'))
  if (c.music) chips.push(c.audioMix ? `${t('caps.music')} · ${t('caps.audioMix')}` : t('caps.music'))
  if (c.thumbnail) chips.push(t('caps.thumbnail'))
  if (c.location) chips.push(t('caps.location'))
  if (c.firstComment) chips.push(t('caps.firstComment'))
  if (c.sync) chips.push(t('caps.sync'))
  if (c.stats) chips.push(t('caps.stats'))
  return chips
}

function AccountRow({
  account: a,
  index,
  onSignInAgain,
  onConnectMore,
}: {
  account: Account
  index: number
  onSignInAgain: () => void
  onConnectMore: () => void
}) {
  const t = useT('connectors')
  const tz = useTimeZone()
  const manage = useCan('connectors.manage')
  const refresh = useRefreshAccounts()
  const { data: platforms } = usePlatforms()
  const [busy, setBusy] = useState<string | null>(null)
  const off = a.state === 'disabled'
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const items = (): MenuEntry[] => [
    !!a.profileUrl && {
      label: t('actions.openProfile', { platform: PLATFORM_NAME[a.platform] }),
      icon: ExternalLink,
      onSelect: () => window.open(a.profileUrl!, '_blank', 'noopener'),
    },
    ...(manage
      ? ([
          'separator',
          {
            label: t('actions.checkNow'),
            icon: ShieldCheck,
            disabled: off,
            onSelect: () =>
              void run('check', async () => {
                const next = await accountsApi.check(a.id)
                if (next.state === 'connected') toast.done(t('actions.checked', { name: a.name }))
                else
                  toast.info(`${a.name}: ${t(`state.${next.state}`)}`, {
                    description: next.stateMessage ?? undefined,
                  })
              }),
          },
          a.capabilities.sync && {
            label: t('actions.syncNow'),
            icon: RefreshCw,
            disabled: off,
            onSelect: () =>
              void run('sync', async () => {
                const r = await accountsApi.sync(a.id)
                toast.done(t('actions.synced', { count: r.posts, name: a.name }))
              }),
          },
          { label: t('actions.connectMore'), icon: Plus, onSelect: onConnectMore },
          { label: t('actions.signInAgain'), icon: LogIn, onSelect: onSignInAgain },
          'separator',
          {
            label: off ? t('actions.turnOn') : t('actions.turnOff'),
            icon: Power,
            onSelect: () =>
              void run('enabled', async () => {
                await accountsApi.setEnabled(a.id, off)
                toast.done(t(off ? 'actions.turnedOn' : 'actions.turnedOff', { name: a.name }))
              }),
          },
          {
            label: t('actions.disconnect'),
            icon: Unplug,
            danger: true,
            onSelect: async () => {
              if (
                !(await confirm({
                  title: t('actions.disconnectTitle', { name: a.name }),
                  body: t('actions.disconnectBody'),
                  confirm: t('actions.disconnect').replace('…', ''),
                  danger: true,
                }))
              )
                return
              await run('disconnect', async () => {
                await accountsApi.disconnect(a.id)
                toast.done(t('actions.disconnected', { name: a.name }))
              })
            },
          },
        ] as MenuEntry[])
      : []),
  ]
  const menu = useContextMenu(items)
  const chips = capabilityChips(a, t)
  const placements = a.capabilities.placements.map((p) => t(`placements.${p}`)).join(' · ')
  const also = a.alsoThrough.map((x) =>
    driverLabel(x.driver, platforms, (p) => t('appOnDevice', { platform: p })),
  )
  const tone = toneFor(a.state)

  return (
    <motion.div
      {...stagger(index)}
      {...menu}
      className={cn('-mx-4 flex gap-3.5 px-4 py-3.5', off && 'opacity-55')}
    >
      <span className="relative mt-0.5 size-10 shrink-0 self-start">
        <Avatar user={{ id: a.id, displayName: a.name, avatarUrl: a.avatarUrl }} size={40} />
        <span className="absolute -right-1 -bottom-1 rounded-[7px] shadow-[0_0_0_2px_var(--panel)]">
          <PlatformIcon platform={a.platform} size={17} tile />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate t-callout font-[550] text-ink">{a.name}</span>
          {a.handle && <span className="truncate t-caption text-ink-3">{a.handle}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 t-caption">
          <Tooltip label={a.stateMessage} disabled={!a.stateMessage}>
            <span
              className={cn(
                'inline-flex items-center gap-1.5',
                tone === 'changes' || tone === 'failed' ? 'text-cut' : 'text-ink-2',
              )}
            >
              <Tally tone={off ? 'draft' : tone} size={7} pulse={a.state === 'connecting'} />
              {t(`state.${a.state}`)}
            </span>
          </Tooltip>
          {placements && <span className="text-ink-3">{placements}</span>}
          <span className="text-ink-4">
            {a.lastCheckedAt
              ? t('checked', { when: formatRelative(a.lastCheckedAt, tz) })
              : t('neverChecked')}
            {a.lastSyncedAt && ` · ${t('synced', { when: formatRelative(a.lastSyncedAt, tz) })}`}
          </span>
        </div>
        {a.stateMessage && (a.state === 'needs_login' || a.state === 'error') && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="line-clamp-2 t-caption text-ink-3">{a.stateMessage}</span>
            {manage && (
              <Button size="xs" variant="review" icon={LogIn} onClick={onSignInAgain}>
                {t('actions.signInAgain').replace('…', '')}
              </Button>
            )}
          </div>
        )}
        {(chips.length > 0 || also.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Chip
                key={c}
                className="h-[22px] bg-transparent text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]"
              >
                {c}
              </Chip>
            ))}
            {also.length > 0 && (
              <span className="self-center pl-1 t-caption text-ink-4">
                {t('alsoThrough', { list: also.join(', ') })}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {busy && <RefreshCw size={14} className="mt-2 animate-[gl-spin_0.9s_linear_infinite] text-ink-3" />}
        <Menu
          align="end"
          trigger={<IconButton icon={MoreHorizontal} label={t('common:more')} size="sm" />}
          items={items()}
        />
      </div>
    </motion.div>
  )
}
