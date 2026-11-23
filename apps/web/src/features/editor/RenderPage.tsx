import { type Composition, isActive, type OutputFormat } from '@greenlit/composition'
import { type AssetResolver, Stage } from '@greenlit/player'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { loadDocumentFonts } from './fonts'

/**
 * The headless render page (opened by the server's renderer, apps/server/src/modules/compositions/render.ts).
 *
 * Contract: `/render/:id?token=…` loads `/api/render-sessions/:id?token=` ({ document, format, assets }), draws the
 * composition at the format's exact size at the top-left corner with no chrome, and exposes
 *   window.__glRender = { ready: boolean, seek(t): Promise<void> }
 * `ready` turns true once the first frame is drawn; `seek(t)` resolves when every layer has drawn time `t` (fonts,
 * pictures, extracted video frames, code layers). Video frames come from `/api/render-sessions/:id/frames/:clip/:n`.
 */
interface Session {
  id: string
  document: Composition
  format: OutputFormat
  assets: Record<string, { src: string | null; poster: string | null }>
}

declare global {
  interface Window {
    __glRender?: { ready: boolean; seek: (t: number) => Promise<void>; error?: string }
  }
}

export default function RenderPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState<{ t: number; n: number }>({ t: 0, n: 0 })
  const waiters = useRef(new Map<number, () => void>())

  useEffect(() => {
    // Nothing but the frame: no page background, no scrollbars.
    const html = document.documentElement
    html.style.background = 'transparent'
    html.style.overflow = 'hidden'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    let cancelled = false
    fetch(`/api/render-sessions/${id}?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`render session ${r.status}`)
        const s = (await r.json()) as Session
        await loadDocumentFonts(s.document)
        if (!cancelled) setSession(s)
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
        window.__glRender = {
          ready: false,
          seek: () => Promise.reject(new Error(String(e))),
          error: String(e),
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, token])

  useEffect(() => {
    if (!session) return
    window.__glRender = {
      ready: false,
      seek: (t: number) =>
        new Promise<void>((resolve) => {
          setFrame((f) => {
            const n = f.n + 1
            waiters.current.set(n, resolve)
            return { t, n }
          })
        }),
    }
  }, [session])

  const assets = useMemo<AssetResolver>(
    () => ({
      src: (a) => session?.assets[a.id]?.src ?? null,
      poster: (a) => session?.assets[a.id]?.poster ?? null,
      frame: (_a, clipId, n) =>
        `/api/render-sessions/${id}/frames/${encodeURIComponent(clipId)}/${n}?token=${encodeURIComponent(token)}`,
    }),
    [session, id, token],
  )

  if (error) return <pre style={{ color: '#f75d59', font: '14px monospace', padding: 16 }}>{error}</pre>
  if (!session) return null
  const n = frame.n
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: session.format.width,
        height: session.format.height,
        overflow: 'hidden',
      }}
    >
      <Stage
        comp={session.document}
        format={session.format}
        time={frame.t}
        mode="render"
        assets={assets}
        onDrawn={async (t) => {
          // Code layers are sandboxed frames that Chromium draws in their own process: give their new frame a
          // moment to reach the compositor before the capture, or the screenshot shows their previous frame.
          if (hasCodeAt(session.document, t)) await settle()
          const r = window.__glRender
          if (r && !r.ready) r.ready = true
          const done = waiters.current.get(n)
          if (done) {
            waiters.current.delete(n)
            done()
          }
        }}
      />
    </div>
  )
}

function hasCodeAt(doc: Composition, t: number) {
  return doc.tracks.some((tr) => !tr.hidden && tr.clips.some((c) => c.type === 'html' && isActive(c, t)))
}

function settle() {
  return new Promise<void>((resolve) => {
    let done = false
    const go = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(go))
    setTimeout(go, 80)
  })
}
