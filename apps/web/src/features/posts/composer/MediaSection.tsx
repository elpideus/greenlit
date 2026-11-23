import { Image as ImageIcon, Plus, X } from 'lucide-react'
import { Reorder } from 'motion/react'
import { useState } from 'react'
import { MediaPicker } from '@/components/MediaPicker'
import { formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { Tooltip } from '@/ui'
import { Panel } from './bits'
import { useComposer } from './state'

/** The post's media, in order: drag to reorder, add from the library or the device, remove. */
export function MediaSection() {
  const t = useT('posts')
  const c = useComposer()
  const [picking, setPicking] = useState(false)
  const byId = new Map(c.media.map((m) => [m.mediaId, m]))
  return (
    <Panel
      title={t('composer.media')}
      hint={t('composer.mediaHint')}
      aside={
        c.media.length > 1 && (
          <span className="t-caption text-ink-3">{t('composer.carousel', { count: c.media.length })}</span>
        )
      }
    >
      <Reorder.Group
        axis="x"
        values={c.draft.media.map((m) => m.mediaId)}
        onReorder={(ids: string[]) => c.update((d) => ({ ...d, media: ids.map((mediaId) => ({ mediaId })) }))}
        className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-1"
      >
        {c.draft.media.map((m, i) => {
          const item = byId.get(m.mediaId)
          const f = item?.formats[0]
          return (
            <Reorder.Item
              key={m.mediaId}
              value={m.mediaId}
              drag={c.editable ? 'x' : false}
              whileDrag={{ scale: 1.05, zIndex: 2, boxShadow: '0 16px 40px -12px rgba(0,0,0,.6)' }}
              className="group relative w-[118px] shrink-0 cursor-grab touch-pan-y active:cursor-grabbing"
            >
              <div className="relative aspect-square overflow-hidden rounded-tile bg-stage">
                {item?.thumbnailUrl || f?.posterUrl ? (
                  <img
                    src={item?.thumbnailUrl ?? f?.posterUrl ?? ''}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-[#5c605d]">
                    <ImageIcon size={20} strokeWidth={1.5} />
                  </span>
                )}
                <span className="force-dark absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-black/55 t-meta text-[10px] text-white backdrop-blur-md">
                  {i + 1}
                </span>
                {f?.duration ? (
                  <span className="force-dark absolute right-1.5 bottom-1.5 rounded-[4px] bg-black/55 px-1 t-meta text-[10px] text-white backdrop-blur-md">
                    {formatDuration(f.duration)}
                  </span>
                ) : null}
                {c.editable && (
                  <Tooltip label={t('composer.removeMedia')}>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() =>
                        c.update((d) => ({ ...d, media: d.media.filter((x) => x.mediaId !== m.mediaId) }))
                      }
                      className="force-dark press absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100"
                      aria-label={t('composer.removeMedia')}
                    >
                      <X size={13} strokeWidth={2.2} />
                    </button>
                  </Tooltip>
                )}
              </div>
              <div className="mt-1.5 truncate t-caption text-ink-2">
                {item?.title || t('common:untitled')}
              </div>
            </Reorder.Item>
          )
        })}
        {c.editable && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="press grid aspect-square w-[118px] shrink-0 place-items-center rounded-tile text-ink-3 shadow-[inset_0_0_0_1.5px_var(--line-strong)] [background:repeating-linear-gradient(135deg,transparent_0_8px,var(--hover)_8px_9px)] hover:text-ink"
          >
            <span className="flex flex-col items-center gap-1.5 t-caption">
              <Plus size={20} strokeWidth={1.7} />
              {t('composer.addMedia')}
            </span>
          </button>
        )}
      </Reorder.Group>
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        projectId={c.draft.projectId ?? undefined}
        kinds={['video', 'image']}
        onPick={(items) => c.addMedia(items)}
      />
    </Panel>
  )
}
