import type { Me } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { api, errorMessage } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useConfig } from '@/lib/session'
import { zoneLabel } from '@/lib/time'
import { Button, Field, Input, Select } from '@/ui'
import { AuthFrame } from './AuthFrame'

export default function SetupPage() {
  const t = useT('auth')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: config } = useConfig()
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    appName: config?.branding.appName ?? 'Greenlit',
    timeZone: config?.platform.timeZone ?? browserTz,
    locale: (navigator.language.startsWith('it') ? 'it' : 'en') as 'en' | 'it',
    setupCode: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zones = useMemo(() => {
    const list = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [browserTz]
    return list.map((z) => ({ value: z, label: z.replace(/_/g, ' '), hint: zoneLabel(z) }))
  }, [browserTz])

  if (config && !config.setupRequired) return <Navigate to="/login" replace />
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/setup', { ...form, setupCode: form.setupCode || undefined })
      const me = await api.post<Me>('/auth/login', { email: form.email, password: form.password, remember: true })
      await qc.invalidateQueries({ queryKey: qk.config })
      qc.setQueryData(qk.me, me)
      navigate('/library', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <h1 className="t-title-1 text-ink">{t('setup.title', { name: form.appName || 'Greenlit' })}</h1>
      <p className="mt-2 t-body text-ink-3">{t('setup.body')}</p>
      <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('setup.name')}>
            {(id) => <Input id={id} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} required autoFocus />}
          </Field>
          <Field label={t('setup.workspace')}>
            {(id) => <Input id={id} value={form.appName} onChange={(e) => set('appName', e.target.value)} required />}
          </Field>
        </div>
        <Field label={t('email')}>
          {(id) => <Input id={id} type="email" autoComplete="username" value={form.email} onChange={(e) => set('email', e.target.value)} required />}
        </Field>
        <Field label={t('password')} hint={t('setup.passwordHint')}>
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => set('password', e.target.value)} required />
          )}
        </Field>
        <Field label={t('setup.timeZone')} hint={t('setup.timeZoneHint')}>
          {(id) => <Select id={id} value={form.timeZone} onChange={(v) => set('timeZone', v)} options={zones} />}
        </Field>
        <Field label={t('setup.language')}>
          {(id) => (
            <Select
              id={id}
              value={form.locale}
              onChange={(v) => set('locale', v)}
              options={[
                { value: 'en', label: 'English' },
                { value: 'it', label: 'Italiano' },
              ]}
            />
          )}
        </Field>
        {config?.setupNeedsCode && (
          <Field label={t('setup.code')} hint={<span className="t-meta">{t('setup.codeHint')}</span>}>
            {(id) => <Input id={id} value={form.setupCode} onChange={(e) => set('setupCode', e.target.value.toUpperCase())} placeholder="ABCD-EFGH" required className="t-meta" />}
          </Field>
        )}
        {error && <div className="t-callout text-cut">{error}</div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-2 w-full">
          {t('setup.create')}
        </Button>
      </form>
    </AuthFrame>
  )
}
