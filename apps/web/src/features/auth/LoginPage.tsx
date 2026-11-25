import type { Me } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError, api } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useConfig, useMe } from '@/lib/session'
import { Button, Checkbox, Field, Input } from '@/ui'
import { AuthFrame } from './AuthFrame'

export default function LoginPage() {
  const t = useT('auth')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: config } = useConfig()
  const { data: me } = useMe()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lit, setLit] = useState(false)
  const next = params.get('next') || '/'

  if (config?.setupRequired) return <Navigate to="/setup" replace />
  if (me && !lit) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await api.post<Me>('/auth/login', { login: login.trim(), password, remember })
      // The lamp lights, then the door opens.
      setLit(true)
      setTimeout(() => {
        qc.setQueryData(qk.me, user)
        navigate(next, { replace: true })
      }, 650)
    } catch (err) {
      setBusy(false)
      setError(err instanceof ApiError && err.status === 401 ? t('wrong') : (err as Error).message)
    }
  }

  return (
    <AuthFrame lit={lit}>
      <h1 className="t-title-1 text-ink">
        {t('signInTo', { name: config?.branding.appName ?? 'Greenlit' })}
      </h1>
      {config?.branding.tagline && <p className="mt-2 t-body text-ink-3">{config.branding.tagline}</p>}
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <Field label={t('login')}>
          {(id) => (
            <Input
              id={id}
              size="lg"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t('password')} error={error}>
          {(id) => (
            <Input
              id={id}
              size="lg"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={!!error}
              required
            />
          )}
        </Field>
        <label className="flex items-center gap-2.5 t-callout text-ink-2">
          <Checkbox checked={remember} onChange={setRemember} />
          {t('remember')}
        </label>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-2 w-full">
          {busy ? t('signingIn') : t('signIn')}
        </Button>
      </form>
    </AuthFrame>
  )
}
