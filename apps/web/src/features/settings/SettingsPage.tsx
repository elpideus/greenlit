import { ChevronLeft, ChevronRight } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { type ComponentType, lazy, Suspense, useMemo } from 'react'
import { Link, Navigate, NavLink, useParams } from 'react-router'
import type { SettingsSection } from '@/app/feature'
import { settingsSections } from '@/app/registry'
import { cn } from '@/lib/cn'
import { useIsPhone } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { ease, spring } from '@/lib/motion'
import { can, useSession } from '@/lib/session'
import { Skeleton } from '@/ui'

type Section = SettingsSection & { feature: string }

const GROUPS: Section['group'][] = ['you', 'workspace', 'publishing', 'system']

const loaded = new Map<string, ComponentType>()
function sectionComponent(s: Section) {
  let C = loaded.get(s.id)
  if (!C) {
    C = lazy(s.load)
    loaded.set(s.id, C)
  }
  return C
}

function useSections() {
  const me = useSession()
  return useMemo(
    () =>
      (settingsSections as Section[]).filter(
        (s) => (!s.permission || can(me, s.permission)) && !(me.viaShareLink && s.id !== 'profile'),
      ),
    [me],
  )
}

/**
 * Settings: the sections every feature registers, grouped (you / workspace / publishing / system) in a quiet list on
 * the left, the chosen section on the right. Phones show the list first and drill into a section.
 */
export default function SettingsPage() {
  const t = useT('settings')
  const { section } = useParams()
  const sections = useSections()
  const phone = useIsPhone()
  const current = sections.find((s) => s.id === section)

  if (!section && !phone && sections[0]) return <Navigate to={`/settings/${sections[0].id}`} replace />
  if (section && !current && sections[0]) return <Navigate to={`/settings/${sections[0].id}`} replace />

  if (phone) {
    return (
      <main className="px-[var(--gutter)] pt-5 pb-24">
        {current ? (
          <>
            <Link
              to="/settings"
              className="press -ml-1 mb-4 inline-flex h-8 items-center gap-0.5 rounded-control pr-2 t-callout text-ink-2"
            >
              <ChevronLeft size={18} strokeWidth={1.8} />
              {t('title')}
            </Link>
            <SectionBody section={current} />
          </>
        ) : (
          <>
            <h1 className="mb-6 t-title-1 text-ink">{t('title')}</h1>
            <SectionList sections={sections} phone />
          </>
        )}
      </main>
    )
  }

  return (
    <main className="mx-auto grid w-full max-w-[1240px] grid-cols-[232px_minmax(0,1fr)] gap-12 px-[var(--gutter)] pt-8 xl:gap-16">
      <aside className="sticky top-[calc(var(--bar-h)+32px)] self-start">
        <div className="mb-5 px-2.5 t-headline text-ink-3">{t('title')}</div>
        <SectionList sections={sections} />
      </aside>
      <div className="min-w-0 max-w-[780px]">
        {current && <SectionBody key={current.id} section={current} />}
      </div>
    </main>
  )
}

function SectionList({ sections, phone }: { sections: Section[]; phone?: boolean }) {
  const t = useT('settings')
  const { section } = useParams()
  return (
    <LayoutGroup id="settings-nav">
      <nav className="flex flex-col gap-6" aria-label={t('title')}>
        {GROUPS.map((g) => {
          const items = sections.filter((s) => s.group === g)
          if (!items.length) return null
          return (
            <div key={g}>
              <div className="mb-1.5 px-2.5 t-micro text-ink-4">{t(`groups.${g}`)}</div>
              <div
                className={cn(
                  'flex flex-col',
                  phone &&
                    'overflow-hidden rounded-panel bg-panel shadow-[inset_0_0_0_1px_var(--line)] [&>*+*]:border-t [&>*+*]:border-line',
                )}
              >
                {items.map((s) => {
                  const Icon = s.icon
                  const active = s.id === section
                  const label = t(`${s.feature}:${s.label}`, { defaultValue: s.label })
                  return (
                    <NavLink
                      key={s.id}
                      to={`/settings/${s.id}`}
                      className={cn(
                        'press relative flex items-center gap-3 t-callout',
                        phone ? 'h-12 px-3.5 text-ink' : 'h-9 rounded-control px-2.5',
                        !phone && (active ? 'font-[550] text-ink' : 'text-ink-2 hover-device:hover:text-ink'),
                      )}
                    >
                      {active && !phone && (
                        <motion.span
                          layoutId="settings-active"
                          transition={spring.snap}
                          className="absolute inset-0 -z-10 rounded-control bg-hover shadow-[inset_0_0_0_.5px_var(--line)]"
                        />
                      )}
                      <Icon
                        size={16}
                        strokeWidth={1.75}
                        className={cn('shrink-0', active ? 'text-ink' : 'text-ink-3')}
                      />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {phone && <ChevronRight size={16} className="text-ink-4" />}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>
    </LayoutGroup>
  )
}

function SectionBody({ section }: { section: Section }) {
  const C = sectionComponent(section)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease }}
    >
      <Suspense fallback={<SectionFallback />}>
        <C />
      </Suspense>
    </motion.div>
  )
}

function SectionFallback() {
  return (
    <div>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-3 h-4 w-96" />
      <Skeleton className="mt-10 h-40 w-full rounded-panel" />
      <Skeleton className="mt-8 h-28 w-full rounded-panel" />
    </div>
  )
}
