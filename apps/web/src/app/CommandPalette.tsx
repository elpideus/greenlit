import { Dialog as D } from '@base-ui/react/dialog'
import { Command } from 'cmdk'
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useNavigate } from 'react-router'
import { create } from 'zustand'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { can, useSession } from '@/lib/session'
import { Kbd } from '@/ui'
import { commands, navItems, settingsSections } from './registry'
import { Slot } from './Slot'

const usePalette = create<{ open: boolean; query: string; set: (o: boolean, q?: string) => void }>((set) => ({
  open: false,
  query: '',
  set: (open, query) => set((s) => ({ open, query: query ?? (open ? s.query : '') })),
}))

export function openPalette(query = '') {
  usePalette.getState().set(true, query)
}

/** Props passed to `palette.results` slot entries, which render `<Command.Group>`s of live results. */
export interface PaletteResultsProps {
  query: string
  go: (to: string) => void
}

export const paletteItemClass =
  'flex h-10 cursor-default select-none items-center gap-3 rounded-[9px] px-2.5 t-callout text-ink outline-none data-[selected=true]:bg-hover'
export const paletteGroupClass =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:t-micro [&_[cmdk-group-heading]]:text-ink-3'

/** ⌘K: jump anywhere, find anything, run any action. Features add results through the `palette.results` slot. */
export function CommandPalette() {
  const t = useT()
  const me = useSession()
  const navigate = useNavigate()
  const { open, query, set } = usePalette()
  const [q, setQ] = useState(query)
  const deferred = useDeferredValue(q)
  useHotkey(['mod+k', '/'], () => {
    setQ('')
    set(true)
  })
  const go = (to: string) => {
    set(false)
    navigate(to)
  }
  const allowed = <T extends { permission?: string }>(xs: T[]) =>
    xs.filter((x) => !x.permission || can(me, x.permission))

  return (
    <D.Root
      open={open}
      onOpenChange={(o) => {
        set(o)
        if (o) setQ(query)
      }}
    >
      <D.Portal>
        <D.Backdrop className="gl-backdrop fixed inset-0 z-[75] bg-scrim/60" />
        <D.Popup className="gl-dialog fixed top-[12vh] left-1/2 z-[76] w-[calc(100vw-24px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-sheet bg-raised shadow-[var(--shadow-sheet),inset_0_0_0_.5px_var(--line-strong),inset_0_1px_0_var(--highlight)] outline-none">
          <D.Title className="sr-only">{t('shell.search')}</D.Title>
          <Command shouldFilter label={t('shell.search')} loop>
            <div className="flex h-14 items-center gap-3 border-b border-line px-4">
              <Search size={18} strokeWidth={1.8} className="shrink-0 text-ink-3" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                autoFocus
                placeholder={t('shell.searchPlaceholder')}
                className="h-full min-w-0 flex-1 bg-transparent text-[16px] tracking-[-0.012em] text-ink outline-none placeholder:text-ink-3"
              />
              <Kbd combo="escape" />
            </div>
            <Command.List className="max-h-[min(60dvh,520px)] overflow-y-auto overscroll-contain p-1.5 [&_[cmdk-list-sizer]]:flex [&_[cmdk-list-sizer]]:flex-col">
              <Command.Empty className="px-4 py-10 text-center t-callout text-ink-3">
                {t('shell.noResults', { q: deferred })}
              </Command.Empty>
              {deferred.trim().length >= 2 && (
                <Slot<PaletteResultsProps> name="palette.results" props={{ query: deferred.trim(), go }} />
              )}
              <Command.Group heading={t('shell.goTo')} className={paletteGroupClass}>
                {allowed(navItems).map((n) => {
                  const Icon = n.icon
                  const label = t(`${n.feature}:${n.label}`, { defaultValue: n.label })
                  return (
                    <Command.Item
                      key={n.id}
                      value={`go ${label}`}
                      onSelect={() => go(n.to)}
                      className={paletteItemClass}
                    >
                      <Icon size={16} strokeWidth={1.75} className="text-ink-3" />
                      <span className="flex-1">{label}</span>
                      <ArrowRight size={14} className="text-ink-4" />
                    </Command.Item>
                  )
                })}
                {allowed(settingsSections).map((s) => {
                  const Icon = s.icon
                  const label = t(`${s.feature}:${s.label}`, { defaultValue: s.label })
                  return (
                    <Command.Item
                      key={s.id}
                      value={`settings ${label}`}
                      onSelect={() => go(`/settings/${s.id}`)}
                      className={paletteItemClass}
                    >
                      <Icon size={16} strokeWidth={1.75} className="text-ink-3" />
                      <span className="flex-1">
                        <span className="text-ink-3">{t('shell.settings')} › </span>
                        {label}
                      </span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
              {allowed(commands).length > 0 && (
                <Command.Group heading={t('shell.actions')} className={paletteGroupClass}>
                  {allowed(commands).map((c) => {
                    const Icon = c.icon
                    const label = t(`${c.feature}:${c.label}`, { defaultValue: c.label })
                    return (
                      <Command.Item
                        key={c.id}
                        value={`${label} ${(c.keywords ?? []).join(' ')}`}
                        onSelect={() => {
                          set(false)
                          c.run({ navigate })
                        }}
                        className={paletteItemClass}
                      >
                        {Icon && <Icon size={16} strokeWidth={1.75} className="text-ink-3" />}
                        <span className="flex-1">{label}</span>
                        {c.shortcut && <Kbd combo={c.shortcut} />}
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              )}
            </Command.List>
            <div className="flex h-9 items-center gap-4 border-t border-line px-4 t-caption text-ink-3">
              <span className="flex items-center gap-1.5">
                <CornerDownLeft size={12} /> {t('open')}
              </span>
              <span className="flex items-center gap-1.5">↑↓</span>
            </div>
          </Command>
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}
