import { isActive } from '@greenlit/composition'
import type { Media } from '@greenlit/shared'
import {
  Circle,
  Code2,
  Eye,
  EyeOff,
  Layers as LayersIcon,
  Library,
  Lock,
  Plus,
  Square,
  SquareDashed,
  Type,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { MediaPicker } from '@/components/MediaPicker'
import { MediaThumb } from '@/components/MediaThumb'
import { useMediaList } from '@/data/media'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { Button, EmptyState, Menu, type MenuEntry, Segmented, Skeleton, toast, useContextMenu } from '@/ui'
import { type AssetSource, compositionApi } from '../api'
import { mediaClipOps } from '../edits'
import { dispatch, useDoc, useEditor } from '../store'
import { clipActions } from './actions'
import { clipLabel, TYPE_LOOK } from './clipLook'

const get = useEditor.getState

/** Adds library media at the playhead (double-click, the + button, the picker). */
async function addAtPlayhead(items: AssetSource[]) {
  const s = get()
  if (!s.id || !s.doc || s.readOnly) return
  try {
    const assets = await compositionApi.assets(s.id, items)
    const { ops, ids } = mediaClipOps(get().doc!, assets, s.time)
    if (dispatch(ops, { label: 'Add media' })) useEditor.setState({ selection: ids })
  } catch (err) {
    toast.error(err)
  }
}

export function LeftPanel() {
  const t = useT('editor')
  const tab = useEditor((s) => s.leftTab)
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <Segmented
          size="sm"
          value={tab}
          onChange={(v) => useEditor.setState({ leftTab: v })}
          options={[
            { value: 'media', label: t('bin.media') },
            { value: 'layers', label: t('bin.layers') },
          ]}
        />
        <div className="flex-1" />
        <AddMenu />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'media' ? <MediaBin /> : <Layers />}</div>
    </div>
  )
}

function AddMenu() {
  const t = useT('editor')
  const readOnly = useEditor((s) => s.readOnly)
  return (
    <Menu
      align="end"
      width={240}
      trigger={
        <Button size="xs" variant="secondary" icon={Plus} disabled={readOnly}>
          {t('bin.add')}
        </Button>
      }
      items={[
        { label: t('bin.text'), icon: Type, shortcut: 't', onSelect: () => clipActions.add('text') },
        { label: t('bin.rectangle'), icon: Square, onSelect: () => clipActions.add('shape') },
        { label: t('bin.circle'), icon: Circle, onSelect: () => clipActions.add('ellipse') },
        { label: t('bin.solid'), icon: SquareDashed, onSelect: () => clipActions.add('solid') },
        'separator',
        { label: t('bin.code'), icon: Code2, hint: 'HTML', onSelect: () => clipActions.add('html') },
      ]}
    />
  )
}

function MediaBin() {
  const t = useT('editor')
  const projectId = useEditor((s) => s.meta?.projectId ?? null)
  const doc = useDoc()
  const readOnly = useEditor((s) => s.readOnly)
  const [picker, setPicker] = useState(false)
  const list = useMediaList(
    { projectId: projectId ?? undefined, sort: 'recent', limit: 120 },
    { enabled: !!projectId },
  )
  const items = useMemo(
    () =>
      (list.data?.pages.flatMap((p) => p.items) ?? []).filter(
        (m) => m.kind === 'video' || m.kind === 'image' || m.kind === 'audio',
      ),
    [list.data],
  )
  const used = new Set(Object.values(doc?.assets ?? {}).map((a) => a.mediaId))
  return (
    <div className="p-3">
      <Button
        size="sm"
        variant="ghost"
        icon={Library}
        className="mb-2 w-full justify-start"
        disabled={readOnly}
        onClick={() => setPicker(true)}
      >
        {t('bin.addLibrary')}
      </Button>
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <span className="t-micro text-ink-3">{t('bin.project')}</span>
        <span className="t-meta text-ink-4">{items.length}</span>
      </div>
      {list.isLoading ? (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <Skeleton key={i} className="aspect-video rounded-tile" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState compact title={t('bin.media')} body={t('bin.emptyProject')} />
      ) : (
        <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
          {items.map((m) => (
            <BinItem key={m.id} media={m} used={used.has(m.id)} readOnly={readOnly} />
          ))}
        </div>
      )}
      <p className="mt-3 px-0.5 t-micro text-ink-4">{t('bin.dragHint')}</p>
      <MediaPicker
        open={picker}
        onOpenChange={setPicker}
        projectId={projectId}
        kinds={['video', 'image', 'audio']}
        onPick={(picked) => void addAtPlayhead(picked.map((m) => ({ mediaId: m.id })))}
      />
    </div>
  )
}

/** "Add …" for each version of an item (the main one first), when it has several. */
function versionEntries(media: Media, t: ReturnType<typeof useT>): MenuEntry[] {
  if (media.versions.length < 2) return []
  return [
    { group: t('bin.addVersion') },
    ...media.versions.map((v) => ({
      label: v.label || t('bin.mainVersion'),
      hint: v.key || !v.label ? undefined : t('bin.mainVersion'),
      onSelect: () => void addAtPlayhead([{ mediaId: media.id, ...(v.key ? { version: v.key } : {}) }]),
    })),
  ]
}

function BinItem({ media, used, readOnly }: { media: Media; used: boolean; readOnly: boolean }) {
  const t = useT('editor')
  const versions = media.versions.length
  const menu = useContextMenu(() => versionEntries(media, t), { disabled: readOnly })
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        {...menu}
        draggable={!readOnly}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'copy'
          e.dataTransfer.setData(
            'application/x-greenlit-media',
            JSON.stringify([{ mediaId: media.id, kind: media.kind }]),
          )
        }}
        onDoubleClick={() => void addAtPlayhead([{ mediaId: media.id }])}
        className="press group w-full min-w-0 text-left"
        title={media.title}
      >
        <div className="relative">
          <MediaThumb media={media} className="aspect-video" scrub showDuration />
          {used && (
            <span className="absolute top-1.5 left-1.5 size-1.5 rounded-full bg-signal shadow-[0_0_0_1.5px_rgba(0,0,0,.5)]" />
          )}
        </div>
        <div className="mt-1 truncate t-micro text-ink-2 group-hover:text-ink">
          {media.title || media.formats[0]?.filename}
        </div>
      </button>
      {versions > 1 && (
        <Menu
          align="end"
          width={220}
          items={versionEntries(media, t)}
          trigger={
            <button
              type="button"
              disabled={readOnly}
              aria-label={t('bin.versions', { count: versions })}
              title={t('bin.versions', { count: versions })}
              className="force-dark press absolute top-1.5 right-1.5 flex h-[20px] items-center gap-1 rounded-[6px] bg-black/55 px-1.5 t-meta text-[11px] text-white/90 backdrop-blur-md hover:bg-black/75"
            >
              <LayersIcon size={11} strokeWidth={2} aria-hidden />
              {versions}
            </button>
          }
        />
      )}
    </div>
  )
}

/** What is on screen at the playhead, top first: click to select, toggle visibility and lock. */
function Layers() {
  const t = useT('editor')
  const doc = useDoc()
  const time = useEditor((s) => s.time)
  const selection = useEditor((s) => s.selection)
  if (!doc) return null
  const rows = [...doc.tracks]
    .reverse()
    .filter((tr) => tr.kind === 'visual')
    .flatMap((tr) => tr.clips.filter((c) => isActive({ ...c, hidden: false }, time)).map((c) => ({ c, tr })))
  const audio = doc.tracks
    .filter((tr) => tr.kind === 'audio')
    .flatMap((tr) => tr.clips.filter((c) => isActive(c, time)).map((c) => ({ c, tr })))
  const all = [...rows, ...audio]
  if (!all.length) return <EmptyState compact title={t('bin.layers')} body={t('bin.noLayers')} />
  return (
    <div className="p-2">
      <div className="px-1.5 pt-1 pb-2 t-micro text-ink-3">{t('bin.layersHint')}</div>
      {all.map(({ c, tr }) => {
        const look = TYPE_LOOK[c.type]
        const Icon = look.icon
        const asset = c.assetId ? doc.assets[c.assetId] : undefined
        const on = selection.includes(c.id)
        return (
          <div
            key={c.id}
            onClick={() => useEditor.setState({ selection: [c.id], rightTab: 'inspector' })}
            onKeyDown={() => {}}
            className={cn(
              'group flex h-9 cursor-default items-center gap-2.5 rounded-[8px] px-2',
              on ? 'bg-signal-soft' : 'hover:bg-hover',
              (c.hidden || tr.hidden) && 'opacity-50',
            )}
          >
            <span
              className="grid size-6 place-items-center rounded-[6px]"
              style={{ background: `color-mix(in oklab, ${look.tint} 22%, transparent)`, color: look.tint }}
            >
              <Icon size={12} strokeWidth={2} />
            </span>
            <span className={cn('min-w-0 flex-1 truncate t-caption', on ? 'text-ink' : 'text-ink-2')}>
              {clipLabel(c, asset)}
            </span>
            {c.locked && <Lock size={12} className="text-ink-3" />}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                clipActions.toggle(c.id, 'hidden')
              }}
              className="press grid size-6 place-items-center rounded-[5px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink"
              aria-label={c.hidden ? t('timeline.show') : t('timeline.hide')}
            >
              {c.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export { formatDuration }
