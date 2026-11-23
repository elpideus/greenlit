import { QueryClientProvider } from '@tanstack/react-query'
import { type ComponentType, lazy, type ReactNode, Suspense, useEffect, useMemo } from 'react'
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useRouteError,
} from 'react-router'
import { setLanguage, useT } from '@/lib/i18n'
import { queryClient } from '@/lib/query'
import { realtime } from '@/lib/realtime'
import { can, useConfig, useMe } from '@/lib/session'
import { useApplyTheme, useThemePreview } from '@/lib/theme'
import { Button, ConfirmHost, ContextMenuHost, Signal, Toaster, TooltipProvider } from '@/ui'
import { CommandPalette } from './CommandPalette'
import { PageFallback } from './PageFallback'
import { globals, providers, routes } from './registry'
import { Shell } from './Shell'

const pages = new Map<string, ComponentType>()
function page(r: (typeof routes)[number]) {
  let C = pages.get(r.path)
  if (!C) {
    C = lazy(r.load)
    pages.set(r.path, C)
  }
  return C
}

function Guarded({ r }: { r: (typeof routes)[number] }) {
  const { data: me } = useMe()
  const t = useT()
  const C = page(r)
  if (r.permission && !can(me, r.permission))
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <div className="t-title-2">{t('errors.forbidden')}</div>
        <div className="mt-2 t-callout text-ink-3">{t('errors.forbiddenBody')}</div>
      </div>
    )
  return <C />
}

/** Paints the instance theme and language, and holds the app until the config is known. */
function Root() {
  const { data: config, error } = useConfig()
  const { data: me } = useMe()
  const preview = useThemePreview()
  useApplyTheme((preview && config?.themes.find((t) => t.id === preview)) || config?.theme)
  useEffect(() => {
    setLanguage(me?.locale ?? config?.platform.defaultLocale ?? 'en')
  }, [me?.locale, config?.platform.defaultLocale])
  useEffect(() => {
    if (config?.branding.appName) document.title = config.branding.appName
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon && config?.branding.favicon) icon.href = config.branding.favicon
  }, [config?.branding])
  if (!config) return <Splash failed={!!error} />
  return (
    <>
      <Outlet />
      <ConfirmHost />
      <ContextMenuHost />
    </>
  )
}

function Splash({ failed }: { failed?: boolean }) {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Signal tone={failed ? 'changes' : 'review'} size={44} />
        {failed && (
          <div className="text-center t-callout text-ink-3">
            Greenlit cannot be reached right now.
            <div className="mt-3">
              <Button size="sm" onClick={() => location.reload()}>
                Reload
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Signed-in area: sends signed-out people to the sign-in page (and first runs to setup), starts realtime. */
function RequireSession() {
  const { data: config } = useConfig()
  const { data: me, isLoading } = useMe()
  const location = useLocation()
  useEffect(() => {
    if (me) realtime.start()
    else realtime.stop()
  }, [me])
  if (isLoading) return <Splash />
  if (!me) {
    if (config?.setupRequired) return <Navigate to="/setup" replace />
    const next = location.pathname + location.search
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
  }
  return (
    <>
      <Outlet />
      <CommandPalette />
      {globals.map((G, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static list
        <G key={i} />
      ))}
    </>
  )
}

function Home() {
  const { data: me } = useMe()
  // Reviewers land where decisions wait; admins in the library.
  return <Navigate to={me?.role === 'reviewer' ? '/review' : '/library'} replace />
}

function RouteError() {
  const err = useRouteError() as Error
  const t = useT()
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
      <Signal tone="changes" size={40} />
      <div className="mt-2 t-title-2">{t('errors.crashed')}</div>
      <div className="t-callout text-ink-3">{t('errors.crashedBody')}</div>
      <pre className="mt-2 max-h-40 w-full overflow-auto rounded-panel bg-well p-3 text-left t-meta text-ink-3">
        {String(err?.stack ?? err)}
      </pre>
      <Button variant="primary" onClick={() => location.reload()}>
        {t('errors.reload')}
      </Button>
    </div>
  )
}

function NotFound() {
  const t = useT()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-28 text-center">
      <Signal tone="draft" size={40} />
      <div className="mt-3 t-title-2">{t('errors.notFound')}</div>
      <div className="t-callout text-ink-3">{t('errors.notFoundBody')}</div>
      <Button className="mt-4" onClick={() => history.back()}>
        {t('back')}
      </Button>
    </div>
  )
}

function Full() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Outlet />
    </Suspense>
  )
}

function buildRouter() {
  const by = (layout: string) => routes.filter((r) => (r.layout ?? 'shell') === layout)
  const toRoute = (r: (typeof routes)[number]) => ({ path: r.path, element: <Guarded r={r} /> })
  return createBrowserRouter([
    {
      element: <Root />,
      errorElement: <RouteError />,
      children: [
        { element: <Full />, children: by('public').map(toRoute) },
        {
          element: <RequireSession />,
          children: [
            {
              element: <Shell />,
              children: [
                { index: true, element: <Home /> },
                ...by('shell').map(toRoute),
                { path: '*', element: <NotFound /> },
              ],
            },
            { element: <Full />, children: by('full').map(toRoute) },
          ],
        },
      ],
    },
  ])
}

function Providers({ children }: { children: ReactNode }) {
  return providers.reduceRight<ReactNode>((acc, P, i) => <P key={i}>{acc}</P>, children)
}

export function App() {
  const router = useMemo(buildRouter, [])
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Providers>
          <RouterProvider router={router} />
          <Toaster />
        </Providers>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
