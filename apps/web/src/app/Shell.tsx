import { Search, Settings } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { cn } from '@/lib/cn'
import { useIsPhone } from '@/lib/dom'
import { shortcutLabel } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { spring } from '@/lib/motion'
import { useRealtimeStatus } from '@/lib/realtime'
import { can, useSession } from '@/lib/session'
import { IconButton, Spinner } from '@/ui'
import { AccountMenu } from './AccountMenu'
import { ActivityButton } from './Activity'
import { Brand } from './Brand'
import { openPalette } from './CommandPalette'
import { NotificationsButton } from './Notifications'
import { PageFallback } from './PageFallback'
import { navItems } from './registry'
import { Slot } from './Slot'

function useNav() {
  const me = useSession()
  return navItems.filter((n) => !n.permission || can(me, n.permission))
}

function isActive(pathname: string, item: { to: string; match?: string[] }) {
  return [item.to, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** The signed-in frame: a slim top bar (no sidebar), the page, and a tab bar on phones. */
export function Shell() {
  const phone = useIsPhone()
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar phone={phone} />
      <div className={cn('flex-1', phone && 'pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))]')}>
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </div>
      {phone && <TabBar />}
    </div>
  )
}

function TopBar({ phone }: { phone: boolean }) {
  const t = useT()
  const me = useSession()
  const nav = useNav()
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const status = useRealtimeStatus()
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 2)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <header
      className={cn(
        'material-bar sticky top-0 z-40 h-[var(--bar-h)] transition-shadow duration-200',
        scrolled
          ? 'shadow-[0_1px_0_var(--line),0_8px_24px_-16px_rgba(0,0,0,.5)]'
          : 'shadow-[0_1px_0_transparent]',
      )}
    >
      <div className="mx-auto grid h-full max-w-[1680px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-[var(--gutter)]">
        <div className="flex min-w-0 items-center gap-3">
          <NavLink
            to="/"
            className="press -ml-1 flex h-9 items-center rounded-control px-1"
            aria-label="Home"
          >
            <Brand compact={phone} />
          </NavLink>
          {status === 'closed' && (
            <span className="flex items-center gap-1.5 t-caption text-ink-3">
              <Spinner size={12} />
              {t('shell.offline')}
            </span>
          )}
        </div>

        {!phone ? (
          <LayoutGroup id="topnav">
            <nav className="flex items-center gap-0.5" aria-label="Main">
              {nav.map((item) => {
                const active = isActive(pathname, item)
                return (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    className={cn(
                      'press relative flex h-8 items-center gap-1.5 rounded-control px-3 t-callout',
                      active ? 'font-[550] text-ink' : 'text-ink-3 hover-device:hover:text-ink',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        transition={spring.snap}
                        className="absolute inset-0 -z-10 rounded-control bg-hover shadow-[inset_0_0_0_.5px_var(--line)]"
                      />
                    )}
                    {t(`${item.feature}:${item.label}`, { defaultValue: item.label })}
                    <Slot name={`nav.badge.${item.id}`} props={{}} />
                  </NavLink>
                )
              })}
            </nav>
          </LayoutGroup>
        ) : (
          <span />
        )}

        <div className="flex items-center justify-end gap-1">
          {phone ? (
            <IconButton icon={Search} label={t('shell.search')} onClick={() => openPalette()} />
          ) : (
            <button
              type="button"
              onClick={() => openPalette()}
              className="press mr-1 hidden h-8 w-[200px] items-center gap-2 rounded-control bg-well px-2.5 t-callout text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] hover-device:hover:text-ink-2 hover-device:hover:shadow-[inset_0_0_0_1px_var(--line-strong)] xl:flex"
            >
              <Search size={14} strokeWidth={1.9} />
              <span className="flex-1 text-left">{t('shell.search')}</span>
              <span className="t-meta text-ink-4">{shortcutLabel('mod+k')}</span>
            </button>
          )}
          {!phone && (
            <span className="xl:hidden">
              <IconButton
                icon={Search}
                label={t('shell.search')}
                shortcut="mod+k"
                onClick={() => openPalette()}
              />
            </span>
          )}
          {!me.viaShareLink && can(me, 'activity.read') && <ActivityButton />}
          <NotificationsButton />
          {can(me, 'platform.manage') && !phone && (
            <NavLink to="/settings" tabIndex={-1}>
              {({ isActive: a }) => (
                <IconButton icon={Settings} label={t('shell.settings')} active={a || undefined} />
              )}
            </NavLink>
          )}
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

function TabBar() {
  const t = useT()
  const nav = useNav().slice(0, 5)
  const { pathname } = useLocation()
  return (
    <nav
      className="material-bar fixed inset-x-0 bottom-0 z-40 flex shadow-[0_-1px_0_var(--line)]"
      style={{
        height: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      aria-label="Main"
    >
      {nav.map((item) => {
        const active = isActive(pathname, item)
        const Icon = item.icon
        return (
          <NavLink
            key={item.id}
            to={item.to}
            className={cn(
              'press flex flex-1 flex-col items-center justify-center gap-1 t-micro',
              active ? 'text-signal' : 'text-ink-3',
            )}
          >
            <span className="relative">
              <Icon size={21} strokeWidth={active ? 2 : 1.7} />
              <span className="absolute -top-1 -right-2">
                <Slot name={`nav.badge.${item.id}`} props={{}} />
              </span>
            </span>
            {t(`${item.feature}:${item.label}`, { defaultValue: item.label })}
          </NavLink>
        )
      })}
    </nav>
  )
}
