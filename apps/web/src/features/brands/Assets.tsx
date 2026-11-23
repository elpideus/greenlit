import {
  BRAND_SECTIONS,
  type BrandAsset,
  type BrandKit,
  type BrandSection,
  formatBytes,
} from '@greenlit/shared'
import { Download, FileText, FolderInput, MoreHorizontal, Palette, Sparkles, Star } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useMediaActions } from '@/components/library'
import { MediaThumb } from '@/components/MediaThumb'
import { cn } from '@/lib/cn'
import { withViewTransition } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { IconButton, type MenuEntry, openContextMenu, useContextMenu } from '@/ui'
import { extOf, isIconGroup, pairFiles, primary, SECTION_ICON, surfaceColor, surfaces } from './kit'

export interface AssetActions {
  /** The menu of one or more files of the kit (the library's items plus the kit's own). */
  menu: (assets: BrandAsset[]) => MenuEntry[]
  open: (a: BrandAsset) => void
}

/** The library's media menu with the kit's own entries before it: main logo, move to another section. */
export function useAssetActions(
  kit: BrandKit,
  opts: {
    editable: boolean
    setLogo: (mediaId: string | null) => void
    move: (mediaId: string, section: BrandSection['type']) => void
    readColors: (mediaId: string) => void
  },
): AssetActions & { dialogs: React.ReactNode } {
  const t = useT('brands')
  const navigate = useNavigate()
  const media = useMediaActions({})
  const open = (a: BrandAsset) => withViewTransition(() => navigate(`/media/${a.media.id}`))
  const menu = (assets: BrandAsset[]): MenuEntry[] => {
    const one = assets.length === 1 ? assets[0]! : null
    const own: MenuEntry[] = []
    if (one && opts.editable) {
      if (one.section === 'logos' && one.media.kind === 'image')
        own.push(
          kit.logo?.mediaId === one.media.id && kit.logoChosen
            ? { label: t('assets.autoLogo'), icon: Star, onSelect: () => opts.setLogo(null) }
            : { label: t('assets.makeLogo'), icon: Star, onSelect: () => opts.setLogo(one.media.id) },
        )
      if (/\.(ase|gpl|json|css|scss)$/i.test(primary(one)?.filename ?? ''))
        own.push({
          label: t('assets.readColors'),
          icon: Palette,
          onSelect: () => opts.readColors(one.media.id),
        })
      own.push({
        label: t('assets.moveTo'),
        icon: FolderInput,
        items: BRAND_SECTIONS.map((s) => ({
          label: t(`sections.${s}`),
          icon: SECTION_ICON[s],
          checked: s === one.section,
          onSelect: () => s !== one.section && opts.move(one.media.id, s),
        })),
      })
    }
    const lib = media.menu(assets.map((a) => a.media))
    return own.length ? [...own, 'separator', ...lib] : lib
  }
  return { menu, open, dialogs: media.tagDialog }
}

// ── tiles ───────────────────────────────────────────────────────────────────

/** Logos and graphics: each on the background it is made for, the same artwork's files as chips. */
export function ArtworkGrid({
  kit,
  section,
  actions,
}: {
  kit: BrandKit
  section: BrandSection
  actions: AssetActions
}) {
  const s = surfaces(kit)
  return (
    <div className="flex flex-col gap-8">
      {section.groups.map((g) => {
        const compact = isIconGroup(g.name, g.assets)
        return (
          <div key={g.name}>
            {g.name && <GroupTitle>{g.name}</GroupTitle>}
            <div
              className={cn(
                'grid gap-x-4 gap-y-5',
                compact
                  ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,112px),1fr))]'
                  : 'grid-cols-[repeat(auto-fill,minmax(min(100%,232px),1fr))]',
              )}
            >
              {pairFiles(g.assets).map(({ lead, files }) => (
                <ArtworkTile
                  key={lead.media.id}
                  lead={lead}
                  files={files}
                  bg={surfaceColor(lead.surface, s)}
                  compact={compact}
                  main={kit.logo?.mediaId === lead.media.id}
                  actions={actions}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ArtworkTile({
  lead,
  files,
  bg,
  compact,
  main,
  actions,
}: {
  lead: BrandAsset
  files: BrandAsset[]
  bg: string | null
  compact: boolean
  main: boolean
  actions: AssetActions
}) {
  const t = useT('brands')
  const f = primary(lead)
  const ctx = useContextMenu(() => actions.menu(files))
  const src = f?.mime === 'image/svg+xml' ? f.urls.original : (f?.urls.poster ?? f?.urls.thumbnail)
  return (
    <div className="group min-w-0" {...ctx}>
      <button
        type="button"
        onClick={() => actions.open(lead)}
        className={cn(
          'press relative grid w-full place-items-center overflow-hidden rounded-tile shadow-[inset_0_0_0_1px_var(--line)] outline-none',
          'focus-visible:shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--focus)]',
          compact ? 'aspect-square' : 'aspect-[4/3]',
          !bg && 'bg-well',
        )}
        style={bg ? { background: bg } : undefined}
        aria-label={lead.media.title}
      >
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            draggable={false}
            className={cn(
              'object-contain transition-transform duration-500 ease-out group-hover:scale-[1.03]',
              lead.surface ? (compact ? 'size-[46%]' : 'max-h-[56%] max-w-[72%]') : 'size-full',
            )}
            style={lead.surface ? undefined : { objectFit: 'contain' }}
          />
        ) : (
          <MediaThumb media={lead.media} fit="contain" className="absolute inset-0" />
        )}
        {main && (
          <span className="force-dark absolute top-2 left-2 inline-flex items-center gap-1 rounded-tag bg-black/55 px-1.5 py-0.5 t-micro text-white/90 backdrop-blur-md">
            <Star size={10} className="fill-current" /> {t('assets.mainLogo')}
          </span>
        )}
      </button>
      {!compact && (
        <div className="mt-2 flex items-center gap-2 px-0.5">
          <span className="min-w-0 flex-1 truncate t-callout text-ink-2" title={f?.filename}>
            {lead.media.title}
          </span>
          <Formats files={files} />
          <More onClick={(x, y) => openContextMenu(x, y, actions.menu(files))} />
        </div>
      )}
    </div>
  )
}

/** One chip per file of the same artwork: click to download that one. */
function Formats({ files }: { files: BrandAsset[] }) {
  return (
    <span className="flex shrink-0 gap-1">
      {files.map((a) => {
        const f = primary(a)
        if (!f) return null
        return (
          <a
            key={a.media.id}
            href={f.urls.download}
            download
            title={`${f.filename} · ${formatBytes(f.size)}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded-tag px-1.5 py-0.5 t-micro text-ink-3 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover hover:text-ink"
          >
            {extOf(f)}
          </a>
        )
      })}
    </span>
  )
}

function More({ onClick }: { onClick: (x: number, y: number) => void }) {
  const t = useT('brands')
  return (
    <IconButton
      icon={MoreHorizontal}
      label={t('more')}
      size="xs"
      variant="ghost"
      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onClick(r.right - 220, r.bottom + 4)
      }}
    />
  )
}

/** Templates and pages: each at its own shape. */
export function FrameGrid({
  section,
  actions,
  pages,
}: {
  section: BrandSection
  actions: AssetActions
  pages?: boolean
}) {
  return (
    <div className="flex flex-col gap-8">
      {section.groups.map((g) => {
        const docs = g.assets.filter((a) => a.media.kind === 'document' && !pages)
        const frames = g.assets.filter((a) => !docs.includes(a))
        return (
          <div key={g.name}>
            {g.name && <GroupTitle>{g.name}</GroupTitle>}
            {docs.length > 0 && (
              <DocumentRows assets={docs} actions={actions} className={frames.length ? 'mb-5' : ''} />
            )}
            {frames.length > 0 && (
              // Rows of one height, each frame as wide as its shape: posts, banners and stories side by side.
              <div className="flex flex-wrap gap-x-4 gap-y-5">
                {frames.map((a) => (
                  <FrameTile key={a.media.id} asset={a} actions={actions} height={pages ? 150 : 210} />
                ))}
                <span aria-hidden className="flex-[100_1_0%]" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FrameTile({
  asset: a,
  actions,
  height,
}: {
  asset: BrandAsset
  actions: AssetActions
  height: number
}) {
  const f = primary(a)
  const ctx = useContextMenu(() => actions.menu([a]))
  const ratio = f?.width && f?.height ? Math.min(3, Math.max(0.4, f.width / f.height)) : 4 / 3
  return (
    <div
      className="group min-w-0"
      style={{ flexGrow: ratio, flexBasis: ratio * height, maxWidth: Math.max(ratio * height * 1.5, 160) }}
      {...ctx}
    >
      <button
        type="button"
        onClick={() => actions.open(a)}
        className="press relative block w-full overflow-hidden rounded-tile bg-stage shadow-[inset_0_0_0_1px_var(--line)] outline-none focus-visible:shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--focus)]"
        style={{ aspectRatio: `${ratio}` }}
        aria-label={a.media.title}
      >
        <MediaThumb media={a.media} fit="cover" className="absolute inset-0" />
      </button>
      <div className="mt-2 flex items-center gap-2 px-0.5">
        <span className="min-w-0 flex-1 truncate t-callout text-ink-2" title={f?.filename}>
          {a.media.title}
        </span>
        <span className="shrink-0 t-meta text-ink-4">{extOf(f)}</span>
        <More onClick={(x, y) => openContextMenu(x, y, actions.menu([a]))} />
      </div>
    </div>
  )
}

/** PDFs and other documents worth opening: a page preview beside the name, open and download. */
export function DocumentRows({
  assets,
  actions,
  className,
}: {
  assets: BrandAsset[]
  actions: AssetActions
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-2', className)}>
      {assets.map((a) => (
        <DocumentRow key={a.media.id} asset={a} actions={actions} />
      ))}
    </div>
  )
}

function DocumentRow({ asset: a, actions }: { asset: BrandAsset; actions: AssetActions }) {
  const t = useT('brands')
  const f = primary(a)
  const ctx = useContextMenu(() => actions.menu([a]))
  return (
    <div
      className="group flex min-w-0 items-center gap-4 rounded-panel bg-panel p-3 shadow-[inset_0_0_0_1px_var(--line)]"
      {...ctx}
    >
      <button
        type="button"
        onClick={() => actions.open(a)}
        className="press relative aspect-[16/10] w-28 shrink-0 overflow-hidden rounded-control bg-stage"
        aria-label={a.media.title}
      >
        <MediaThumb media={a.media} fit="cover" className="absolute inset-0" />
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => actions.open(a)}
          className="block max-w-full truncate text-left t-headline text-ink hover:underline"
        >
          {a.media.title}
        </button>
        <p className="mt-0.5 t-caption text-ink-3">
          {extOf(f)} · {f ? formatBytes(f.size) : ''}
        </p>
      </div>
      {f && (
        <a
          href={f.urls.download}
          download
          className="press grid size-8 shrink-0 place-items-center rounded-control text-ink-3 hover:bg-hover hover:text-ink"
          title={t('assets.download')}
        >
          <Download size={15} />
        </a>
      )}
      <More onClick={(x, y) => openContextMenu(x, y, actions.menu([a]))} />
    </div>
  )
}

/** Looks (LUTs) and everything else: a quiet list with downloads. */
export function FileList({ section, actions }: { section: BrandSection; actions: AssetActions }) {
  return (
    <div className="flex flex-col gap-6">
      {section.groups.map((g) => (
        <div key={g.name}>
          {g.name && <GroupTitle>{g.name}</GroupTitle>}
          <ul className="flex flex-col">
            {g.assets.map((a) => (
              <FileRow key={a.media.id} asset={a} actions={actions} look={section.type === 'looks'} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function FileRow({ asset: a, actions, look }: { asset: BrandAsset; actions: AssetActions; look: boolean }) {
  const f = primary(a)
  const ctx = useContextMenu(() => actions.menu([a]))
  const Icon = look ? Sparkles : FileText
  return (
    <li
      className="group flex h-11 items-center gap-3 rounded-control px-2 hover:bg-hover [&:not(:last-child)]:shadow-[0_1px_0_var(--line)]"
      {...ctx}
    >
      <Icon size={16} className="shrink-0 text-ink-3" />
      <button
        type="button"
        onClick={() => actions.open(a)}
        className="min-w-0 flex-1 truncate text-left t-callout text-ink"
        title={f?.filename}
      >
        {look ? a.media.title : (f?.filename ?? a.media.title)}
      </button>
      <span className="shrink-0 t-meta text-ink-4">{extOf(f)}</span>
      <span className="w-16 shrink-0 text-right t-meta text-ink-3">{f ? formatBytes(f.size) : ''}</span>
      {f && (
        <a
          href={f.urls.download}
          download
          className="press grid size-7 shrink-0 place-items-center rounded-control text-ink-3 hover:bg-press hover:text-ink"
        >
          <Download size={14} />
        </a>
      )}
      <More onClick={(x, y) => openContextMenu(x, y, actions.menu([a]))} />
    </li>
  )
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 t-caption font-[550] text-ink-3">{children}</h3>
}
