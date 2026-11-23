import { platformKeepsSchedule } from '@greenlit/shared'
import { CloudOff, OctagonAlert, ServerCog, Zap } from 'lucide-react'
import { useState } from 'react'
import { PlatformIcon } from '@/components/PlatformIcon'
import { errorMessage } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { formatDateTime, useTimeZone, zoneLabel } from '@/lib/time'
import { Button, Dialog, toast } from '@/ui'
import { publishPost } from '../api'
import { useWhere } from '../parts'
import { useComposer } from './state'

/**
 * The last step before anything leaves Greenlit: every version that will go, where, and when — and who keeps the
 * schedule. Problems found by the checks block it.
 */
export function PublishDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT('posts')
  const where = useWhere()
  const tz = useTimeZone()
  const c = useComposer()
  const [busy, setBusy] = useState(false)
  const ready = c.post.targets.filter((x) => x.enabled && (x.state === 'draft' || x.state === 'failed'))
  const draftOf = (id: string) => c.draft.targets.find((d) => d.id === id)
  const blocked = ready.some((x) =>
    (c.checks.find((k) => k.targetId === x.id)?.issues ?? []).some((i) => i.level === 'error'),
  )
  const timed = ready.filter((x) => {
    const at = draftOf(x.id)?.scheduleAt ?? x.scheduleAt
    return at && new Date(at).getTime() > Date.now() + 60_000
  })
  const label =
    timed.length === 0
      ? t('publish.confirmNow', { count: ready.length })
      : timed.length === ready.length
        ? t('publish.confirmSchedule', { count: ready.length })
        : t('publish.confirmMixed', { count: ready.length })

  const go = async () => {
    setBusy(true)
    try {
      await c.save()
      await publishPost(
        c.post.id,
        ready.map((x) => x.id),
      )
      toast.done(
        timed.length === ready.length
          ? t('publish.scheduled', { count: ready.length })
          : t('publish.started', { count: ready.length }),
      )
      onOpenChange(false)
    } catch (e) {
      toast.error(e, errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={520}
      title={timed.length === ready.length && ready.length ? t('publish.scheduleTitle') : t('publish.title')}
      description={t('publish.body')}
      footer={
        <>
          <span className="mr-auto t-caption text-ink-3">{t('publish.public')}</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" disabled={!ready.length || blocked} loading={busy} onClick={go}>
            {blocked ? t('publish.blocked') : label}
          </Button>
        </>
      }
    >
      {!ready.length ? (
        <p className="t-callout text-ink-3">{t('publish.nothing')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ready.map((x) => {
            const a = c.accounts.find((acc) => acc.id === x.accountId)
            const at = draftOf(x.id)?.scheduleAt ?? x.scheduleAt
            const future = at && new Date(at).getTime() > Date.now() + 60_000
            const keeps =
              a && future ? platformKeepsSchedule(a.capabilities, x.placement, new Date(at!)) : null
            const errors = (c.checks.find((k) => k.targetId === x.id)?.issues ?? []).filter(
              (i) => i.level === 'error',
            )
            return (
              <li key={x.id} className="rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
                <div className="flex items-center gap-3">
                  <PlatformIcon platform={x.platform} size={26} tile />
                  <div className="min-w-0 flex-1">
                    <div className="truncate t-callout font-[550] text-ink">
                      {where(x.platform, x.placement)}
                    </div>
                    <div className="truncate t-caption text-ink-3">{a?.name}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    {future ? (
                      <>
                        <div className="t-meta text-ink">{formatDateTime(at!, tz)}</div>
                        <div className="t-meta text-ink-4">{zoneLabel(tz, at!)}</div>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 t-callout font-[550] text-signal">
                        <Zap size={13} /> {t('publish.now')}
                      </span>
                    )}
                  </div>
                </div>
                {keeps !== null && (
                  <div className="mt-2 flex items-center gap-2 t-caption text-ink-3">
                    {keeps ? (
                      <CloudOff size={13} className="text-cue" />
                    ) : (
                      <ServerCog size={13} className="text-review" />
                    )}
                    {keeps
                      ? t('composer.keepsSchedule', { where: where(x.platform) })
                      : t('composer.greenlitHolds')}
                  </div>
                )}
                {errors.map((e) => (
                  <div key={e.code + e.message} className="mt-2 flex items-start gap-2 t-caption text-cut">
                    <OctagonAlert size={13} className="mt-px shrink-0" />
                    {e.message}
                  </div>
                ))}
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
