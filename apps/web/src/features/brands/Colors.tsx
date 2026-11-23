import { type BrandColor, type BrandKit, colorGroupKey, hexToRgb, normalizeHex } from '@greenlit/shared'
import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/lib/i18n'
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  type MenuEntry,
  openContextMenu,
  toast,
  useContextMenu,
} from '@/ui'
import { inkOn } from './kit'

const copy = (text: string, done: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toast.done(done),
    () => toast.error(new Error(text)),
  )

const rgbOf = (hex: string) => hexToRgb(hex).join(', ')

/** The kit's colours, by the kit's own groups: big blocks for the core colours, smaller ones for the rest. */
export function ColorsSection({
  kit,
  editable,
  save,
}: {
  kit: BrandKit
  editable: boolean
  save: (colors: BrandColor[]) => void
}) {
  const t = useT('brands')
  const [editing, setEditing] = useState<BrandColor | 'new' | null>(null)
  const groups: { key: string; label: string; colors: BrandColor[] }[] = []
  for (const c of kit.colors) {
    const known = colorGroupKey(c.group)
    const key = known ?? c.group.toLowerCase()
    let g = groups.find((x) => x.key === key)
    if (!g) {
      g = { key, label: known ? t(`colors.groups.${known}`) : c.group, colors: [] }
      groups.push(g)
    }
    g.colors.push(c)
  }
  const remove = (c: BrandColor) => {
    const before = kit.colors
    save(before.filter((x) => x.id !== c.id))
    toast.done(t('colors.deleted', { name: c.name }), {
      action: { label: t('undo'), onClick: () => save(before) },
    })
  }
  const menu = (c: BrandColor): MenuEntry[] => [
    {
      label: t('colors.copyHex'),
      icon: Copy,
      onSelect: () => copy(c.hex, t('colors.copied', { value: c.hex })),
    },
    {
      label: t('colors.copyRgb'),
      icon: Copy,
      onSelect: () => copy(`rgb(${rgbOf(c.hex)})`, t('colors.copied', { value: `rgb(${rgbOf(c.hex)})` })),
    },
    !!c.cmyk && {
      label: t('colors.copyCmyk'),
      icon: Copy,
      onSelect: () => copy(c.cmyk!, t('colors.copied', { value: c.cmyk })),
    },
    editable && 'separator',
    editable && { label: t('colors.edit'), icon: Pencil, onSelect: () => setEditing(c) },
    editable && 'separator',
    editable && { label: t('colors.delete'), icon: Trash2, danger: true, onSelect: () => remove(c) },
  ]

  return (
    <div className="flex flex-col gap-8">
      {groups.map((g, gi) => (
        <div key={g.key}>
          {(groups.length > 1 || g.label) && (
            <h3 className="mb-3 t-caption font-[550] text-ink-3">{g.label || t('colors.other')}</h3>
          )}
          <div
            className={
              gi === 0 && g.colors.length <= 3
                ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
                : 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-4'
            }
          >
            {g.colors.map((c) => (
              <Swatch key={c.id} color={c} large={gi === 0 && g.colors.length <= 3} menu={() => menu(c)} />
            ))}
          </div>
        </div>
      ))}
      {editable && (
        <div>
          <Button variant="ghost" icon={Plus} onClick={() => setEditing('new')}>
            {t('colors.add')}
          </Button>
        </div>
      )}
      <ColorDialog
        color={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        groups={[...new Set(kit.colors.map((c) => c.group).filter(Boolean))]}
        onSave={(c) => {
          const exists = kit.colors.some((x) => x.id === c.id)
          save(exists ? kit.colors.map((x) => (x.id === c.id ? c : x)) : [...kit.colors, c])
          setEditing(null)
        }}
        taken={kit.colors.map((c) => c.id)}
      />
    </div>
  )
}

function Swatch({ color: c, large, menu }: { color: BrandColor; large: boolean; menu: () => MenuEntry[] }) {
  const t = useT('brands')
  const ctx = useContextMenu(menu)
  const ink = inkOn(c.hex)
  return (
    <div className="group min-w-0" {...ctx}>
      <button
        type="button"
        onClick={() => copy(c.hex, t('colors.copied', { value: c.hex }))}
        title={t('colors.copyHex')}
        className="press relative flex w-full flex-col justify-end rounded-tile p-3 text-left shadow-[inset_0_0_0_1px_var(--line)] outline-none focus-visible:shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--focus)]"
        style={{ background: c.hex, color: ink, height: large ? 168 : 112 }}
      >
        <span className={large ? 't-headline' : 't-callout font-[550]'}>{c.name}</span>
        <span className="t-meta opacity-80">{c.hex}</span>
        <Copy
          size={14}
          className="absolute top-3 right-3 opacity-0 transition-opacity duration-150 group-hover:opacity-70"
        />
      </button>
      <div className="mt-2 flex items-start gap-1 px-0.5">
        <dl className="min-w-0 flex-1 t-caption text-ink-3">
          <div className="flex gap-2">
            <dt className="w-10 shrink-0 text-ink-4">RGB</dt>
            <dd className="t-meta text-ink-2">{rgbOf(c.hex)}</dd>
          </div>
          {c.cmyk && (
            <div className="flex gap-2">
              <dt className="w-10 shrink-0 text-ink-4">CMYK</dt>
              <dd className="t-meta text-ink-2">{c.cmyk}</dd>
            </div>
          )}
          {c.usage && <dd className="mt-1 text-ink-3">{c.usage}</dd>}
        </dl>
        <IconButton
          icon={MoreHorizontal}
          label={t('more')}
          size="sm"
          variant="ghost"
          className="-mt-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openContextMenu(r.right - 200, r.bottom + 4, menu())
          }}
        />
      </div>
    </div>
  )
}

function ColorDialog({
  color,
  open,
  onOpenChange,
  onSave,
  groups,
  taken,
}: {
  color: BrandColor | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onSave: (c: BrandColor) => void
  groups: string[]
  taken: string[]
}) {
  const t = useT('brands')
  const tc = useT()
  const [draft, setDraft] = useState<BrandColor>(blank())
  const [hexText, setHexText] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    const c = color ?? blank()
    setDraft(c)
    setHexText(c.hex)
    setWasOpen(true)
  }
  if (!open && wasOpen) setWasOpen(false)
  const hex = normalizeHex(hexText)
  const submit = () => {
    if (!hex || !draft.name.trim()) return
    let id = draft.id
    if (!color) {
      const base =
        draft.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 32) || 'colour'
      id = base
      for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
    }
    onSave({ ...draft, id, hex, name: draft.name.trim(), cmyk: draft.cmyk?.trim() || null })
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={color ? t('colors.editTitle') : t('colors.addTitle')}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" disabled={!hex || !draft.name.trim()} onClick={submit}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex gap-3">
          <label
            className="relative size-[68px] shrink-0 cursor-pointer overflow-hidden rounded-tile shadow-[inset_0_0_0_1px_var(--line-strong)]"
            style={{ background: hex ?? 'transparent' }}
          >
            <input
              type="color"
              value={(hex ?? '#000000').toLowerCase()}
              onChange={(e) => setHexText(e.target.value.toUpperCase())}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label={t('colors.pick')}
            />
          </label>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Field label={t('colors.name')}>
              {(id) => (
                <Input
                  id={id}
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              )}
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HEX">
            {(id) => (
              <Input
                id={id}
                value={hexText}
                onChange={(e) => setHexText(e.target.value)}
                className="font-mono"
              />
            )}
          </Field>
          <Field label="CMYK">
            {(id) => (
              <Input
                id={id}
                value={draft.cmyk ?? ''}
                placeholder="C0 M0 Y0 K100"
                onChange={(e) => setDraft({ ...draft, cmyk: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label={t('colors.usage')}>
          {(id) => (
            <Input
              id={id}
              value={draft.usage}
              placeholder={t('colors.usagePlaceholder')}
              onChange={(e) => setDraft({ ...draft, usage: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('colors.group')}>
          {(id) => (
            <>
              <Input
                id={id}
                list={`${id}-groups`}
                value={draft.group}
                placeholder={t('colors.groupPlaceholder')}
                onChange={(e) => setDraft({ ...draft, group: e.target.value })}
              />
              <datalist id={`${id}-groups`}>
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

const blank = (): BrandColor => ({ id: '', name: '', hex: '#000000', cmyk: null, usage: '', group: '' })
