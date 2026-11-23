import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, errorMessage } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { Button, Signal } from '@/ui'

/**
 * A share link: signs the assigned person in (limited to the shared item), burns the link and opens the item.
 */
export default function ShareLanding() {
  const t = useT('auth')
  const { token } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [lit, setLit] = useState(false)
  const once = useRef(false)

  useEffect(() => {
    if (once.current || !token) return
    once.current = true
    api
      .get<{ redirect: string }>(`/share/redeem/${encodeURIComponent(token)}`)
      .then(async (r) => {
        setLit(true)
        await qc.invalidateQueries({ queryKey: qk.me })
        setTimeout(() => navigate(r.redirect, { replace: true }), 500)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [token, qc, navigate])

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <Signal tone={error ? 'changes' : lit ? 'greenlit' : 'review'} size={56} />
        {error ? (
          <>
            <h1 className="mt-6 t-title-2 text-ink">{t('share.failed')}</h1>
            <p className="mt-2 t-callout text-ink-2">{error}</p>
            <p className="mt-1 t-callout text-ink-3">{t('share.askAgain')}</p>
            <Link to="/login" className="mt-6">
              <Button>{t('share.signInInstead')}</Button>
            </Link>
          </>
        ) : (
          <p className="mt-6 t-callout text-ink-3">{t('share.opening')}</p>
        )}
      </div>
    </div>
  )
}
