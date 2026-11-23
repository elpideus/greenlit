import type { ApiToken, PlatformSettings } from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, BookOpen, Braces, KeyRound, Plus, Trash2, Waypoints } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { CopyBlock, SettingsGroup, SettingsSection } from '@/components/SettingsSection'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { stagger } from '@/lib/motion'
import { qk } from '@/lib/query'
import { formatDate, formatRelative, useTimeZone } from '@/lib/time'
import {
  Badge,
  Button,
  confirm,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Segmented,
  Signal,
  Skeleton,
  toast,
  useContextMenu,
} from '@/ui'

function absolute(url: string) {
  const u = url.trim().replace(/\/+$/, '')
  if (!u) return location.origin
  return /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`
}

function command(base: string, token: string) {
  return `claude mcp add --transport http greenlit ${base}/api/mcp --header "Authorization: Bearer ${token}"`
}

export default function DeveloperSection() {
  const t = useT('developer')
  const tz = useTimeZone()
  const qc = useQueryClient()
  const { data: tokens, isLoading } = useQuery({
    queryKey: qk.tokens,
    queryFn: () => api.get<ApiToken[]>('/me/tokens'),
  })
  const { data: platform } = useQuery({
    queryKey: [...qk.settings, 'platform'],
    queryFn: () => api.get<PlatformSettings>('/settings/platform'),
  })
  const base = absolute(platform?.publicUrl ?? '')
  const [creating, setCreating] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null)

  return (
    <SettingsSection
      title={t('section')}
      description={t('description')}
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setCreating('')}>
          {t('create')}
        </Button>
      }
    >
      <SettingsGroup title={t('claude')} description={t('claudeBody')}>
        <div className="flex flex-col gap-4 py-4">
          <Step n={1} title={t('step1')}>
            <Button size="sm" icon={KeyRound} onClick={() => setCreating('Claude Code')}>
              {t('createForClaude')}
            </Button>
          </Step>
          <Step n={2} title={t('step2')}>
            <CopyBlock
              text={command(base, fresh?.token ?? t('tokenPlaceholder'))}
              display={
                <>
                  <span className="text-ink-3">$ </span>claude mcp add --transport http greenlit{' '}
                  <span className="text-ink">{base}/api/mcp</span> --header &quot;Authorization: Bearer{' '}
                  <span className={fresh ? 'text-signal' : 'text-review'}>
                    {fresh?.token ?? t('tokenPlaceholder')}
                  </span>
                  &quot;
                </>
              }
            />
          </Step>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('tokens')} description={t('tokensHint')}>
        {isLoading ? (
          <div className="py-4">
            <Skeleton className="h-10" />
          </div>
        ) : !tokens?.length ? (
          <EmptyState compact icon={KeyRound} title={t('noTokens')} body={t('noTokensBody')} />
        ) : (
          tokens.map((tok, i) => (
            <TokenRow
              key={tok.id}
              token={tok}
              index={i}
              tz={tz}
              onRevoke={async () => {
                if (
                  !(await confirm({
                    title: t('revokeTitle', { name: tok.name }),
                    body: t('revokeBody'),
                    confirm: t('revoke'),
                    danger: true,
                  }))
                )
                  return
                try {
                  await api.delete(`/me/tokens/${tok.id}`)
                  void qc.invalidateQueries({ queryKey: qk.tokens })
                  toast.done(t('revoked'))
                } catch (err) {
                  toast.error(err)
                }
              }}
            />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title={t('reference')} bare>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { href: '/api/docs', icon: BookOpen, title: t('docs'), hint: t('docsHint') },
            { href: '/api/openapi.json', icon: Braces, title: t('openapi'), hint: t('openapiHint') },
            { href: null, icon: Waypoints, title: t('mcp'), hint: `${base}/api/mcp` },
          ].map((l) => {
            const body = (
              <>
                <span className="flex items-center justify-between">
                  <l.icon size={18} strokeWidth={1.7} className="text-ink-2" />
                  {l.href && (
                    <ArrowUpRight
                      size={15}
                      className="text-ink-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  )}
                </span>
                <span className="mt-6 block t-callout font-[550] text-ink">{l.title}</span>
                <span className={cn('mt-0.5 block truncate t-caption text-ink-3', !l.href && 't-meta')}>
                  {l.hint}
                </span>
              </>
            )
            const cls =
              'group block rounded-panel bg-panel p-4 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)]'
            return l.href ? (
              <a
                key={l.title}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  cls,
                  'press hover:shadow-[inset_0_0_0_1px_var(--line-strong),var(--shadow-lift)]',
                )}
              >
                {body}
              </a>
            ) : (
              <div key={l.title} className={cls}>
                {body}
              </div>
            )
          })}
        </div>
      </SettingsGroup>

      {creating !== null && (
        <CreateTokenDialog
          initialName={creating}
          onClose={() => setCreating(null)}
          onCreated={(name, token) => {
            setCreating(null)
            setFresh({ name, token })
            void qc.invalidateQueries({ queryKey: qk.tokens })
          }}
        />
      )}
      {fresh && (
        <FreshTokenDialog
          name={fresh.name}
          token={fresh.token}
          base={base}
          onClose={() => setFresh((f) => (f ? { ...f, name: '' } : f))}
          open={!!fresh.name}
        />
      )}
    </SettingsSection>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-hover t-meta text-ink-2">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-2 t-callout font-[550] text-ink">{title}</div>
        {children}
      </div>
    </div>
  )
}

function TokenRow({
  token,
  index,
  tz,
  onRevoke,
}: {
  token: ApiToken
  index: number
  tz: string
  onRevoke: () => void
}) {
  const t = useT('developer')
  const expired = !!token.expiresAt && new Date(token.expiresAt).getTime() < Date.now()
  const menu = useContextMenu(() => [{ label: t('revoke'), icon: Trash2, danger: true, onSelect: onRevoke }])
  return (
    <motion.div
      {...stagger(index)}
      {...menu}
      className={cn('flex min-h-14 items-center gap-3.5 py-2.5', expired && 'opacity-55')}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-hover text-ink-3">
        <KeyRound size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate t-callout font-[550] text-ink">{token.name}</span>
          {expired && <Badge tone="cut">{t('expired')}</Badge>}
        </div>
        <div className="truncate t-caption text-ink-3">
          <span className="t-meta">{token.prefix}…</span> ·{' '}
          {t('created', { when: formatRelative(token.createdAt, tz) })} ·{' '}
          {token.lastUsedAt ? t('lastUsed', { when: formatRelative(token.lastUsedAt, tz) }) : t('neverUsed')}
          {token.expiresAt && !expired && ` · ${t('expiresOn', { when: formatDate(token.expiresAt, tz) })}`}
        </div>
      </div>
      <IconButton icon={Trash2} label={t('revoke')} size="sm" onClick={onRevoke} />
    </motion.div>
  )
}

function CreateTokenDialog({
  initialName,
  onClose,
  onCreated,
}: {
  initialName: string
  onClose: () => void
  onCreated: (name: string, token: string) => void
}) {
  const t = useT('developer')
  const [name, setName] = useState(initialName)
  const [expiry, setExpiry] = useState<'never' | '30' | '90' | '365'>('never')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api.post<{ token: string; info: ApiToken }>('/me/tokens', {
        name: name.trim(),
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      })
      onCreated(r.info.name, r.token)
    } catch (err) {
      toast.error(err)
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={460}
      title={t('createTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" type="submit" form="token-form" loading={busy} disabled={!name.trim()}>
            {t('createButton')}
          </Button>
        </>
      }
    >
      <form id="token-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('name')}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              autoFocus
              maxLength={80}
            />
          )}
        </Field>
        <Field label={t('expires')}>
          {() => (
            <Segmented
              stretch
              value={expiry}
              onChange={setExpiry}
              options={[
                { value: 'never', label: t('never') },
                { value: '30', label: t('days30') },
                { value: '90', label: t('days90') },
                { value: '365', label: t('year') },
              ]}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}

function FreshTokenDialog({
  name,
  token,
  base,
  open,
  onClose,
}: {
  name: string
  token: string
  base: string
  open: boolean
  onClose: () => void
}) {
  const t = useT('developer')
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width={560}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('done')}
        </Button>
      }
    >
      <div className="flex flex-col items-center pt-3 text-center">
        <Signal tone="greenlit" size={44} />
        <div className="mt-5 t-title-2 text-ink">{t('createdTitle', { name })}</div>
        <p className="mt-1.5 t-callout text-ink-3">{t('createdBody')}</p>
      </div>
      <div className="mt-5 flex flex-col gap-2.5">
        <CopyBlock text={token} display={<span className="text-ink">{token}</span>} />
        <CopyBlock text={command(base, token)} />
      </div>
    </Dialog>
  )
}
