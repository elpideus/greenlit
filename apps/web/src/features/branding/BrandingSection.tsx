import type { Branding, Theme } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Eye, EyeOff, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { SettingsGroup, SettingsSection } from '@/components/SettingsSection'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useFileDrop } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useConfig } from '@/lib/session'
import { setThemePreview, useMode, useThemePreview } from '@/lib/theme'
import {
  Badge,
  Button,
  confirm,
  IconButton,
  Menu,
  type MenuEntry,
  Signal,
  Spinner,
  toast,
  useContextMenu,
  Wordmark,
} from '@/ui'
import { slugify, ThemeEditor } from './ThemeEditor'
import { ThemePreview } from './ThemePreview'

type Slot = 'logoLight' | 'logoDark' | 'mark' | 'favicon' | 'loginImage'

export default function BrandingSection() {
  const t = useT('branding')
  const qc = useQueryClient()
  const { data: config } = useConfig()
  const preview = useThemePreview()
  const [editing, setEditing] = useState<Theme | null>(null)
  // A preview never outlives this page.
  useEffect(() => () => setThemePreview(null), [])
  if (!config) return null

  const refresh = () => qc.invalidateQueries({ queryKey: qk.config })
  const apply = async (theme: Theme) => {
    try {
      await api.patch<Branding>('/settings/branding', { themeId: theme.id })
      setThemePreview(null)
      await refresh()
      toast.done(t('applied', { name: theme.name }))
    } catch (err) {
      toast.error(err)
    }
  }
  const duplicate = (theme: Theme) => {
    const name = t('copyOf', { name: theme.name })
    setEditing({
      ...structuredClone(theme),
      id: `${slugify(theme.name)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      builtIn: false,
    })
  }
  const remove = async (theme: Theme) => {
    if (
      !(await confirm({
        title: t('deleteConfirm', { name: theme.name }),
        body: t('deleteBody'),
        confirm: t('delete'),
        danger: true,
      }))
    )
      return
    try {
      await api.delete(`/settings/themes/${theme.id}`)
      if (preview === theme.id) setThemePreview(null)
      await refresh()
      toast.done(t('deleted'))
    } catch (err) {
      toast.error(err)
    }
  }
  const previewed = config.themes.find((x) => x.id === preview && x.id !== config.branding.themeId)

  return (
    <SettingsSection title={t('section')} description={t('description')}>
      <SettingsGroup title={t('artwork')} description={t('artworkHint')} bare>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <ArtworkTile slot="logoLight" value={config.branding.logoLight} surface="light" />
          <ArtworkTile slot="logoDark" value={config.branding.logoDark} surface="dark" />
          <ArtworkTile slot="mark" value={config.branding.mark} surface="split" />
          <ArtworkTile slot="favicon" value={config.branding.favicon} surface="tab" />
          <ArtworkTile
            slot="loginImage"
            value={config.branding.loginImage}
            surface="photo"
            className="col-span-2"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('themes')} description={t('themesHint')} bare>
        <AnimatePresence initial={false}>
          {previewed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.28, ease }}
              className="overflow-hidden"
            >
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-panel bg-cue-soft px-4 py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--cue)_30%,transparent)]">
                <Eye size={16} className="shrink-0 text-cue" />
                <span className="min-w-0 flex-1 t-callout text-ink">
                  {t('previewBanner', { name: previewed.name })}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setThemePreview(null)}>
                  {t('stopPreview')}
                </Button>
                <Button size="sm" variant="primary" onClick={() => void apply(previewed)}>
                  {t('apply')}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {config.themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              active={theme.id === config.branding.themeId}
              previewing={theme.id === preview}
              onApply={() => void apply(theme)}
              onPreview={() => setThemePreview(theme.id === preview ? null : theme.id)}
              onDuplicate={() => duplicate(theme)}
              onEdit={() => setEditing(structuredClone(theme))}
              onDelete={() => void remove(theme)}
            />
          ))}
        </div>
      </SettingsGroup>

      {editing && (
        <ThemeEditor
          key={editing.id}
          initial={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSave={async (theme, andApply) => {
            try {
              const saved = await api.put<Theme>(`/settings/themes/${theme.id}`, { ...theme, builtIn: false })
              await refresh()
              if (andApply) await apply(saved)
              else toast.done(t('editor.saved'))
            } catch (err) {
              toast.error(err)
              throw err
            }
          }}
        />
      )}
    </SettingsSection>
  )
}

function ThemeCard({
  theme,
  active,
  previewing,
  onApply,
  onPreview,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  theme: Theme
  active: boolean
  previewing: boolean
  onApply: () => void
  onPreview: () => void
  onDuplicate: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useT('branding')
  const { mode } = useMode(theme.defaultMode)
  const items = (): MenuEntry[] => [
    !active && { label: t('apply'), icon: Check, onSelect: onApply },
    !active && {
      label: previewing ? t('stopPreview') : t('preview'),
      icon: previewing ? EyeOff : Eye,
      onSelect: onPreview,
    },
    'separator',
    !theme.builtIn && { label: t('edit'), icon: Pencil, onSelect: onEdit },
    { label: t('duplicate'), icon: Copy, onSelect: onDuplicate },
    !theme.builtIn && !active && 'separator',
    !theme.builtIn && !active && { label: t('delete'), icon: Trash2, danger: true, onSelect: onDelete },
  ]
  const menu = useContextMenu(items)
  return (
    <div
      {...menu}
      className={cn(
        'group relative overflow-hidden rounded-panel bg-panel transition-shadow duration-200',
        active
          ? 'shadow-[0_0_0_2px_var(--signal),var(--shadow-lift)]'
          : previewing
            ? 'shadow-[0_0_0_2px_var(--cue),var(--shadow-lift)]'
            : 'shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)] hover-device:hover:shadow-[inset_0_0_0_1px_var(--line-strong),var(--shadow-lift)]',
      )}
    >
      <button
        type="button"
        onClick={active ? undefined : onPreview}
        className="block w-full text-left"
        aria-label={`${t('preview')} ${theme.name}`}
      >
        <ThemePreview theme={theme} mode={mode} className="border-b border-line" />
      </button>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex gap-1" aria-hidden>
          {[theme[mode].bg, theme[mode].surface, theme[mode].text, theme[mode].accent].map((c, i) => (
            <span
              key={i}
              className="size-3.5 rounded-full shadow-[inset_0_0_0_1px_rgba(127,127,127,.3)]"
              style={{ background: c }}
            />
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate t-callout font-[550] text-ink">{theme.name}</div>
          <div className="t-caption text-ink-3">{theme.builtIn ? t('builtIn') : t('custom')}</div>
        </div>
        {active ? (
          <Badge tone="signal">{t('inUse')}</Badge>
        ) : previewing ? (
          <Button size="sm" variant="primary" onClick={onApply}>
            {t('apply')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={Eye}
            onClick={onPreview}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            {t('preview')}
          </Button>
        )}
        <Menu
          align="end"
          trigger={<IconButton icon={MoreHorizontal} label={t('common:more')} size="sm" />}
          items={items()}
        />
      </div>
    </div>
  )
}

const SURFACE_BG = { light: '#F5F7F6', dark: '#0C0D0C' }

function ArtworkTile({
  slot,
  value,
  surface,
  className,
}: {
  slot: Slot
  value: string | null
  surface: 'light' | 'dark' | 'split' | 'tab' | 'photo'
  className?: string
}) {
  const t = useT('branding')
  const qc = useQueryClient()
  const { data: config } = useConfig()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const title = t(`slots.${slot}.title`)
  const send = async (file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.set('file', file)
      await api.form<Branding>(`/settings/branding/${slot}`, form)
      await qc.invalidateQueries({ queryKey: qk.config })
      toast.done(t('uploaded', { what: title }))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    setBusy(true)
    try {
      await api.patch('/settings/branding', { [slot]: null })
      await qc.invalidateQueries({ queryKey: qk.config })
      toast.done(t('removed', { what: title }))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }
  const over = useFileDrop((files) => files[0] && void send(files[0]), { target: box })
  const appName = config?.branding.appName ?? 'Greenlit'

  const fallback = (onDark: boolean) =>
    slot === 'mark' || slot === 'favicon' ? (
      <Signal
        tone="greenlit"
        size={slot === 'favicon' ? 16 : 34}
        animate={false}
        className={onDark ? 'text-[#edefed]' : 'text-[#141715]'}
      />
    ) : (
      <span className={cn('flex items-center gap-2', onDark ? 'text-[#edefed]' : 'text-[#141715]')}>
        <Signal
          tone="greenlit"
          size={22}
          animate={false}
          className={onDark ? 'text-[#edefed]' : 'text-[#141715]'}
        />
        {appName === 'Greenlit' ? (
          <Wordmark height={17} className={onDark ? 'text-[#edefed]' : 'text-[#141715]'} />
        ) : (
          <span className="t-headline">{appName}</span>
        )}
      </span>
    )

  const art = (onDark: boolean) =>
    value ? (
      <img src={value} alt={title} className="max-h-[56%] max-w-[72%] object-contain" draggable={false} />
    ) : (
      <span className="opacity-55">{fallback(onDark)}</span>
    )

  return (
    <div
      ref={box}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-panel bg-panel shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)] transition-shadow duration-200',
        over && 'shadow-[inset_0_0_0_2px_var(--signal),0_0_0_4px_var(--signal-soft)]',
        className,
      )}
    >
      <div
        className={cn(
          'relative grid min-h-36 flex-1 place-items-center overflow-hidden',
          surface === 'photo' && 'min-h-44',
        )}
      >
        {surface === 'light' && <div className="absolute inset-0" style={{ background: SURFACE_BG.light }} />}
        {surface === 'dark' && <div className="absolute inset-0" style={{ background: SURFACE_BG.dark }} />}
        {(surface === 'light' || surface === 'dark') && (
          <div className="relative grid size-full place-items-center">{art(surface === 'dark')}</div>
        )}
        {surface === 'split' && (
          <div className="absolute inset-0 grid grid-cols-2">
            <div className="grid place-items-center" style={{ background: SURFACE_BG.light }}>
              {value ? (
                <img src={value} alt="" className="size-12 object-contain" />
              ) : (
                <span className="opacity-55">{fallback(false)}</span>
              )}
            </div>
            <div className="grid place-items-center" style={{ background: SURFACE_BG.dark }}>
              {value ? (
                <img src={value} alt="" className="size-12 object-contain" />
              ) : (
                <span className="opacity-55">{fallback(true)}</span>
              )}
            </div>
          </div>
        )}
        {surface === 'tab' && (
          <div className="absolute inset-0 grid place-items-center bg-well">
            <div className="flex h-9 w-[78%] items-center gap-2 rounded-t-[10px] bg-raised px-3 shadow-[0_0_0_1px_var(--line)]">
              {value ? (
                <img src={value} alt="" className="size-4 object-contain" />
              ) : (
                <Signal tone="greenlit" size={15} animate={false} className="text-ink" />
              )}
              <span className="truncate t-caption text-ink-2">{appName}</span>
            </div>
          </div>
        )}
        {surface === 'photo' &&
          (value ? (
            <img src={value} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
          ) : (
            <div className="force-dark absolute inset-0 bg-[#0a0b0a]">
              <div className="absolute top-0 right-[30%] h-full w-[13%] bg-[#42d77b] opacity-60" />
              <div className="absolute right-[14%] bottom-0 h-[62%] w-[12%] bg-[#edefed] opacity-50" />
              <div className="absolute top-[8%] right-[3%] aspect-square w-[7%] rounded-tr-[34%] bg-[#f9b73f] opacity-60" />
              <span className="absolute bottom-[14%] left-[6%] t-caption text-[#a8aca9]">
                {t('greenlitDefault')}
              </span>
            </div>
          ))}
        {(busy || over) && (
          <div className="absolute inset-0 grid place-items-center bg-black/45 text-white backdrop-blur-[2px]">
            {busy ? <Spinner size={20} /> : <span className="t-callout font-[550]">{t('dropHere')}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate t-callout font-[550] text-ink">{title}</div>
          <div className="truncate t-caption text-ink-3">
            {value ? t(`slots.${slot}.hint`) : t('greenlitDefault')}
          </div>
        </div>
        {value && <IconButton icon={Trash2} label={t('remove')} size="sm" onClick={() => void clear()} />}
        <Button size="sm" icon={Upload} onClick={() => input.current?.click()} disabled={busy}>
          {value ? t('replace') : t('upload')}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.webp,.ico,.avif,image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void send(f)
        }}
      />
    </div>
  )
}
