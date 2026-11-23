import { type BrandKit, type BrandSection, formatBytes, type Project } from '@greenlit/shared'
import { BookOpen, ChevronDown, Download, FolderUp, Pencil, Upload } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Markdown } from '@/components/Markdown'
import { uploadMedia } from '@/data/media'
import { cn } from '@/lib/cn'
import { useFileDrop } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { rise } from '@/lib/motion'
import { can, useSession } from '@/lib/session'
import { Button, EmptyState, ErrorState, ProgressBar, Skeleton, Textarea, toast } from '@/ui'
import { ArtworkGrid, DocumentRows, FileList, FrameGrid, useAssetActions } from './Assets'
import { kitZipUrl, startDownload, useKit, useKitActions } from './api'
import { ColorsSection } from './Colors'
import { inkOn, primary, SECTION_ICON, sectionAnchor, surfaces } from './kit'
import { TypeSection } from './Type'

/**
 * A brand kit as a brand book: the main logo on its colour, the guide, colours, type, then every file by section.
 * Drop the kit's folder (or a .zip of it) anywhere on the page to add it.
 */
export default function KitTab({ project }: { project: Project }) {
  const t = useT('brands')
  const me = useSession()
  const { data: kit, isLoading, error, refetch } = useKit(project.id)
  const canUpload = can(me, 'media.upload') && !me.viaShareLink
  const editable = can(me, 'media.edit') && !me.viaShareLink
  // The project page uploads what is dropped on it; this only shows that it will.
  const over = useFileDrop(() => {}, { enabled: canUpload, watchOnly: true })

  if (isLoading)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-[300px] w-full rounded-panel" />
        <Skeleton className="h-4 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-tile" />
          ))}
        </div>
      </div>
    )
  if (error || !kit) return <ErrorState error={error} retry={() => void refetch()} />
  const empty = !kit.sections.length
  return (
    <div className="relative">
      {over && <DropHint />}
      {kit.unpacking && <Unpacking progress={kit.unpacking} />}
      {empty && !kit.unpacking ? (
        <KitDrop project={project} canUpload={canUpload} />
      ) : (
        <KitBook kit={kit} project={project} editable={editable} />
      )}
      {!empty && canUpload && <p className="mt-12 t-caption text-ink-4">{t('dropMore')}</p>}
      {empty && !canUpload && <p className="t-callout text-ink-3">{t('empty.readonly')}</p>}
      <span className="sr-only">{t('title')}</span>
    </div>
  )
}

function KitBook({ kit, project, editable }: { kit: BrandKit; project: Project; editable: boolean }) {
  const t = useT('brands')
  const { update, move, readColors } = useKitActions(project.id)
  const actions = useAssetActions(kit, {
    editable,
    setLogo: (logoMediaId) => update.mutate({ logoMediaId }),
    move: (id, section) => void move(id, section),
    readColors: async (id) => {
      const k = await readColors(id)
      if (k) toast.done(t('colors.read', { count: k.colors.length }))
    },
  })
  const section = (type: BrandSection['type']) => kit.sections.find((s) => s.type === type)
  const count = (s: BrandSection | undefined) => s?.groups.reduce((n, g) => n + g.assets.length, 0) ?? 0
  const guidelines = section('guidelines')
  const mainPdf = guidelines?.groups
    .flatMap((g) => g.assets)
    .find((a) => primary(a)?.mime === 'application/pdf')
  const sample = project.description.split(/(?<=[.!?])\s/)[0] || kit.name

  const parts: { id: string; label: string; count?: number; node: React.ReactNode }[] = []
  if (kit.guide.trim())
    parts.push({
      id: 'guide',
      label: t('sections.guide'),
      node: <Guide kit={kit} editable={editable} save={(guide) => update.mutate({ guide })} />,
    })
  if (kit.colors.length || section('colors'))
    parts.push({
      id: 'colors',
      label: t('sections.colors'),
      count: kit.colors.length,
      node: (
        <>
          {kit.colors.length > 0 ? (
            <ColorsSection kit={kit} editable={editable} save={(colors) => update.mutate({ colors })} />
          ) : (
            <p className="t-callout text-ink-3">{t('colors.none')}</p>
          )}
          {section('colors') && (
            <div className="mt-6">
              <FileList section={section('colors')!} actions={actions} />
            </div>
          )}
        </>
      ),
    })
  if (kit.families.length || section('fonts'))
    parts.push({
      id: 'fonts',
      label: t('sections.fonts'),
      count: kit.families.length,
      node: (
        <>
          <TypeSection
            kit={kit}
            editable={editable}
            sample={sample}
            save={(fonts) => update.mutate({ fonts })}
          />
          <Leftovers section={section('fonts')} actions={actions} />
        </>
      ),
    })
  for (const type of ['logos', 'graphics', 'templates', 'guidelines', 'looks', 'files'] as const) {
    const s = section(type)
    if (!s) continue
    parts.push({
      id: type,
      label: t(`sections.${type}`),
      count: count(s),
      node:
        type === 'logos' || type === 'graphics' ? (
          <ArtworkGrid kit={kit} section={s} actions={actions} />
        ) : type === 'templates' ? (
          <FrameGrid section={s} actions={actions} />
        ) : type === 'guidelines' ? (
          <Guidelines section={s} actions={actions} />
        ) : (
          <FileList section={s} actions={actions} />
        ),
    })
  }

  return (
    <motion.div {...rise}>
      <Hero kit={kit} onGuidelines={mainPdf ? () => actions.open(mainPdf) : undefined} />
      <SectionNav parts={parts} />
      {parts.map((p) => {
        const Icon = SECTION_ICON[p.id as keyof typeof SECTION_ICON] ?? BookOpen
        return (
          <section key={p.id} id={sectionAnchor(p.id)} className="mt-14 scroll-mt-[112px]">
            <header className="mb-5 flex items-center gap-2.5">
              <Icon size={17} className="text-ink-3" />
              <h2 className="t-title-2 text-ink">{p.label}</h2>
              {p.count !== undefined && p.count > 0 && <span className="t-meta text-ink-3">{p.count}</span>}
              <span className="flex-1" />
              {section(p.id as BrandSection['type']) && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Download}
                  onClick={() =>
                    startDownload(kitZipUrl(kit.projectId, p.id as BrandSection['type'], p.label))
                  }
                >
                  {t('download.section')}
                </Button>
              )}
            </header>
            {p.node}
          </section>
        )
      })}
      {actions.dialogs}
    </motion.div>
  )
}

/** The kit at a glance: its main logo on the colour it is made for, its palette along the bottom. */
function Hero({ kit, onGuidelines }: { kit: BrandKit; onGuidelines?: () => void }) {
  const t = useT('brands')
  const s = surfaces(kit)
  const bg = kit.logo?.background ?? (kit.logo?.surface === 'light' ? s.light : s.dark)
  const files = kit.sections.reduce((n, x) => n + x.groups.reduce((m, g) => m + g.assets.length, 0), 0)
  const size = kit.sections.reduce(
    (n, x) => n + x.groups.reduce((m, g) => m + g.assets.reduce((k, a) => k + (primary(a)?.size ?? 0), 0), 0),
    0,
  )
  return (
    <div className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
      <div
        className="relative grid h-[clamp(220px,30vw,340px)] place-items-center"
        style={{ background: bg }}
      >
        {kit.logo ? (
          <img
            src={kit.logo.url}
            alt={kit.name}
            className="max-h-[44%] max-w-[min(62%,560px)] object-contain"
          />
        ) : (
          <span className="t-display" style={{ color: inkOn(bg) }}>
            {kit.name}
          </span>
        )}
        {onGuidelines && (
          <button
            type="button"
            onClick={onGuidelines}
            className="press absolute right-4 bottom-4 inline-flex h-8 items-center gap-1.5 rounded-control px-3 t-callout font-[550] backdrop-blur-md"
            style={{ color: inkOn(bg), background: 'color-mix(in oklab, currentColor 12%, transparent)' }}
          >
            <BookOpen size={15} />
            {t('openGuidelines')}
          </button>
        )}
      </div>
      {kit.colors.length > 0 && (
        <div className="flex h-9">
          {kit.colors.map((c) => (
            <span
              key={c.id}
              className="flex-1"
              style={{ background: c.hex }}
              title={`${c.name} · ${c.hex}`}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-panel px-4 py-3 t-callout text-ink-3">
        {kit.colors.length > 0 && <span>{t('glance.colors', { count: kit.colors.length })}</span>}
        {kit.families.length > 0 && <span>{kit.families.map((f) => f.family).join(' · ')}</span>}
        <span className="tabular">{t('glance.files', { count: files })}</span>
        {size > 0 && <span className="tabular">{formatBytes(size)}</span>}
        <span className="flex-1" />
        <Button size="sm" icon={Download} onClick={() => startDownload(kitZipUrl(kit.projectId))}>
          {t('download.kit')}
        </Button>
      </div>
    </div>
  )
}

/** Jump to a section; the one in view is marked. */
function SectionNav({ parts }: { parts: { id: string; label: string; count?: number }[] }) {
  const [active, setActive] = useState(parts[0]?.id)
  const ids = parts.map((p) => p.id).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ids` stands for the sections
  useEffect(() => {
    // The section in view is the last one whose top has passed under the bars.
    let frame = 0
    const update = () => {
      frame = 0
      let current = parts[0]?.id
      for (const p of parts) {
        const el = document.getElementById(sectionAnchor(p.id))
        if (el && el.getBoundingClientRect().top <= 200) current = p.id
      }
      setActive(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [ids])
  if (parts.length < 2) return null
  return (
    <nav className="material-bar sticky top-[52px] z-10 -mx-6 mt-6 flex gap-1 overflow-x-auto px-6 py-2 max-sm:-mx-4 max-sm:px-4">
      {parts.map((p) => (
        <a
          key={p.id}
          href={`#${sectionAnchor(p.id)}`}
          onClick={(e) => {
            e.preventDefault()
            document
              .getElementById(sectionAnchor(p.id))
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            setActive(p.id)
          }}
          className={cn(
            'press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2.5 t-callout transition-colors',
            active === p.id ? 'bg-press text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink',
          )}
        >
          {p.label}
          {p.count !== undefined && p.count > 0 && <span className="t-meta text-ink-4">{p.count}</span>}
        </a>
      ))}
    </nav>
  )
}

/** The kit's README: folded to its first screen, all of it on request; managers can edit it. */
function Guide({ kit, editable, save }: { kit: BrandKit; editable: boolean; save: (guide: string) => void }) {
  const t = useT('brands')
  const tc = useT()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(kit.guide)
  const body = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  useEffect(() => setDraft(kit.guide), [kit.guide])
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure when the text changes
  useEffect(() => {
    if (body.current) setTall(body.current.scrollHeight > 460)
  }, [kit.guide, editing])
  if (editing)
    return (
      <div className="max-w-[880px]">
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={18}
          className="font-mono text-[12.5px]"
        />
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              save(draft)
              setEditing(false)
            }}
          >
            {tc('save')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(kit.guide)
              setEditing(false)
            }}
          >
            {tc('cancel')}
          </Button>
        </div>
      </div>
    )
  return (
    <div className="relative max-w-[880px]">
      <div
        ref={body}
        className={cn(
          'overflow-hidden transition-[max-height] duration-300',
          !open && tall && 'max-h-[420px]',
        )}
      >
        <Markdown source={kit.guide} />
      </div>
      {!open && tall && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 h-24 bg-gradient-to-t from-canvas to-transparent" />
      )}
      <div className="mt-2 flex gap-2">
        {tall && (
          <Button
            variant="ghost"
            icon={ChevronDown}
            onClick={() => setOpen((o) => !o)}
            className={open ? '[&_svg]:rotate-180' : ''}
          >
            {open ? t('guide.less') : t('guide.more')}
          </Button>
        )}
        {editable && (
          <Button variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>
            {t('guide.edit')}
          </Button>
        )}
      </div>
    </div>
  )
}

function Guidelines({
  section,
  actions,
}: {
  section: BrandSection
  actions: ReturnType<typeof useAssetActions>
}) {
  const docs = section.groups.flatMap((g) => g.assets).filter((a) => a.media.kind === 'document')
  const rest: BrandSection = {
    ...section,
    groups: section.groups
      .map((g) => ({ ...g, assets: g.assets.filter((a) => !docs.includes(a)) }))
      .filter((g) => g.assets.length),
  }
  return (
    <>
      {docs.length > 0 && <DocumentRows assets={docs} actions={actions} className="mb-8" />}
      {rest.groups.length > 0 && <FrameGrid section={rest} actions={actions} pages />}
    </>
  )
}

/** Files of the fonts folder that aren't fonts (licences): listed under the families. */
function Leftovers({
  section,
  actions,
}: {
  section: BrandSection | undefined
  actions: ReturnType<typeof useAssetActions>
}) {
  if (!section) return null
  const others: BrandSection = {
    ...section,
    groups: section.groups
      .map((g) => ({
        ...g,
        assets: g.assets.filter((a) => !/\.(ttf|otf|ttc|otc|woff2?)$/i.test(primary(a)?.filename ?? '')),
      }))
      .filter((g) => g.assets.length),
  }
  if (!others.groups.length) return null
  return (
    <div className="mt-6">
      <FileList section={others} actions={actions} />
    </div>
  )
}

function Unpacking({ progress }: { progress: NonNullable<BrandKit['unpacking']> }) {
  const t = useT('brands')
  return (
    <div className="mb-6 rounded-panel bg-panel p-4 shadow-[inset_0_0_0_1px_var(--line)]">
      <p className="t-callout text-ink">
        {progress.total
          ? t('unpacking', { done: progress.done, total: progress.total })
          : t('unpackingStart')}
      </p>
      <ProgressBar
        value={progress.total ? progress.done / progress.total : null}
        className="mt-3"
        tone="review"
      />
    </div>
  )
}

function DropHint() {
  const t = useT('brands')
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[52px] bottom-0 z-30 grid place-items-center bg-[color-mix(in_oklab,var(--canvas)_70%,transparent)] backdrop-blur-[2px]">
      <div className="floating rounded-sheet px-6 py-4 text-center">
        <FolderUp size={22} className="mx-auto text-ink-2" />
        <p className="mt-2 t-headline text-ink">{t('drop.title')}</p>
        <p className="mt-0.5 t-caption text-ink-3">{t('drop.body')}</p>
      </div>
    </div>
  )
}

/** An empty kit: drop the kit's folder or its .zip, or choose one. */
function KitDrop({ project, canUpload }: { project: Project; canUpload: boolean }) {
  const t = useT('brands')
  const folder = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const add = async (list: File[]) => {
    if (!list.length) return
    toast.info(t('adding', { count: list.length }))
    await uploadMedia(list, { projectId: project.id })
  }
  if (!canUpload) return null
  return (
    <div className="rounded-panel border border-line-strong border-dashed px-6 py-16">
      <input
        ref={folder}
        type="file"
        hidden
        // @ts-expect-error: not in React's types, every browser has it
        webkitdirectory=""
        onChange={(e) => {
          const l = [...(e.target.files ?? [])]
          e.target.value = ''
          void add(l)
        }}
      />
      <input
        ref={files}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const l = [...(e.target.files ?? [])]
          e.target.value = ''
          void add(l)
        }}
      />
      <EmptyState
        icon={FolderUp}
        title={t('empty.title')}
        body={t('empty.body')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={FolderUp} onClick={() => folder.current?.click()}>
              {t('empty.folder')}
            </Button>
            <Button icon={Upload} onClick={() => files.current?.click()}>
              {t('empty.files')}
            </Button>
          </div>
        }
      />
    </div>
  )
}
