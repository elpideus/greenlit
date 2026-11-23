import type { Theme, ThemePalette } from '@greenlit/shared'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Button, Dialog, Field, Input, Segmented, Select, Slider, Toggle } from '@/ui'
import { ThemePreview } from './ThemePreview'

const COLOUR = /^(#[0-9a-fA-F]{3,8}|oklch\([^)]*\)|rgba?\([^)]*\))$/

/** Palette roles, grouped the way people think about them. */
const ROLE_GROUPS: (keyof ThemePalette)[][] = [
  ['bg', 'bgSubtle', 'surface', 'surfaceRaised', 'surfaceHover'],
  ['text', 'textMuted', 'textSubtle', 'border', 'borderStrong'],
  ['accent', 'accentHover', 'accentText', 'accentSoft', 'focus'],
  ['success', 'warning', 'danger', 'info', 'overlay'],
]

const FONTS: { family: string; fallback: string; label: string }[] = [
  { family: 'Geist Variable', fallback: 'Geist, -apple-system, system-ui, sans-serif', label: 'Geist' },
  { family: 'Jost Variable', fallback: "Jost, 'Century Gothic', system-ui, sans-serif", label: 'Jost' },
  { family: 'Cinzel Variable', fallback: "Cinzel, 'Trajan Pro', Georgia, serif", label: 'Cinzel' },
  {
    family: 'Geist Mono Variable',
    fallback: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
    label: 'Geist Mono',
  },
  { family: 'system-ui', fallback: '-apple-system, BlinkMacSystemFont, sans-serif', label: 'System' },
]

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'theme'
  )
}

/**
 * Edit a custom theme with a live preview of both modes: colours per role (light and dark), type, title style,
 * radius and the mode it opens in.
 */
export function ThemeEditor({
  initial,
  open,
  onOpenChange,
  onSave,
}: {
  initial: Theme
  open: boolean
  onOpenChange: (o: boolean) => void
  onSave: (theme: Theme, apply: boolean) => Promise<void>
}) {
  const t = useT('branding')
  const [draft, setDraft] = useState<Theme>(initial)
  const [paletteMode, setPaletteMode] = useState<'light' | 'dark'>(
    initial.defaultMode === 'light' ? 'light' : 'dark',
  )
  const [busy, setBusy] = useState<false | 'save' | 'apply'>(false)
  const invalid = (['light', 'dark'] as const).some((m) =>
    Object.values(draft[m]).some((v) => !COLOUR.test(v)),
  )

  const setRole = (role: keyof ThemePalette, value: string) =>
    setDraft((d) => ({ ...d, [paletteMode]: { ...d[paletteMode], [role]: value } }))
  const setFont = (slot: 'ui' | 'display' | 'mono', family: string) => {
    const known = FONTS.find((f) => f.family === family)
    setDraft((d) => ({
      ...d,
      fonts: {
        ...d.fonts,
        [slot]: known ? { family: known.family, fallback: known.fallback } : { ...d.fonts[slot], family },
      },
    }))
  }
  const save = async (apply: boolean) => {
    setBusy(apply ? 'apply' : 'save')
    try {
      await onSave(draft, apply)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={1120} bare>
      <div className="grid max-h-[min(88dvh,900px)] min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[400px_minmax(0,1fr)]">
        {/* controls */}
        <div className="flex min-h-0 flex-col border-line md:border-r">
          <div className="px-6 pt-5 pb-3">
            <div className="t-title-2 text-ink">{t('editor.title')}</div>
          </div>
          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 pb-6">
            <Field label={t('editor.name')}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  maxLength={60}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              )}
            </Field>
            <Field label={t('editor.defaultMode')}>
              {() => (
                <Segmented
                  stretch
                  value={draft.defaultMode}
                  onChange={(defaultMode) => setDraft((d) => ({ ...d, defaultMode }))}
                  options={[
                    { value: 'system', label: t('editor.system') },
                    { value: 'light', label: t('editor.light') },
                    { value: 'dark', label: t('editor.dark') },
                  ]}
                />
              )}
            </Field>

            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <span className="t-headline text-ink">{t('editor.palette')}</span>
                <Segmented
                  size="sm"
                  value={paletteMode}
                  onChange={setPaletteMode}
                  options={[
                    { value: 'light', label: t('editor.lightPalette') },
                    { value: 'dark', label: t('editor.darkPalette') },
                  ]}
                />
              </div>
              <div className="space-y-4">
                {ROLE_GROUPS.map((group) => (
                  <div
                    key={group[0]}
                    className="overflow-hidden rounded-panel bg-well shadow-[inset_0_0_0_1px_var(--line)] [&>*+*]:border-t [&>*+*]:border-line"
                  >
                    {group.map((role) => (
                      <ColourRow
                        key={role}
                        label={t(`roles.${role}`)}
                        value={draft[paletteMode][role]}
                        onChange={(v) => setRole(role, v)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3.5">
              <div className="t-headline text-ink">{t('editor.fonts')}</div>
              {(['ui', 'display', 'mono'] as const).map((slot) => (
                <div key={slot} className="flex items-center justify-between gap-3">
                  <span className="t-callout text-ink-2">{t(`editor.${slot}`)}</span>
                  <Select
                    className="w-48"
                    value={draft.fonts[slot].family}
                    onChange={(v) => setFont(slot, v)}
                    options={[
                      ...FONTS.map((f) => ({
                        value: f.family,
                        label: <span style={{ fontFamily: `"${f.family}", ${f.fallback}` }}>{f.label}</span>,
                      })),
                      ...(FONTS.some((f) => f.family === draft.fonts[slot].family)
                        ? []
                        : [{ value: draft.fonts[slot].family, label: draft.fonts[slot].family }]),
                    ]}
                  />
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="t-callout text-ink-2">{t('editor.uppercase')}</span>
                <Toggle
                  checked={draft.display.uppercase}
                  onChange={(uppercase) => setDraft((d) => ({ ...d, display: { ...d.display, uppercase } }))}
                />
              </div>
              <SliderRow
                label={t('editor.tracking')}
                value={draft.display.letterSpacing}
                min={-0.06}
                max={0.12}
                step={0.002}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                onChange={(letterSpacing) =>
                  setDraft((d) => ({ ...d, display: { ...d.display, letterSpacing } }))
                }
              />
              <SliderRow
                label={t('editor.weight')}
                value={draft.display.weight}
                min={300}
                max={800}
                step={50}
                format={(v) => String(v)}
                onChange={(weight) => setDraft((d) => ({ ...d, display: { ...d.display, weight } }))}
              />
            </div>

            <div className="space-y-3.5">
              <div className="t-headline text-ink">{t('editor.shape')}</div>
              <SliderRow
                label={t('editor.radius')}
                value={draft.radius}
                min={0}
                max={20}
                step={1}
                format={(v) => `${v} px`}
                onChange={(radius) => setDraft((d) => ({ ...d, radius }))}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-3.5">
            {invalid && <span className="mr-auto t-caption text-cut">{t('editor.invalidColour')}</span>}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common:cancel')}
            </Button>
            <Button
              onClick={() => void save(false)}
              loading={busy === 'save'}
              disabled={invalid || !draft.name.trim() || !!busy}
            >
              {t('editor.save')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void save(true)}
              loading={busy === 'apply'}
              disabled={invalid || !draft.name.trim() || !!busy}
            >
              {t('editor.saveAndApply')}
            </Button>
          </div>
        </div>

        {/* live preview */}
        <div className="hidden min-h-0 flex-col gap-4 overflow-y-auto bg-well p-6 md:flex">
          {(['light', 'dark'] as const).map((m) => (
            <div key={m}>
              <div className="mb-2 t-micro text-ink-3">{t(`editor.${m}`)}</div>
              <div
                className={cn(
                  'overflow-hidden rounded-panel shadow-[0_0_0_1px_var(--line-strong),var(--shadow-lift)] transition-shadow',
                  paletteMode === m && 'shadow-[0_0_0_2px_var(--signal),var(--shadow-lift)]',
                )}
              >
                <ThemePreview theme={draft} mode={m} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

function toHex(v: string) {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7)
  const m = v.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i)
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  return '#000000'
}

function ColourRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const [text, setText] = useState(value)
  const valid = COLOUR.test(text)
  return (
    <div className="flex h-11 items-center gap-3 px-3">
      <label
        className="press relative size-6 shrink-0 cursor-default overflow-hidden rounded-[6px] shadow-[inset_0_0_0_1px_rgba(127,127,127,.35)]"
        style={{ background: value }}
      >
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => {
            // Keep an alpha channel the colour had (rgba / #rrggbbaa).
            const alpha = value.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1]
            const hex = e.target.value
            const next = alpha
              ? `rgba(${Number.parseInt(hex.slice(1, 3), 16)},${Number.parseInt(hex.slice(3, 5), 16)},${Number.parseInt(hex.slice(5, 7), 16)},${alpha})`
              : hex.toUpperCase()
            setText(next)
            onChange(next)
          }}
          className="absolute inset-0 cursor-default opacity-0"
          aria-label={label}
        />
      </label>
      <span className="min-w-0 flex-1 truncate t-callout text-ink-2">{label}</span>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (COLOUR.test(e.target.value.trim())) onChange(e.target.value.trim())
        }}
        onBlur={() => setText(value)}
        spellCheck={false}
        className={cn(
          'h-7 w-[150px] rounded-[6px] bg-transparent px-2 text-right t-meta text-ink-2 outline-none hover:bg-hover focus:bg-canvas focus:text-ink',
          !valid && 'text-cut',
        )}
      />
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-[132px] shrink-0 t-callout text-ink-2">{label}</span>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} label={label} />
      <span className="w-14 shrink-0 text-right t-meta text-ink-3">{format(value)}</span>
    </div>
  )
}
