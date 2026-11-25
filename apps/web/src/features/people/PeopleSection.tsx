import type { User } from '@greenlit/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  KeyRound,
  LogOut,
  MoreHorizontal,
  Pencil,
  Power,
  Shield,
  Trash2,
  UserPlus,
  UserRound,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { SettingsGroup, SettingsSection } from '@/components/SettingsSection'
import { useUsers } from '@/data/people'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { stagger } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useSession } from '@/lib/session'
import { formatRelative, useTimeZone } from '@/lib/time'
import {
  Avatar,
  Badge,
  Button,
  confirm,
  EmptyState,
  IconButton,
  Menu,
  type MenuEntry,
  Skeleton,
  toast,
  useContextMenu,
} from '@/ui'
import { CredentialsDialog, PersonDialog, signInNames } from './PersonDialog'

export default function PeopleSection() {
  const t = useT('people')
  const { data: users, isLoading } = useUsers()
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; user: User; focusPassword?: boolean } | null
  >(null)
  const [creds, setCreds] = useState<{
    name: string
    username: string | null
    email: string | null
    password: string
    created: boolean
  } | null>(null)
  const admins = (users ?? []).filter((u) => u.role === 'admin')
  const reviewers = (users ?? []).filter((u) => u.role === 'reviewer')

  return (
    <SettingsSection
      title={t('section')}
      description={t('description')}
      actions={
        <Button variant="primary" icon={UserPlus} onClick={() => setDialog({ mode: 'add' })}>
          {t('add')}
        </Button>
      }
    >
      {isLoading ? (
        <Skeleton className="h-48 rounded-panel" />
      ) : (
        <>
          <PeopleGroup
            title={t('admins')}
            users={admins}
            onEdit={(u, focusPassword) => setDialog({ mode: 'edit', user: u, focusPassword })}
          />
          {reviewers.length ? (
            <PeopleGroup
              title={t('reviewers')}
              users={reviewers}
              onEdit={(u, focusPassword) => setDialog({ mode: 'edit', user: u, focusPassword })}
            />
          ) : (
            <SettingsGroup title={t('reviewers')} bare>
              <div className="rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
                <EmptyState
                  compact
                  icon={UserRound}
                  title={t('empty')}
                  body={t('emptyBody')}
                  action={
                    <Button size="sm" icon={UserPlus} onClick={() => setDialog({ mode: 'add' })}>
                      {t('add')}
                    </Button>
                  }
                />
              </div>
            </SettingsGroup>
          )}
        </>
      )}

      {dialog && (
        <PersonDialog
          key={dialog.mode === 'edit' ? dialog.user.id : 'add'}
          user={dialog.mode === 'edit' ? dialog.user : null}
          focusPassword={dialog.mode === 'edit' && dialog.focusPassword}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onDone={(result) => {
            setDialog(null)
            if (result.password)
              setCreds({
                name: result.user.displayName,
                username: result.user.username,
                email: result.user.email,
                password: result.password,
                created: result.created,
              })
          }}
        />
      )}
      {creds && <CredentialsDialog {...creds} onClose={() => setCreds(null)} />}
    </SettingsSection>
  )
}

function PeopleGroup({
  title,
  users,
  onEdit,
}: {
  title: string
  users: User[]
  onEdit: (u: User, focusPassword?: boolean) => void
}) {
  return (
    <SettingsGroup title={title} aside={<span className="t-meta text-ink-3">{users.length}</span>}>
      {users.map((u, i) => (
        <PersonRow key={u.id} user={u} index={i} onEdit={onEdit} />
      ))}
    </SettingsGroup>
  )
}

function PersonRow({
  user,
  index,
  onEdit,
}: {
  user: User
  index: number
  onEdit: (u: User, focusPassword?: boolean) => void
}) {
  const t = useT('people')
  const me = useSession()
  const tz = useTimeZone()
  const qc = useQueryClient()
  const isMe = user.id === me.id
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.users })
    void qc.invalidateQueries({ queryKey: qk.directory })
  }
  const update = useMutation({
    mutationFn: (patch: Partial<User>) => api.patch<User>(`/users/${user.id}`, patch),
    onSuccess: refresh,
    onError: (err) => toast.error(err),
  })

  const items = (): MenuEntry[] => [
    { label: t('edit'), icon: Pencil, onSelect: () => onEdit(user) },
    !isMe && {
      label: user.role === 'admin' ? t('makeReviewer') : t('makeAdmin'),
      icon: user.role === 'admin' ? UserRound : Shield,
      onSelect: () => {
        const role = user.role === 'admin' ? 'reviewer' : 'admin'
        update.mutate(
          { role },
          {
            onSuccess: () =>
              toast.done(
                t('roleChanged', { name: user.displayName, role: t(`common:role.${role}`).toLowerCase() }),
              ),
          },
        )
      },
    },
    { label: t('resetPassword'), icon: KeyRound, onSelect: () => onEdit(user, true) },
    'separator',
    !isMe && {
      label: t('signOutEverywhere'),
      icon: LogOut,
      onSelect: async () => {
        try {
          await api.post(`/users/${user.id}/sign-out`)
          toast.done(t('signedOut', { name: user.displayName }))
        } catch (err) {
          toast.error(err)
        }
      },
    },
    !isMe && {
      label: user.disabled ? t('turnOn') : t('turnOff'),
      icon: Power,
      onSelect: () =>
        update.mutate(
          { disabled: !user.disabled },
          {
            onSuccess: () =>
              toast.done(t(user.disabled ? 'turnedOn' : 'turnedOff', { name: user.displayName })),
          },
        ),
    },
    !isMe && 'separator',
    !isMe && {
      label: t('delete'),
      icon: Trash2,
      danger: true,
      onSelect: async () => {
        if (
          !(await confirm({
            title: t('deleteConfirm', { name: user.displayName }),
            body: t('deleteBody'),
            confirm: t('delete'),
            danger: true,
          }))
        )
          return
        try {
          await api.delete(`/users/${user.id}`)
          refresh()
          toast.done(t('deleted', { name: user.displayName }))
        } catch (err) {
          toast.error(err)
        }
      },
    },
  ]
  const menu = useContextMenu(items)

  return (
    <motion.div
      {...stagger(index)}
      {...menu}
      onDoubleClick={() => onEdit(user)}
      className={cn(
        'group -mx-4 flex min-h-16 items-center gap-3.5 px-4 py-2.5 transition-colors hover-device:hover:bg-[color-mix(in_oklab,var(--hover),transparent_40%)]',
        user.disabled && 'opacity-55',
      )}
    >
      <Avatar user={user} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate t-callout font-[550] text-ink">{user.displayName}</span>
          {isMe && <Badge>{t('you')}</Badge>}
          {user.disabled && <Badge tone="cut">{t('disabled')}</Badge>}
        </div>
        <div className="truncate t-caption text-ink-3">{signInNames(user)}</div>
      </div>
      <div className="hidden w-36 shrink-0 text-right t-caption text-ink-3 sm:block">
        {user.lastSeenAt ? t('seen', { when: formatRelative(user.lastSeenAt, tz) }) : t('neverSeen')}
      </div>
      <span className="hidden w-10 shrink-0 text-right t-meta text-ink-4 md:block">
        {user.locale.toUpperCase()}
      </span>
      <Menu
        align="end"
        trigger={<IconButton icon={MoreHorizontal} label={t('common:more')} size="sm" />}
        items={items()}
      />
    </motion.div>
  )
}
