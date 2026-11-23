import type { BrandFamily, BrandFontRole, BrandFontUse, BrandKit } from '@greenlit/shared'
import { CaseUpper, Check, Download, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { IconButton, Menu, type MenuEntry, Skeleton, useContextMenu } from '@/ui'
import { drawingFaces, kitFamilyName, useKitFonts } from './fonts'

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
}

/** The kit's fonts drawn in their own files: what each is for, the weights it comes in, its files. */
export function TypeSection({
  kit,
  editable,
  save,
  sample,
}: {
  kit: BrandKit
  editable: boolean
  save: (fonts: BrandFontUse[]) => void
  /** A line in the kit's own words to set the text faces in. */
  sample: string
}) {
  const ready = useKitFonts(kit.projectId, kit.families)
  const uses = (patch: (f: BrandFontUse) => BrandFontUse, family: string): BrandFontUse[] => {
    const all = kit.families.map(({ faces: _faces, ...u }) => u)
    return all.map((u) => (u.family === family ? patch(u) : u))
  }
  return (
    <div className="flex flex-col gap-4">
      {kit.families.map((f) => (
        <FamilyCard
          key={f.family}
          family={f}
          name={kitFamilyName(kit.projectId, f.family)}
          ready={!!ready[f.family] || !f.faces.length}
          editable={editable}
          brandName={kit.name}
          sample={sample}
          onChange={(patch) => save(uses((u) => ({ ...u, ...patch }), f.family))}
        />
      ))}
    </div>
  )
}

function FamilyCard({
  family: f,
  name,
  ready,
  editable,
  brandName,
  sample,
  onChange,
}: {
  family: BrandFamily
  name: string
  ready: boolean
  editable: boolean
  brandName: string
  sample: string
  onChange: (patch: Partial<BrandFontUse>) => void
}) {
  const t = useT('brands')
  const faces = drawingFaces(f)
  const fixed = f.faces.filter((x) => !x.variable)
  const weights = [...new Set(faces.filter((x) => !x.italic).map((x) => x.weight))].sort((a, b) => a - b)
  // A variable font alone: show the kit's weights, or a spread of its range.
  const shown = weights.length > 1 ? weights : f.weights.length ? f.weights : [300, 400, 500, 700]
  const main = f.weights[0] ?? (f.role === 'display' ? 700 : 400)
  const tracking = f.letterSpacing !== null ? `${f.letterSpacing}em` : undefined
  const style = (weight: number) => ({
    fontFamily: `"${name}", var(--font-ui)`,
    fontWeight: weight,
    letterSpacing: tracking,
    textTransform: f.uppercase ? ('uppercase' as const) : undefined,
  })
  const files = [...f.faces].sort((a, b) => Number(a.variable) - Number(b.variable) || a.weight - b.weight)
  const menu = (): MenuEntry[] => [
    { group: t('type.useFor') },
    ...(['display', 'text', 'other'] as BrandFontRole[]).map((r) => ({
      label: t(`type.roles.${r}`),
      checked: f.role === r,
      onSelect: () => onChange({ role: r }),
    })),
    'separator',
    {
      label: t('type.uppercase'),
      icon: CaseUpper,
      checked: f.uppercase,
      onSelect: () => onChange({ uppercase: !f.uppercase }),
    },
  ]
  const ctx = useContextMenu(menu, { disabled: !editable })

  return (
    <div
      className="grid grid-cols-1 gap-6 rounded-panel bg-panel p-6 shadow-[inset_0_0_0_1px_var(--line)] lg:grid-cols-[minmax(0,1fr)_280px]"
      {...ctx}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 t-caption text-ink-3">
          <span className="t-caption font-[550] text-ink-2">{t(`type.roles.${f.role}`)}</span>
          {f.usage && <span className="truncate">· {f.usage}</span>}
          {editable && (
            <Menu
              align="start"
              width={220}
              trigger={<IconButton icon={MoreHorizontal} label={t('more')} size="xs" variant="ghost" />}
              items={menu()}
            />
          )}
        </div>
        {ready ? (
          <>
            <p className="mt-3 truncate text-[56px] text-ink leading-[1.05]" style={style(main)}>
              {f.family}
            </p>
            <p
              className="mt-3 line-clamp-2 text-[22px] text-ink-2 leading-[1.3]"
              style={style(f.role === 'display' ? main : 400)}
            >
              {f.role === 'display' ? brandName : sample}
            </p>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
              {shown.map((w) => (
                <div key={w} className="min-w-0">
                  <p className="text-[26px] text-ink leading-none" style={style(w)}>
                    Aa
                  </p>
                  <p className={cn('mt-1.5 t-caption', f.weights.includes(w) ? 'text-ink-2' : 'text-ink-4')}>
                    {WEIGHT_NAMES[w] ?? w} {w}
                    {f.weights.includes(w) && <Check size={11} className="ml-1 inline text-ink-3" />}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <Skeleton className="mt-4 h-12 w-2/3" />
            <Skeleton className="mt-4 h-6 w-1/2" />
          </>
        )}
      </div>
      <div className="min-w-0">
        <p className="t-caption font-[550] text-ink-3">
          {t('type.files', { count: f.faces.length })}
          {fixed.length > 0 && fixed.length < f.faces.length && ` · ${t('type.variableToo')}`}
        </p>
        {f.faces.length === 0 ? (
          <p className="mt-2 t-caption text-ink-3">{t('type.noFiles')}</p>
        ) : (
          <ul className="mt-2 flex max-h-[220px] flex-col overflow-y-auto">
            {files.map((x) => (
              <li
                key={x.mediaId}
                className="group flex h-8 items-center gap-2 rounded-control px-1.5 hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate t-callout text-ink-2">
                  {x.variable
                    ? `${t('type.variable')} ${x.weightRange ? `${x.weightRange[0]}–${x.weightRange[1]}` : ''}`
                    : x.style}
                  {x.variable && x.italic ? ` ${t('type.italic')}` : ''}
                </span>
                <a
                  href={`${x.url}?download=1&name=${encodeURIComponent(x.filename)}`}
                  className="t-meta text-ink-4 group-hover:text-ink-2"
                  title={x.filename}
                  download
                >
                  <Download size={13} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
