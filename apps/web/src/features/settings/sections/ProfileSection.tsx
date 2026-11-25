import type { Me } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { AutosaveInput, SettingsGroup, SettingsRow, SettingsSection } from '@/components/SettingsSection'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useFileDrop } from '@/lib/dom'
import { setLanguage, useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useConfig, useSession } from '@/lib/session'
import { type ModePreference, setModePreference, useMode } from '@/lib/theme'
import { Avatar, Badge, Button, Input, Segmented, Spinner, toast } from '@/ui'

export default function ProfileSection() {
  const t = useT('settings')
  const me = useSession()
  const qc = useQueryClient()
  const save = async (patch: Record<string, unknown>) => {
    const next = await api.patch<Me>('/me', patch)
    qc.setQueryData(qk.me, next)
    void qc.invalidateQueries({ queryKey: qk.directory })
    return next
  }

  if (me.viaShareLink)
    return (
      <SettingsSection title={t('profile.section')}>
        <p className="max-w-[60ch] t-body text-ink-3">{t('profile.shareSession')}</p>
      </SettingsSection>
    )

  return (
    <SettingsSection title={t('profile.section')} description={t('profile.description')}>
      <PictureCard />
      <SettingsGroup>
        <SettingsRow label={t('profile.name')} description={t('profile.nameHint')} htmlFor="pf-name">
          <AutosaveInput
            id="pf-name"
            value={me.displayName}
            required
            maxLength={80}
            onSave={(displayName) => save({ displayName })}
          />
        </SettingsRow>
        {me.username && (
          <SettingsRow inline label={t('profile.username')} description={t('profile.usernameHint')}>
            <span className="t-callout text-ink-2">{me.username}</span>
          </SettingsRow>
        )}
        {me.email && (
          <SettingsRow inline label={t('profile.email')} description={t('profile.emailHint')}>
            <span className="t-callout text-ink-2">{me.email}</span>
          </SettingsRow>
        )}
        <SettingsRow inline label={t('profile.role')}>
          <Badge tone={me.role === 'admin' ? 'signal' : 'neutral'}>{t(`common:role.${me.role}`)}</Badge>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow label={t('profile.language')} description={t('profile.languageHint')}>
          <Segmented
            value={me.locale}
            onChange={(locale) => {
              setLanguage(locale)
              void save({ locale }).catch((err) => toast.error(err))
            }}
            options={[
              { value: 'en', label: 'English' },
              { value: 'it', label: 'Italiano' },
            ]}
          />
        </SettingsRow>
        <AppearanceRow />
      </SettingsGroup>

      <PasswordCard />
    </SettingsSection>
  )
}

function PictureCard() {
  const t = useT('settings')
  const me = useSession()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    setBusy(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const next = await api.form<Me>('/me/avatar', form)
      qc.setQueryData(qk.me, next)
      void qc.invalidateQueries({ queryKey: qk.directory })
      toast.done(t('profile.pictureSaved'))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }
  const over = useFileDrop((files) => files[0] && void uploadFile(files[0]), { target: zone })
  const remove = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/me/avatar', { method: 'DELETE', credentials: 'include' })
      if (res.ok) qc.setQueryData(qk.me, (await res.json()) as Me)
      toast.done(t('profile.pictureRemoved'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      ref={zone}
      className={cn(
        'flex items-center gap-5 rounded-panel bg-panel p-5 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)] transition-shadow duration-200',
        over && 'shadow-[inset_0_0_0_2px_var(--signal),0_0_0_4px_var(--signal-soft)]',
      )}
    >
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="press group relative shrink-0 rounded-full"
        aria-label={t('profile.change')}
      >
        <Avatar user={me} size={72} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover:opacity-100">
          {busy ? <Spinner size={18} /> : <Camera size={18} strokeWidth={1.8} />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="t-headline text-ink">{me.displayName}</div>
        <div className="mt-0.5 t-caption text-ink-3">{t('profile.pictureHint')}</div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" icon={Camera} onClick={() => input.current?.click()} loading={busy}>
            {t('profile.change')}
          </Button>
          {me.avatarUrl && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove()} disabled={busy}>
              {t('profile.remove')}
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void uploadFile(f)
        }}
      />
    </div>
  )
}

function AppearanceRow() {
  const t = useT('settings')
  const { data: config } = useConfig()
  const { preference } = useMode(config?.theme.defaultMode)
  const theme = config?.theme
  const options: { value: ModePreference; label: string }[] = [
    { value: 'system', label: t('profile.system') },
    { value: 'light', label: t('profile.light') },
    { value: 'dark', label: t('profile.dark') },
  ]
  return (
    <SettingsRow label={t('profile.appearance')} description={t('profile.appearanceHint')} stack>
      <div className="grid w-full grid-cols-3 gap-3 pb-1 sm:max-w-[460px]">
        {options.map((o) => {
          const active = preference === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setModePreference(o.value)}
              className="press group flex flex-col items-center gap-2"
              aria-pressed={active}
            >
              <span
                className={cn(
                  'relative block aspect-[16/10] w-full overflow-hidden rounded-tile transition-shadow duration-150',
                  active
                    ? 'shadow-[0_0_0_2px_var(--signal)]'
                    : 'shadow-[0_0_0_1px_var(--line-strong)] group-hover:shadow-[0_0_0_1px_var(--ink-3)]',
                )}
              >
                {o.value === 'system' ? (
                  <>
                    <ModeSwatch
                      palette={theme?.light}
                      className="absolute inset-0 [clip-path:polygon(0_0,100%_0,0_100%)]"
                    />
                    <ModeSwatch
                      palette={theme?.dark}
                      className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]"
                    />
                  </>
                ) : (
                  <ModeSwatch
                    palette={o.value === 'light' ? theme?.light : theme?.dark}
                    className="absolute inset-0"
                  />
                )}
              </span>
              <span className={cn('t-caption', active ? 'font-[550] text-ink' : 'text-ink-3')}>
                {o.label}
              </span>
            </button>
          )
        })}
      </div>
    </SettingsRow>
  )
}

/** A tiny picture of a window in one mode: bar, a few tiles, the lamp. */
function ModeSwatch({
  palette,
  className,
}: {
  palette?: { bg: string; surface: string; text: string; accent: string; border: string }
  className?: string
}) {
  if (!palette) return <span className={className} />
  return (
    <span className={cn('block', className)} style={{ background: palette.bg }}>
      <span
        className="absolute inset-x-0 top-0 flex h-[18%] items-center gap-[4%] px-[7%]"
        style={{ borderBottom: `1px solid ${palette.border}` }}
      >
        <span className="size-[7px] rounded-full" style={{ background: palette.accent }} />
        <span className="h-[3px] w-[22%] rounded-full opacity-60" style={{ background: palette.text }} />
      </span>
      <span className="absolute inset-x-[7%] top-[28%] bottom-[12%] grid grid-cols-3 gap-[6%]">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="rounded-[3px]"
            style={{ background: palette.surface, boxShadow: `inset 0 0 0 1px ${palette.border}` }}
          />
        ))}
      </span>
    </span>
  )
}

function PasswordCard() {
  const t = useT('settings')
  const qc = useQueryClient()
  const [form, setForm] = useState({ current: '', next: '', again: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem =
    form.next && form.next.length < 8
      ? t('profile.tooShort')
      : form.again && form.again !== form.next
        ? t('profile.mismatch')
        : null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.patch<Me>('/me', { currentPassword: form.current, newPassword: form.next })
      qc.setQueryData(qk.me, next)
      setForm({ current: '', next: '', again: '' })
      toast.done(t('profile.passwordChanged'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsGroup title={t('profile.password')} description={t('profile.passwordHint')}>
      <form onSubmit={submit} className="grid gap-3 py-4 sm:grid-cols-3">
        <input type="text" autoComplete="username" hidden readOnly />
        <Input
          type="password"
          autoComplete="current-password"
          placeholder={t('profile.current')}
          aria-label={t('profile.current')}
          value={form.current}
          onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))}
        />
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={t('profile.new')}
          aria-label={t('profile.new')}
          value={form.next}
          onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))}
          invalid={!!form.next && form.next.length < 8}
        />
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={t('profile.confirm')}
          aria-label={t('profile.confirm')}
          value={form.again}
          onChange={(e) => setForm((f) => ({ ...f, again: e.target.value }))}
          invalid={!!form.again && form.again !== form.next}
        />
        <div className="flex items-center gap-3 sm:col-span-3">
          <span className="min-w-0 flex-1 t-caption text-cut">{error ?? problem}</span>
          <Button
            type="submit"
            size="sm"
            disabled={!form.current || !form.next || form.again !== form.next || !!problem}
            loading={busy}
          >
            {t('profile.changePassword')}
          </Button>
        </div>
      </form>
    </SettingsGroup>
  )
}
