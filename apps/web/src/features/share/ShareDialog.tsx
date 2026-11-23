import type { ShareLink } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { PeoplePicker } from '@/components/PeoplePicker'
import { useDirectory } from '@/data/people'
import { api, errorMessage } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { qk } from '@/lib/query'
import { formatDateTime, useTimeZone } from '@/lib/time'
import { Button, Dialog, Field, Segmented, Signal, toast } from '@/ui'
import { useShareDialog } from './store'

const DURATIONS = { day: 24, days3: 72, week: 168, month: 720 } as const
type Duration = keyof typeof DURATIONS

/**
 * Share link: choose who opens it and for how long; the link signs them in, opens the item and burns itself.
 * The URL is shown once.
 */
export function ShareDialogHost() {
  const t = useT('share')
  const tz = useTimeZone()
  const qc = useQueryClient()
  const { target, close } = useShareDialog()
  const { data: people = [] } = useDirectory()
  const [user, setUser] = useState<string[]>([])
  const [duration, setDuration] = useState<Duration>('days3')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<ShareLink | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!target) return
    setLink(null)
    setCopied(false)
    setBusy(false)
  }, [target])

  const who = people.find((p) => p.id === user[0])
  const what = target?.type === 'calendar' ? t('dialog.calendar') : `“${target?.title ?? ''}”`

  const create = async () => {
    if (!target || !user[0]) return
    setBusy(true)
    try {
      const r = await api.post<ShareLink>('/share-links', {
        userId: user[0],
        targetType: target.type,
        targetId: target.id,
        expiresInHours: DURATIONS[duration],
      })
      setLink(r)
      void qc.invalidateQueries({ queryKey: qk.shareLinks })
    } catch (e) {
      toast.error(e, errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!link?.url) return
    try {
      await navigator.clipboard.writeText(link.url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = link.url
      document.body.append(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && close()}
      width={460}
      title={link ? t('dialog.ready') : t('dialog.title', { what })}
      description={
        link ? undefined : who ? t('dialog.body', { who: who.displayName }) : t('dialog.bodyNobody')
      }
      footer={
        link ? (
          <Button variant="primary" onClick={close}>
            {t('dialog.done')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" icon={Link2} disabled={!user[0]} loading={busy} onClick={create}>
              {t('dialog.create')}
            </Button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {link ? (
          <motion.div
            key="ready"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease }}
            className="flex flex-col items-center text-center"
          >
            <Signal tone="greenlit" size={44} />
            <p className="mt-4 max-w-[40ch] t-callout text-ink-2">
              {t('dialog.readyBody', {
                who: link.user.displayName,
                when: formatDateTime(link.expiresAt, tz),
              })}
            </p>
            <div className="mt-5 flex w-full items-center gap-2 rounded-control bg-well p-1.5 pl-3 shadow-[inset_0_0_0_1px_var(--line)]">
              <span className="min-w-0 flex-1 truncate text-left t-meta text-ink">{link.url}</span>
              <Button
                size="sm"
                variant={copied ? 'secondary' : 'primary'}
                icon={copied ? Check : Copy}
                onClick={copy}
              >
                {copied ? t('dialog.copied') : t('dialog.copy')}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="flex flex-col gap-4"
          >
            <Field label={t('dialog.person')}>
              {() => (
                <PeoplePicker
                  value={user}
                  onChange={setUser}
                  multiple={false}
                  placeholder={t('dialog.personPlaceholder')}
                />
              )}
            </Field>
            <Field label={t('dialog.expires')}>
              {() => (
                <Segmented
                  stretch
                  value={duration}
                  onChange={setDuration}
                  options={(Object.keys(DURATIONS) as Duration[]).map((d) => ({
                    value: d,
                    label: t(`dialog.${d}`),
                  }))}
                />
              )}
            </Field>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
