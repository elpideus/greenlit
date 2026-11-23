import type { Media } from '@greenlit/shared'
import { Check, Layers, MessageSquare } from 'lucide-react'
import { memo } from 'react'
import { MediaThumb } from '@/components/MediaThumb'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { InlineEdit, Tally, Tooltip, toneFor } from '@/ui'
import { pressEvent, useLongPress } from './longPress'

export interface TileHandlers {
  onClick: (m: Media, e: React.MouseEvent) => void
  onOpen: (m: Media) => void
  onToggle: (m: Media, e: React.MouseEvent) => void
  onContextMenu: (m: Media, e: React.MouseEvent) => void
  onRename: (m: Media, title: string | null) => void
  onStartRename: (m: Media) => void
}

/**
 * One media item in the grid: the frame edge to edge (no card), one meta row under it. Selection is a 2 px signal
 * ring and a lit check; the frame settles in slightly, like a slide pressed into a light table.
 */
export const MediaTile = memo(function MediaTile({
  media,
  selected,
  selecting,
  focused,
  fit,
  renaming,
  canRename,
  transitionName,
  handlers,
}: {
  media: Media
  selected: boolean
  selecting: boolean
  focused: boolean
  fit: 'cover' | 'contain'
  renaming: boolean
  canRename: boolean
  transitionName?: string
  handlers: TileHandlers
}) {
  const t = useT('browser')
  const tc = useT()
  const formats = media.formats.length
  const press = useLongPress((x, y) => handlers.onContextMenu(media, pressEvent(x, y)))
  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      data-media-id={media.id}
      className="group relative min-w-0 select-none"
      onContextMenu={(e) => handlers.onContextMenu(media, e)}
      {...press}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the grid handles keys (arrows, Enter, F2) */}
      <div
        className={cn(
          'relative rounded-tile transition-[box-shadow,transform] duration-200 ease-out',
          selected
            ? 'scale-[0.955] shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--signal)]'
            : focused
              ? 'shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--line-strong)]'
              : '',
        )}
        onClick={(e) => handlers.onClick(media, e)}
        onDoubleClick={() => handlers.onOpen(media)}
      >
        <MediaThumb
          media={media}
          fit={fit}
          scrub
          className="aspect-[16/10] w-full"
          viewTransitionName={transitionName}
        />
        {/* top shade so the check reads on bright frames */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-14 rounded-t-tile bg-gradient-to-b from-black/35 to-transparent opacity-0 transition-opacity duration-150',
            (selecting || selected) && 'opacity-100',
            'hover-device:group-hover:opacity-100',
          )}
        />
        <button
          type="button"
          aria-label={selected ? t('selection.clear') : t('selection.selectAll')}
          onClick={(e) => {
            e.stopPropagation()
            handlers.onToggle(media, e)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={cn(
            'press absolute top-2 left-2 grid size-[22px] place-items-center rounded-full transition-[opacity,background-color,box-shadow] duration-150',
            selected
              ? 'bg-signal text-signal-ink opacity-100 shadow-[0_1px_4px_rgba(0,0,0,.35)]'
              : cn(
                  'text-transparent shadow-[inset_0_0_0_1.75px_rgba(255,255,255,.9),0_1px_3px_rgba(0,0,0,.3)] hover:bg-white/20',
                  selecting ? 'opacity-100' : 'opacity-0 hover-device:group-hover:opacity-100',
                ),
          )}
        >
          <Check size={13} strokeWidth={3} />
        </button>
        {formats > 1 && (
          <Tooltip label={t('formats', { count: formats })}>
            <span className="force-dark absolute top-2 right-2 flex h-[22px] items-center gap-1 rounded-[6px] bg-black/55 px-1.5 t-meta text-[11px] text-white/90 backdrop-blur-md">
              <Layers size={11} strokeWidth={2} />
              {formats}
            </span>
          </Tooltip>
        )}
      </div>
      <div className="mt-2 flex h-5 items-center gap-2 px-0.5">
        <Tooltip label={tc(`status.${media.status}`)}>
          <span className="flex">
            <Tally tone={toneFor(media.status)} size={7} />
          </span>
        </Tooltip>
        <InlineEdit
          value={media.title}
          placeholder={tc('untitled')}
          editing={renaming}
          disabled={!canRename}
          tooltip={null}
          onEditingChange={(e) => (e ? handlers.onStartRename(media) : handlers.onRename(media, null))}
          onSave={(v) => handlers.onRename(media, v)}
          className="t-callout text-ink"
        />
        <span className="flex-1" />
        {media.openCommentCount > 0 && (
          <Tooltip label={t('notes', { count: media.openCommentCount })}>
            <span className="flex shrink-0 items-center gap-1 t-meta text-review">
              <MessageSquare size={11} strokeWidth={2} />
              {media.openCommentCount}
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  )
})
