import type { Account, Connectable } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { PlatformIcon } from '@/components/PlatformIcon'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Avatar, Badge, Button, Checkbox, Dialog, EmptyState, Skeleton, toast } from '@/ui'
import { accountsApi, useRefreshAccounts } from './api'

/**
 * What a sign-in reaches, to pick from: grouped by where it comes from (your own Pages, then each business
 * portfolio), an Instagram account under the Page it is linked to. Already connected ones are ticked and fixed.
 */
export function ChoiceList({
  choices,
  value,
  onChange,
}: {
  choices: Connectable[]
  value: string[]
  onChange: (keys: string[]) => void
}) {
  const t = useT('connectors')
  const groups = useMemo(() => {
    const by = new Map<string, Connectable[]>()
    for (const c of choices) {
      if (c.linkedTo && choices.some((p) => p.key === c.linkedTo)) continue
      const g = c.via ?? ''
      by.set(g, [...(by.get(g) ?? []), c])
    }
    return [...by.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [choices])
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key])
  const row = (c: Connectable, nested?: boolean) => {
    const connected = !!c.accountId
    const on = connected || value.includes(c.key)
    const linkedPage = c.linkedTo ? choices.find((p) => p.key === c.linkedTo) : null
    return (
      // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control
      <label
        key={c.key}
        className={cn(
          'flex h-14 cursor-default items-center gap-3 rounded-[9px] px-2.5 hover:bg-hover',
          nested && 'ml-7',
          connected && 'opacity-60',
        )}
      >
        <Checkbox checked={on} disabled={connected} onChange={() => toggle(c.key)} />
        <span className="relative">
          <Avatar user={{ id: c.key, displayName: c.name, avatarUrl: c.avatarUrl }} size={30} />
          <span className="absolute -right-1 -bottom-1">
            <PlatformIcon platform={c.platform} size={14} tile />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate t-callout text-ink">{c.name}</span>
          <span className="block truncate t-caption text-ink-3">
            {c.handle}
            {linkedPage && !nested ? ` · ${t('remote.linkedTo', { page: linkedPage.name })}` : ''}
          </span>
        </span>
        {connected && <Badge tone="signal">{t('remote.already')}</Badge>}
      </label>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([via, list]) => (
        <div key={via || 'own'}>
          <div className="mb-1 px-2.5 t-micro text-ink-3">{via || t('remote.yourPages')}</div>
          {list.map((c) => (
            <div key={c.key}>
              {row(c)}
              {choices.filter((x) => x.linkedTo === c.key).map((x) => row(x, true))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** "Connect more from this sign-in": everything the account's sign-in reaches, without signing in again. */
export function ChooseAccountsDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const t = useT('connectors')
  const refresh = useRefreshAccounts()
  const [keys, setKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['connectors', 'available', account.id],
    queryFn: () => accountsApi.available(account.id),
  })
  const submit = async () => {
    setBusy(true)
    try {
      const added = await accountsApi.connectMore(account.id, keys)
      toast.done(t('cookies.done', { count: added.length }))
      void refresh()
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={520}
      title={t('remote.choose')}
      description={t('remote.chooseBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" disabled={!keys.length} loading={busy} onClick={() => void submit()}>
            {t('remote.connectN', { count: keys.length })}
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : error ? (
        <div className="py-6 text-center t-callout text-cut">{(error as Error).message}</div>
      ) : !data?.length ? (
        <EmptyState compact title={t('empty')} />
      ) : (
        <div className="-mx-2.5 max-h-[50dvh] overflow-y-auto">
          <ChoiceList choices={data} value={keys} onChange={setKeys} />
        </div>
      )}
    </Dialog>
  )
}
