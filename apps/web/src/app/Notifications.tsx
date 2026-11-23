import type { Notification } from '@greenlit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useTopic } from '@/lib/realtime'
import { useSession } from '@/lib/session'
import { formatRelative, useTimeZone } from '@/lib/time'
import { Avatar, Button, EmptyState, IconButton, Popover, toast } from '@/ui'

type Inbox = { items: Notification[]; unread: number }

export function useNotifications() {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<Inbox>('/notifications', { limit: 40 }),
  })
}

/** The bell: a dot when something is unread, a popover with the latest. New ones also arrive as a toast. */
export function NotificationsButton() {
  const t = useT()
  const me = useSession()
  const qc = useQueryClient()
  const tz = useTimeZone()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { data } = useNotifications()
  useTopic<{ id: string; title?: string }>(`user:${me.id}`, (msg) => {
    if (msg.event.startsWith('notification')) void qc.invalidateQueries({ queryKey: qk.notifications })
    if (msg.event === 'notification.created') {
      void api.get<Inbox>('/notifications', { limit: 1 }).then((r) => {
        const n = r.items[0]
        if (n && !open)
          toast.info(n.title, {
            description: n.body || undefined,
            action: n.link ? { label: t('open'), onClick: () => navigate(n.link!) } : undefined,
          })
      })
    }
  })
  const read = useMutation({
    mutationFn: (ids?: string[]) => api.post('/notifications/read', ids ? { ids } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  })
  const unread = data?.unread ?? 0

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={380}
      trigger={
        <IconButton
          icon={Bell}
          label={t('shell.notifications')}
          tooltip={!open}
          badge={
            <AnimatePresence>
              {unread > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute top-1.5 right-1.5 size-2 rounded-full bg-signal shadow-[0_0_0_2px_var(--canvas),0_0_8px_var(--signal)]"
                />
              )}
            </AnimatePresence>
          }
        />
      }
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="t-headline text-ink">{t('shell.notifications')}</div>
        {unread > 0 && (
          <Button size="xs" variant="ghost" icon={CheckCheck} onClick={() => read.mutate(undefined)}>
            {t('shell.markAllRead')}
          </Button>
        )}
      </div>
      <div className="max-h-[min(70dvh,520px)] overflow-y-auto px-1.5 pb-1.5">
        {!data?.items.length ? (
          <EmptyState compact icon={Bell} title={t('shell.nothingNew')} body={t('shell.nothingNewBody')} />
        ) : (
          data.items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (!n.readAt) read.mutate([n.id])
                setOpen(false)
                if (n.link) navigate(n.link)
              }}
              className="press flex w-full items-start gap-3 rounded-[9px] px-2.5 py-2.5 text-left hover:bg-hover"
            >
              <span className="relative mt-0.5">
                <Avatar user={n.actor} size={28} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block t-callout', n.readAt ? 'text-ink-2' : 'font-[550] text-ink')}>
                  {n.title}
                </span>
                {n.body && <span className="mt-0.5 line-clamp-2 block t-caption text-ink-3">{n.body}</span>}
                <span className="mt-1 block t-meta text-ink-4">{formatRelative(n.createdAt, tz)}</span>
              </span>
              {!n.readAt && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" />}
            </button>
          ))
        )}
      </div>
    </Popover>
  )
}
