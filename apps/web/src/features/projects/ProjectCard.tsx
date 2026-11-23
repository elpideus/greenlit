import type { Media, Project } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { Folder, MapPin, SwatchBook } from 'lucide-react'
import { memo } from 'react'
import { Link } from 'react-router'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { formatRelative, useTimeZone } from '@/lib/time'
import { Badge, InlineEdit, type MenuEntry, useContextMenu } from '@/ui'
import { Meta } from './Meta'

/** The newest thumbnails of a project, for the card's contact sheet. */
function useProjectThumbs(p: Project) {
  return useQuery({
    queryKey: ['media', 'project-thumbs', p.id, p.mediaCount],
    queryFn: ({ signal }) =>
      api.get<{ items: Media[] }>('/media', { projectId: p.id, limit: 5, sort: 'recent' }, signal),
    enabled: p.mediaCount > 1 && p.kind !== 'brand',
    staleTime: 60_000,
    select: (r) => r.items.map((m) => m.thumbnailUrl).filter((u): u is string => !!u),
  })
}

/**
 * A project as a contact sheet: the cover large, the two newest frames beside it. No card chrome; the sheet is the
 * card. Hover lifts the frames a touch and brightens the name.
 */
export const ProjectCard = memo(function ProjectCard({
  project: p,
  menu,
  renaming,
  onRename,
  onStopRename,
}: {
  project: Project
  menu: () => MenuEntry[]
  renaming: boolean
  onRename: (name: string) => void
  onStopRename: () => void
}) {
  const t = useT('projects')
  const tz = useTimeZone()
  const ctx = useContextMenu(menu)
  const { data: thumbs } = useProjectThumbs(p)
  const others = (thumbs ?? []).filter((u) => u !== p.coverUrl).slice(0, 2)
  const sheet = others.length >= 2
  const tint = p.color ?? 'var(--ink-3)'

  return (
    <Link
      to={`/projects/${p.id}`}
      className="group block min-w-0 outline-none"
      {...ctx}
      draggable={false}
      onClick={renaming ? (e) => e.preventDefault() : undefined}
    >
      <div
        className={cn(
          'relative grid aspect-[16/10] gap-[3px] overflow-hidden rounded-tile bg-stage transition-[box-shadow] duration-200',
          'group-focus-visible:shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--focus)]',
          sheet ? 'grid-cols-[2fr_1fr] grid-rows-2' : 'grid-cols-1',
        )}
      >
        {p.kind === 'brand' ? (
          <BrandCover project={p} />
        ) : p.coverUrl ? (
          <Frame src={p.coverUrl} className={sheet ? 'row-span-2' : ''} />
        ) : (
          <div
            className="grid place-items-center"
            style={{ background: `color-mix(in oklab, ${tint} 14%, var(--panel))` }}
          >
            <Folder
              size={28}
              strokeWidth={1.4}
              style={{ color: `color-mix(in oklab, ${tint} 70%, var(--ink-3))` }}
            />
          </div>
        )}
        {sheet && others.map((u) => <Frame key={u} src={u} />)}
        {p.archivedAt && (
          <span className="absolute top-2 left-2">
            <Badge className="force-dark bg-black/55 text-white/90 backdrop-blur-md">
              {t('archivedBadge')}
            </Badge>
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 px-0.5">
        {p.color && <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />}
        <InlineEdit
          value={p.name}
          editing={renaming}
          tooltip={null}
          disabled
          onEditingChange={(e) => !e && onStopRename()}
          onSave={onRename}
          className="t-headline text-ink"
        />
      </div>
      <div className="mt-1 flex items-center gap-3 px-0.5 t-caption text-ink-3">
        <Meta className="flex-1">
          {p.kind === 'brand' && (
            <span>{p.brand?.families.length ? p.brand.families.join(' · ') : t('kit')}</span>
          )}
          <span className="tabular">
            {t(p.kind === 'brand' ? 'files' : 'media', { count: p.mediaCount })}
          </span>
          {p.compositionCount > 0 && (
            <span className="tabular">{t('edits', { count: p.compositionCount })}</span>
          )}
          {p.sizeBytes > 0 && <span className="tabular">{formatBytes(p.sizeBytes)}</span>}
        </Meta>
        <span className="shrink-0">{formatRelative(p.updatedAt, tz)}</span>
      </div>
      {p.places.length > 0 && (
        <div className="mt-1 flex min-w-0 items-center gap-1 px-0.5 t-caption text-ink-3">
          <MapPin size={11} className="shrink-0" />
          <span className="truncate">{p.places.map((pl) => pl.name).join(', ')}</span>
        </div>
      )}
    </Link>
  )
})

/** A brand kit's card: its main logo on the colour it is made for, its palette along the bottom edge. */
function BrandCover({ project: p }: { project: Project }) {
  const logo = p.brand?.logo
  const colors = p.brand?.colors ?? []
  const bg = logo?.background ?? (logo?.surface === 'light' ? '#EEEEEE' : (colors[0] ?? 'var(--stage)'))
  return (
    <div className="relative grid place-items-center overflow-hidden" style={{ background: bg }}>
      {logo ? (
        <img
          src={logo.url}
          alt=""
          loading="lazy"
          draggable={false}
          className="max-h-[42%] max-w-[64%] object-contain transition-transform duration-700 ease-out group-hover:scale-[1.035]"
        />
      ) : (
        <SwatchBook size={28} strokeWidth={1.4} className="text-white/40" />
      )}
      {colors.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 flex h-2.5">
          {colors.map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
      )}
    </div>
  )
}

function Frame({ src, className }: { src: string; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden bg-stage', className)}>
      <img
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.035]"
      />
    </div>
  )
}
