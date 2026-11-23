import type { Platform } from '@greenlit/shared'
import { ArrowLeft, ChevronRight, KeyRound, QrCode } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { PLATFORM_NAME, PlatformIcon } from '@/components/PlatformIcon'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { ease, stagger } from '@/lib/motion'
import { Badge, Button, Dialog, Field, Select, Skeleton, Textarea, toast } from '@/ui'
import { accountsApi, type PlatformInfo, usePlatforms, useRefreshAccounts } from './api'
import { RemoteWindow } from './RemoteWindow'

const ORDER: Platform[] = ['instagram', 'facebook', 'tiktok', 'youtube']
/** The connector to suggest first for each platform. */
const PREFERRED: Record<Platform, string> = {
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  youtube: 'youtube',
}

type Step =
  | { kind: 'pick' }
  | { kind: 'driver'; platform: Platform }
  | { kind: 'remote'; info: PlatformInfo; accountId: string | null }
  | { kind: 'cookies'; platform: Platform; driver: string | null; accountId: string | null }

/** Connect an account: pick the platform (and the connector), then sign in on the platform's own page. */
export function ConnectDialog({
  initial,
  onClose,
}: {
  initial: { platform?: Platform; driver?: string; accountId?: string }
  onClose: () => void
}) {
  const t = useT('connectors')
  const { data: platforms } = usePlatforms()
  const refresh = useRefreshAccounts()
  const [step, setStep] = useState<Step | null>(initial.platform ? null : { kind: 'pick' })

  // A sign-in again (or a platform chosen elsewhere) goes straight to its window once the platforms are known.
  const resolved: Step = useMemo(() => {
    if (step) return step
    const info = platforms?.find(
      (p) => p.platform === initial.platform && (!initial.driver || p.driver === initial.driver),
    )
    if (info) return { kind: 'remote', info, accountId: initial.accountId ?? null }
    if (initial.platform && initial.driver?.endsWith('-app'))
      return { kind: 'cookies', platform: initial.platform, driver: null, accountId: null }
    return { kind: 'pick' }
  }, [step, platforms, initial])

  const choose = (platform: Platform) => {
    const drivers = (platforms ?? []).filter((p) => p.platform === platform)
    if (drivers.length === 1) setStep({ kind: 'remote', info: drivers[0]!, accountId: null })
    else setStep({ kind: 'driver', platform })
  }
  const wide = resolved.kind === 'remote'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} width={wide ? 1180 : 560} bare>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={
            resolved.kind +
            ('platform' in resolved ? resolved.platform : '') +
            (resolved.kind === 'remote' ? resolved.info.driver : '')
          }
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.22, ease }}
        >
          {resolved.kind === 'pick' && (
            <div className="p-6">
              <div className="t-title-2 text-ink">{t('dialog.pickTitle')}</div>
              <p className="mt-1.5 t-callout text-ink-3">{t('dialog.pickBody')}</p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {!platforms
                  ? ORDER.map((p) => <Skeleton key={p} className="h-28 rounded-panel" />)
                  : ORDER.filter((p) => platforms.some((x) => x.platform === p)).map((p, i) => (
                      <motion.button
                        key={p}
                        {...stagger(i, 0.04)}
                        type="button"
                        onClick={() => choose(p)}
                        className="press group flex flex-col items-start gap-5 rounded-panel bg-well p-4 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
                      >
                        <PlatformIcon platform={p} size={34} tile />
                        <span className="flex w-full items-center justify-between">
                          <span className="t-headline text-ink">{PLATFORM_NAME[p]}</span>
                          <ChevronRight
                            size={16}
                            className="text-ink-4 transition-transform duration-150 group-hover:translate-x-0.5"
                          />
                        </span>
                      </motion.button>
                    ))}
              </div>
            </div>
          )}

          {resolved.kind === 'driver' && (
            <div className="p-6">
              <button
                type="button"
                onClick={() => setStep({ kind: 'pick' })}
                className="press -ml-1 mb-3 inline-flex items-center gap-1 t-callout text-ink-3 hover:text-ink"
              >
                <ArrowLeft size={15} />
                {t('dialog.back')}
              </button>
              <div className="flex items-center gap-3">
                <PlatformIcon platform={resolved.platform} size={30} tile />
                <div className="t-title-2 text-ink">{t('dialog.how')}</div>
              </div>
              <div className="mt-5 flex flex-col gap-2.5">
                {(platforms ?? [])
                  .filter((p) => p.platform === resolved.platform)
                  .sort(
                    (a, b) =>
                      Number(b.driver === PREFERRED[resolved.platform]) -
                      Number(a.driver === PREFERRED[resolved.platform]),
                  )
                  .map((info, i) => (
                    <motion.button
                      key={info.driver}
                      {...stagger(i, 0.04)}
                      type="button"
                      onClick={() => setStep({ kind: 'remote', info, accountId: null })}
                      className="press group flex items-center gap-4 rounded-panel bg-well p-4 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-hover text-ink-2">
                        {info.signIn.method === 'qr' ? <QrCode size={17} /> : <KeyRound size={17} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="t-callout font-[550] text-ink">{info.driverName}</span>
                          {info.driver === PREFERRED[resolved.platform] && (
                            <Badge tone="signal">{t('dialog.recommended')}</Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block t-caption text-ink-3">
                          {t(`drivers.${info.driver}`, { defaultValue: '' })}
                        </span>
                        <span className="mt-1 block t-meta text-ink-4">
                          {info.signIn.method === 'qr'
                            ? t('dialog.qr')
                            : t('dialog.password', { host: info.signIn.host })}
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-ink-4" />
                    </motion.button>
                  ))}
              </div>
            </div>
          )}

          {resolved.kind === 'remote' && (
            <RemoteWindow
              platform={resolved.info.platform}
              driver={resolved.info.driver}
              accountId={resolved.accountId}
              host={resolved.info.signIn.host}
              qr={resolved.info.signIn.method === 'qr'}
              onConnected={() => {
                void refresh()
                onClose()
              }}
              onCookies={() =>
                setStep({
                  kind: 'cookies',
                  platform: resolved.info.platform,
                  driver: resolved.info.driver,
                  accountId: resolved.accountId,
                })
              }
              onClose={onClose}
            />
          )}

          {resolved.kind === 'cookies' && (
            <CookieImport
              initial={resolved}
              platforms={platforms ?? []}
              onBack={() => setStep({ kind: 'pick' })}
              onDone={(n) => {
                toast.done(t('cookies.done', { count: n }))
                void refresh()
                onClose()
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </Dialog>
  )
}

function CookieImport({
  initial,
  platforms,
  onBack,
  onDone,
}: {
  initial: { platform: Platform; driver: string | null; accountId: string | null }
  platforms: PlatformInfo[]
  onBack: () => void
  onDone: (count: number) => void
}) {
  const t = useT('connectors')
  const [platform, setPlatform] = useState<Platform>(initial.platform)
  const [driver, setDriver] = useState<string | null>(initial.driver)
  const [cookies, setCookies] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drivers = platforms.filter((p) => p.platform === platform)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const accounts = await accountsApi.cookies({ platform, driver, accountId: initial.accountId, cookies })
      onDone(accounts.length)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="p-6">
      <button
        type="button"
        onClick={onBack}
        className="press -ml-1 mb-3 inline-flex items-center gap-1 t-callout text-ink-3 hover:text-ink"
      >
        <ArrowLeft size={15} />
        {t('dialog.back')}
      </button>
      <div className="t-title-2 text-ink">{t('cookies.title')}</div>
      <p className="mt-1.5 t-callout text-ink-3">{t('cookies.body')}</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Field label={t('cookies.platform')}>
          {(id) => (
            <Select
              id={id}
              value={platform}
              onChange={(p) => {
                setPlatform(p)
                setDriver(platforms.find((x) => x.platform === p)?.driver ?? null)
              }}
              options={ORDER.map((p) => ({
                value: p,
                label: PLATFORM_NAME[p],
                icon: <PlatformIcon platform={p} size={14} />,
              }))}
            />
          )}
        </Field>
        <Field label={t('cookies.connector')}>
          {(id) => (
            <Select
              id={id}
              value={driver ?? drivers[0]?.driver ?? null}
              onChange={setDriver}
              options={drivers.map((d) => ({ value: d.driver, label: d.driverName }))}
            />
          )}
        </Field>
      </div>
      <Field label={t('cookies.field')} className="mt-4" error={error}>
        {(id) => (
          <Textarea
            id={id}
            rows={7}
            maxRows={12}
            spellCheck={false}
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            placeholder={t('cookies.placeholder')}
            className={cn('t-meta text-[12px] leading-[1.55]')}
          />
        )}
      </Field>
      <div className="mt-5 flex justify-end">
        <Button
          variant="primary"
          disabled={cookies.trim().length < 10}
          loading={busy}
          onClick={() => void submit()}
        >
          {t('cookies.submit')}
        </Button>
      </div>
    </div>
  )
}
