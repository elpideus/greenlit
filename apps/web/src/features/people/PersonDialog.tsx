import type { User } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, RefreshCw, Shield, UserRound } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { CopyBlock } from '@/components/SettingsSection'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useSession } from '@/lib/session'
import { Avatar, Button, Dialog, Field, Input, Segmented, Signal, Toggle, toast } from '@/ui'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** A strong password that can be read out loud: three blocks of four. */
export function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-')
}

type Role = 'admin' | 'reviewer'

export function PersonDialog({
  user,
  open,
  onOpenChange,
  onDone,
  focusPassword,
}: {
  user: User | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: (r: { user: User; password: string | null; created: boolean }) => void
  focusPassword?: boolean
}) {
  const t = useT('people')
  const me = useSession()
  const qc = useQueryClient()
  const isMe = user?.id === me.id
  const [form, setForm] = useState({
    displayName: user?.displayName ?? '',
    email: user?.email ?? '',
    role: (user?.role ?? 'reviewer') as Role,
    locale: (user?.locale ?? 'it') as 'en' | 'it',
    disabled: user?.disabled ?? false,
  })
  const [pwMode, setPwMode] = useState<'generate' | 'type'>('generate')
  const [password, setPassword] = useState(user ? '' : generatePassword())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [avatar, setAvatar] = useState<string | null>(user?.avatarUrl ?? null)
  const pwRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusPassword) requestAnimationFrame(() => pwRef.current?.focus())
  }, [focusPassword])
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password && password.length < 8) return setError('Use at least 8 characters for the password.')
    setBusy(true)
    setError(null)
    try {
      let saved: User
      if (user) {
        const patch: Record<string, unknown> = {}
        if (form.displayName !== user.displayName) patch.displayName = form.displayName
        if (form.email !== user.email) patch.email = form.email
        if (form.role !== user.role) patch.role = form.role
        if (form.locale !== user.locale) patch.locale = form.locale
        if (form.disabled !== user.disabled) patch.disabled = form.disabled
        if (password) patch.password = password
        saved = Object.keys(patch).length ? await api.patch<User>(`/users/${user.id}`, patch) : user
      } else {
        saved = await api.post<User>('/users', { ...form, password })
      }
      void qc.invalidateQueries({ queryKey: qk.users })
      void qc.invalidateQueries({ queryKey: qk.directory })
      if (user && !password) toast.done(t('form.save'))
      onDone({ user: saved, password: password || null, created: !user })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    if (!user) return
    const fd = new FormData()
    fd.set('file', file)
    try {
      const next = await api.form<User>(`/users/${user.id}/avatar`, fd)
      setAvatar(next.avatarUrl)
      void qc.invalidateQueries({ queryKey: qk.users })
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={500}
      title={user ? t('form.editTitle', { name: user.displayName }) : t('form.addTitle')}
      description={user ? undefined : t('form.addBody')}
      footer={
        <>
          <span className="mr-auto t-caption text-cut">{error}</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="person-form"
            loading={busy}
            disabled={!form.displayName.trim() || !form.email.trim()}
          >
            {user ? t('form.save') : t('form.create')}
          </Button>
        </>
      }
    >
      <form id="person-form" onSubmit={submit} className="flex flex-col gap-5">
        {user && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="press group relative rounded-full"
              aria-label={t('form.change')}
            >
              <Avatar user={{ ...user, avatarUrl: avatar }} size={52} />
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Camera size={16} />
              </span>
            </button>
            <div className="t-caption text-ink-3">{user.email}</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void uploadAvatar(f)
              }}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('form.name')}>
            {(id) => (
              <Input
                id={id}
                value={form.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                required
                autoFocus={!user}
                maxLength={80}
              />
            )}
          </Field>
          <Field label={t('form.email')}>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                required
              />
            )}
          </Field>
        </div>

        <Field label={t('form.role')}>
          {() => (
            <div className="grid grid-cols-2 gap-2.5">
              {(['reviewer', 'admin'] as const).map((r) => {
                const on = form.role === r
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={isMe}
                    onClick={() => set('role', r)}
                    aria-pressed={on}
                    className={cn(
                      'press flex items-start gap-3 rounded-tile p-3 text-left transition-shadow duration-150 disabled:opacity-50',
                      on
                        ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--signal)]'
                        : 'bg-well shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
                    )}
                  >
                    <span className={cn('mt-0.5', on ? 'text-signal' : 'text-ink-3')}>
                      {r === 'admin' ? <Shield size={16} /> : <UserRound size={16} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block t-callout font-[550] text-ink">{t(`common:role.${r}`)}</span>
                      <span className="mt-0.5 block t-caption text-ink-3">
                        {t(r === 'admin' ? 'form.adminHint' : 'form.reviewerHint')}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Field>

        <Field label={t('form.language')}>
          {() => (
            <Segmented
              className="self-start"
              value={form.locale}
              onChange={(v) => set('locale', v)}
              options={[
                { value: 'it', label: 'Italiano' },
                { value: 'en', label: 'English' },
              ]}
            />
          )}
        </Field>

        {user ? (
          <Field label={t('form.newPassword')} hint={t('form.newPasswordHint')}>
            {(id) => (
              <Input
                ref={pwRef}
                id={id}
                type="text"
                autoComplete="new-password"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="t-meta"
                trailing={
                  <button
                    type="button"
                    className="press grid size-6 place-items-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink"
                    onClick={() => setPassword(generatePassword())}
                    aria-label={t('form.regenerate')}
                  >
                    <RefreshCw size={13} />
                  </button>
                }
              />
            )}
          </Field>
        ) : (
          <Field
            label={t('form.password')}
            aside={
              <Segmented
                size="sm"
                value={pwMode}
                onChange={(m) => {
                  setPwMode(m)
                  setPassword(m === 'generate' ? generatePassword() : '')
                }}
                options={[
                  { value: 'generate', label: t('form.generate') },
                  { value: 'type', label: t('form.type') },
                ]}
              />
            }
          >
            {(id) =>
              pwMode === 'generate' ? (
                <div className="flex items-center gap-2">
                  <div className="flex h-9 min-w-0 flex-1 items-center rounded-control bg-well px-3 t-meta text-[13px] tracking-[0.04em] text-ink shadow-[inset_0_0_0_1px_var(--line)]">
                    {password}
                  </div>
                  <Button icon={RefreshCw} onClick={() => setPassword(generatePassword())}>
                    {t('form.regenerate')}
                  </Button>
                </div>
              ) : (
                <Input
                  id={id}
                  type="text"
                  autoComplete="new-password"
                  spellCheck={false}
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="t-meta"
                />
              )
            }
          </Field>
        )}

        {user && !isMe && (
          <div className="flex items-center justify-between gap-4 rounded-tile bg-well px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
            <div>
              <div className="t-callout font-[550] text-ink">{t('form.accountOn')}</div>
              <div className="t-caption text-ink-3">{t('form.accountOnHint')}</div>
            </div>
            <Toggle checked={!form.disabled} onChange={(on) => set('disabled', !on)} />
          </div>
        )}
      </form>
    </Dialog>
  )
}

/** The sign-in details of a new person (or a new password), shown once, ready to send. */
export function CredentialsDialog({
  name,
  email,
  password,
  created,
  onClose,
}: {
  name: string
  email: string
  password: string
  created: boolean
  onClose: () => void
}) {
  const t = useT('people')
  const address = location.origin
  const all = `${address}\n${t('created.email')}: ${email}\n${t('created.password')}: ${password}`
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={460}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('created.done')}
        </Button>
      }
    >
      <div className="flex flex-col items-center pt-3 pb-2 text-center">
        <Signal tone="greenlit" size={44} />
        <div className="mt-5 t-title-2 text-ink">
          {created ? t('created.title', { name }) : t('passwordSet', { name })}
        </div>
        <p className="mt-2 max-w-[38ch] t-callout text-ink-3">
          {created ? t('created.body') : t('passwordSetBody')}
        </p>
      </div>
      <dl className="mt-4 overflow-hidden rounded-tile bg-well shadow-[inset_0_0_0_1px_var(--line)] [&>*+*]:border-t [&>*+*]:border-line">
        {[
          [t('created.address'), address],
          [t('created.email'), email],
          [t('created.password'), password],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center gap-4 px-3.5 py-2.5">
            <dt className="w-20 shrink-0 t-caption text-ink-3">{k}</dt>
            <dd className="min-w-0 flex-1 truncate t-meta text-[12.5px] text-ink select-all">{v}</dd>
          </div>
        ))}
      </dl>
      <CopyBlock
        text={all}
        display={t('created.copyAll')}
        label={t('common:copy')}
        className="mt-3 [&_code]:font-sans [&_code]:t-callout"
      />
    </Dialog>
  )
}
