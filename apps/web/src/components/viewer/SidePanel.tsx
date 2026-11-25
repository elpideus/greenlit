import type { Media, MediaFormat } from '@greenlit/shared'
import { ArrowUpRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Slot, useSlot } from '@/app/Slot'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { Tabs } from '@/ui'
import { useViewer } from './store'

export type PanelProps = { media: Media; format: MediaFormat }

/**
 * The viewer's right panel: the decision (review) on top, then the tabs features add through `media.panels`
 * (Notes, Info, History, Links, Posts…). The tab follows `?tab=` and the viewer store (features bring their tab
 * forward by setting `tab`). For a Slides item, the decision is the Slides item's (`owner`) and the tabs are about
 * the page on screen, named under it.
 */
export function SidePanel({
  media,
  format,
  owner,
  slide,
  className,
}: PanelProps & {
  owner?: Media
  slide?: { index: number; total: number }
  className?: string
}) {
  const t = useT('viewer')
  const entries = useSlot<PanelProps>('media.panels', { media, format })
  const [params, setParams] = useSearchParams()
  const storeTab = useViewer((s) => s.tab)
  const set = useViewer((s) => s.set)
  const fromUrl = params.get('tab')
  const ids = entries.map((e) => e.id)
  const current =
    (storeTab && ids.includes(storeTab) ? storeTab : null) ??
    (fromUrl && ids.includes(fromUrl) ? fromUrl : null) ??
    ids[0] ??
    null
  const active = entries.find((e) => e.id === current)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!current) return
    const next = new URLSearchParams(params)
    if (next.get('tab') === current) return
    next.set('tab', current)
    next.delete('comment')
    setParams(next, { replace: true })
  }, [current])

  const C = active?.component
  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="shrink-0">
        <Slot name="media.decision" props={{ media: owner ?? media }} />
      </div>
      {slide && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2.5">
          <span className="shrink-0 t-meta text-ink-3 tabular-nums">
            {t('slides.slideOf', { position: slide.index + 1, total: slide.total })}
          </span>
          <span className="min-w-0 flex-1 truncate t-callout text-ink">
            {media.title || t('common:untitled')}
          </span>
          <Link
            to={`/media/${media.id}`}
            className="press flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 t-meta text-ink-3 hover:bg-hover hover:text-ink"
          >
            {t('slides.openAlone')}
            <ArrowUpRight size={12} />
          </Link>
        </div>
      )}
      {entries.length > 1 && (
        <div className="shrink-0 border-b border-line px-5">
          <Tabs
            value={current ?? ''}
            onChange={(v) => set({ tab: v })}
            tabs={entries.map((e) => ({
              value: e.id,
              label: t(`${e.feature}:${e.label ?? e.id}`, { defaultValue: e.label ?? e.id }),
              count: e.id === 'comments' && media.openCommentCount ? media.openCommentCount : null,
            }))}
          />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {C && (
            <motion.div
              key={current}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease }}
              className="absolute inset-0 flex flex-col"
            >
              <C media={media} format={format} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
