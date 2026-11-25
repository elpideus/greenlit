import type { Media, SlideRef } from '@greenlit/shared'
import { SLIDES_MAX } from '@greenlit/shared'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  MessageSquare,
  Minus,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { Reorder } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { MediaPicker } from '@/components/MediaPicker'
import { uploadMedia, useBulkMedia, useSlides } from '@/data/media'
import { cn } from '@/lib/cn'
import { droppedFiles } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { can, useSession } from '@/lib/session'
import {
  IconButton,
  Menu,
  type MenuEntry,
  Spinner,
  Tally,
  Tooltip,
  toast,
  toneFor,
  useContextMenu,
} from '@/ui'

/** Height of a slide in the strip; widths follow each picture's shape. */
const H = 54

/**
 * A Slides item's pages under the stage: click one to show it, drag to reorder, + to add pictures from the library
 * or the device (files dropped on the strip too), right-click a page to move, remove or open it on its own.
 */
export function SlidesStrip({
  set,
  index,
  onSelect,
  compact,
}: {
  set: Media
  index: number
  onSelect: (index: number) => void
  compact?: boolean
}) {
  const t = useT('viewer')
  const me = useSession()
  const navigate = useNavigate()
  const slides = useSlides()
  const bulk = useBulkMedia()
  const pages = set.slides ?? []
  const ids = pages.map((p) => p.mediaId)
  const key = ids.join(',')
  const [order, setOrder] = useState(ids)
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the server's order when it changes
  useEffect(() => setOrder(ids), [key])
  const [picking, setPicking] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [dropping, setDropping] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const canEdit = can(me, 'media.edit') && !me.viaShareLink
  const current = ids[index]
  const byId = new Map(pages.map((p) => [p.mediaId, p]))
  const room = SLIDES_MAX - ids.length

  const save = async (next: string[], done?: string, undo?: string[]) => {
    try {
      await slides.set(set.id, next)
      // Keep showing the same page wherever it went.
      if (current && next.includes(current)) onSelect(next.indexOf(current))
      else onSelect(Math.min(index, Math.max(0, next.length - 1)))
      if (done)
        toast.done(
          done,
          undo ? { action: { label: t('undo'), onClick: () => void slides.set(set.id, undo) } } : undefined,
        )
    } catch (err) {
      setOrder(ids)
      toast.error(err)
    }
  }

  const upload = async (files: File[]) => {
    const pictures = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (!pictures.length) return toast.info(t('slides.onlyPictures'))
    if (pictures.length > room) return toast.info(t('slides.full', { max: SLIDES_MAX }))
    setUploading((n) => n + pictures.length)
    try {
      const added = await uploadMedia(pictures, { slidesId: set.id })
      // Uploads join in the order they finish: put them in the order they were chosen, after the others.
      if (added.length) await slides.set(set.id, [...ids, ...added])
      if (added.length < pictures.length) toast.error(t('slides.someFailed'))
    } catch (err) {
      toast.error(err)
    } finally {
      setUploading((n) => Math.max(0, n - pictures.length))
    }
  }

  const pageMenu = (p: SlideRef): MenuEntry[] => {
    const i = order.indexOf(p.mediaId)
    const move = (to: number) => {
      const next = order.filter((x) => x !== p.mediaId)
      next.splice(to, 0, p.mediaId)
      setOrder(next)
      void save(next)
    }
    const title = p.title || t('common:untitled')
    return [
      { label: t('slides.openAlone'), icon: ArrowUpRight, onSelect: () => navigate(`/media/${p.mediaId}`) },
      canEdit && 'separator',
      canEdit && i > 0 && { label: t('slides.moveLeft'), icon: ArrowLeft, onSelect: () => move(i - 1) },
      canEdit &&
        i < order.length - 1 && {
          label: t('slides.moveRight'),
          icon: ArrowRight,
          onSelect: () => move(i + 1),
        },
      canEdit && 'separator',
      canEdit && {
        label: t('slides.remove'),
        icon: Minus,
        onSelect: () =>
          void save(
            order.filter((x) => x !== p.mediaId),
            t('slides.removed', { title }),
            order,
          ),
      },
      can(me, 'media.delete') && {
        label: t('trash'),
        icon: Trash2,
        danger: true,
        onSelect: async () => {
          try {
            await bulk.mutateAsync({ ids: [p.mediaId], action: 'trash' })
            onSelect(Math.min(index, Math.max(0, ids.length - 2)))
            toast.done(t('trashed', { title }), {
              action: {
                label: t('undo'),
                onClick: () => bulk.mutate({ ids: [p.mediaId], action: 'restore' }),
              },
            })
          } catch (err) {
            toast.error(err)
          }
        },
      },
    ]
  }

  const addItems: MenuEntry[] = [
    { label: t('slides.fromLibrary'), icon: ImageIcon, onSelect: () => setPicking(true) },
    { label: t('slides.upload'), icon: Upload, onSelect: () => fileRef.current?.click() },
  ]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping files is an extra way in; + does the same
    <div
      className={cn(
        'relative shrink-0 border-t border-white/[0.06]',
        compact ? 'px-2 py-2' : 'px-3 py-2.5',
        dropping && 'bg-white/[0.04]',
      )}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={async (e) => {
        if (!canEdit || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(false)
        void upload(await droppedFiles(e.dataTransfer))
      }}
    >
      <div className="flex items-center gap-3">
        {!compact && (
          <div className="flex w-[64px] shrink-0 flex-col items-start gap-0.5 text-white/45">
            <GalleryHorizontalEnd size={15} strokeWidth={1.75} />
            <span className="t-meta tabular-nums">
              {ids.length ? t('place', { position: index + 1, total: ids.length }) : t('slides.none')}
            </span>
          </div>
        )}
        <Reorder.Group
          axis="x"
          values={order}
          onReorder={setOrder}
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1"
        >
          {order.map((id, i) => {
            const p = byId.get(id)
            if (!p) return null
            return (
              <Page
                key={id}
                page={p}
                number={i + 1}
                current={id === current}
                draggable={canEdit}
                onClick={() => onSelect(ids.indexOf(id))}
                onDragEnd={() => {
                  if (order.join(',') !== key) void save(order)
                }}
                menu={() => pageMenu(p)}
              />
            )
          })}
          {uploading > 0 && (
            <div
              className="grid shrink-0 place-items-center rounded-[6px] bg-white/[0.06] text-white/70"
              style={{ height: H, width: H }}
            >
              <Spinner size={18} />
            </div>
          )}
          {canEdit && room > 0 && (
            <Menu
              side="top"
              align="start"
              width={230}
              items={addItems}
              trigger={
                <IconButton
                  icon={Plus}
                  label={t('slides.add')}
                  tooltip="top"
                  className="shrink-0 rounded-[6px] text-white/70 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.16)] hover:text-white"
                  style={{ height: H, width: 40 }}
                />
              }
            />
          )}
        </Reorder.Group>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void upload(files)
        }}
      />
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        kinds={['image', 'video']}
        projectId={set.projectId}
        title={t('slides.pickTitle')}
        confirmLabel={t('slides.pickConfirm')}
        onPick={(items) => {
          const fresh = items.map((m) => m.id).filter((id) => !ids.includes(id))
          if (!fresh.length) return
          if (fresh.length > room) return toast.info(t('slides.full', { max: SLIDES_MAX }))
          void save([...ids, ...fresh], t('slides.added', { count: fresh.length }), ids)
        }}
      />
    </div>
  )
}

function Page({
  page,
  number,
  current,
  draggable,
  onClick,
  onDragEnd,
  menu,
}: {
  page: SlideRef
  number: number
  current: boolean
  draggable: boolean
  onClick: () => void
  onDragEnd: () => void
  menu: () => MenuEntry[]
}) {
  const t = useT('viewer')
  const ctx = useContextMenu(menu)
  const ratio = page.width && page.height ? page.width / page.height : 1
  const width = Math.round(Math.max(30, Math.min(110, H * ratio)))
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [current])
  return (
    <Reorder.Item
      ref={ref}
      value={page.mediaId}
      drag={draggable ? 'x' : false}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.06, zIndex: 2 }}
      className="relative shrink-0 list-none"
      {...ctx}
    >
      <Tooltip label={`${number} · ${page.title || t('common:untitled')}`} side="top">
        <button
          type="button"
          onClick={onClick}
          aria-current={current ? 'true' : undefined}
          aria-label={`${number} · ${page.title || t('common:untitled')}`}
          className={cn(
            'press relative block overflow-hidden rounded-[6px] bg-white/[0.06] transition-[box-shadow,opacity] duration-150',
            current
              ? 'shadow-[0_0_0_2px_var(--stage),0_0_0_3.5px_var(--signal)]'
              : 'opacity-70 hover:opacity-100',
          )}
          style={{ height: H, width }}
        >
          {page.thumbnailUrl ? (
            <img
              src={page.thumbnailUrl}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 size-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-white/30">
              <ImageIcon size={16} strokeWidth={1.5} />
            </span>
          )}
          <span className="absolute bottom-1 left-1 grid h-4 min-w-4 place-items-center rounded-[4px] bg-black/60 px-1 t-meta text-[10px] text-white tabular-nums">
            {number}
          </span>
          {page.openCommentCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 items-center gap-0.5 rounded-[4px] bg-black/60 px-1 t-meta text-[10px] text-review">
              <MessageSquare size={9} strokeWidth={2.2} />
              {page.openCommentCount}
            </span>
          )}
          {page.status !== 'draft' && (
            <span className="absolute top-1 left-1 flex">
              <Tally tone={toneFor(page.status)} size={6} />
            </span>
          )}
        </button>
      </Tooltip>
    </Reorder.Item>
  )
}
