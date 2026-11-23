import type { ShareLink } from '@greenlit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, FolderOpen, Image as ImageIcon, Link2, Send } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { SettingsGroup, SettingsSection } from '@/components/SettingsSection'
import { api, errorMessage } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { formatRelative, useTimeZone } from '@/lib/time'
import { Avatar, Button, confirm, EmptyState, Segmented, Skeleton, Tally, toast } from '@/ui'

const ICON = { post: Send, media: ImageIcon, project: FolderOpen, calendar: CalendarDays }
const HREF = (l: ShareLink) =>
  l.targetType === 'calendar'
    ? '/calendar'
    : l.targetType === 'post'
      ? `/posts/${l.targetId}`
      : l.targetType === 'media'
        ? `/media/${l.targetId}`
        : `/projects/${l.targetId}`

function stateOf(l: ShareLink): 'open' | 'used' | 'expired' {
  if (l.usedAt) return 'used'
  if (new Date(l.expiresAt).getTime() < Date.now()) return 'expired'
  return 'open'
}

/** Settings → Share links: who can still open what, and revoke. */
export default function ShareLinksSection() {
  const t = useT('share')
  const tz = useTimeZone()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const { data, isLoading } = useQuery({
    queryKey: qk.shareLinks,
    queryFn: () => api.get<ShareLink[]>('/share-links'),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/share-links/${id}`),
    onSuccess: () => {
      toast.done(t('list.revoked'))
      void qc.invalidateQueries({ queryKey: qk.shareLinks })
    },
    onError: (e) => toast.error(e, errorMessage(e)),
  })
  const shown = (data ?? []).filter((l) => filter === 'all' || stateOf(l) === 'open')

  return (
    <SettingsSection title={t('section')} description={t('description')}>
      <SettingsGroup
        bare
        aside={
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: t('list.filterOpen') },
              { value: 'all', label: t('list.filterAll') },
            ]}
          />
        }
      >
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 rounded-panel" />
            ))}
          </div>
        ) : !shown.length ? (
          <EmptyState compact icon={Link2} title={t('list.empty')} body={t('list.emptyBody')} />
        ) : (
          <div className="overflow-hidden rounded-panel bg-panel shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)]">
            <AnimatePresence initial={false}>
              {shown.map((l, i) => {
                const s = stateOf(l)
                const Icon = ICON[l.targetType]
                return (
                  <motion.div
                    key={l.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, height: 0 }}
                    className={i > 0 ? 'border-t border-line' : undefined}
                  >
                    <div className="flex items-center gap-3.5 px-4 py-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-hover text-ink-2 shadow-[inset_0_0_0_.5px_var(--line)]">
                        <Icon size={16} strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          to={HREF(l)}
                          className="block truncate t-callout font-[550] text-ink hover:underline"
                        >
                          {l.targetTitle || t(`type.${l.targetType}`)}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 t-caption text-ink-3">
                          <Avatar user={l.user} size={16} />
                          <span className="truncate">{l.user.displayName}</span>
                          <span className="text-ink-4">·</span>
                          <span className="truncate">{t('list.by', { name: l.createdBy.displayName })}</span>
                        </div>
                      </div>
                      <div className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
                        <span className="inline-flex items-center gap-1.5 t-caption text-ink-2">
                          <Tally
                            tone={s === 'open' ? 'greenlit' : s === 'used' ? 'draft' : 'changes'}
                            size={6}
                          />
                          {t(`list.${s}`)}
                        </span>
                        <span className="t-meta text-ink-4">
                          {s === 'used'
                            ? t('list.usedAt', { when: formatRelative(l.usedAt!, tz) })
                            : s === 'expired'
                              ? t('list.expiredAt', { when: formatRelative(l.expiresAt, tz) })
                              : t('list.expires', { when: formatRelative(l.expiresAt, tz) })}
                        </span>
                      </div>
                      {s === 'open' && (
                        <Button
                          size="sm"
                          variant="danger-ghost"
                          onClick={async () => {
                            const ok = await confirm({
                              title: t('list.revokeConfirm', { who: l.user.displayName }),
                              body: t('list.revokeBody'),
                              confirm: t('list.revoke'),
                              danger: true,
                            })
                            if (ok) revoke.mutate(l.id)
                          }}
                        >
                          {t('list.revoke')}
                        </Button>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </SettingsGroup>
    </SettingsSection>
  )
}
