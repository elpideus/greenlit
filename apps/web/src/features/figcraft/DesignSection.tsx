import { type DesignPage, FIGCRAFT_MIME, type Media } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Ellipsis, ImageDown, Maximize, Type } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { primaryFormat } from '@/data/media'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useCan } from '@/lib/session'
import { IconButton, Menu, type MenuEntry, Skeleton, Tally, toast } from '@/ui'
import { exportFrames, useDesignFonts, useDesignInfo, useFigcraftStatus } from './api'
import { useDesign } from './store'

type Format = 'png' | 'jpg' | 'pdf'

/**
 * The Info tab's design part: the pages and their frames (click one to see it in FigCraft), the fonts the text uses
 * and whether Greenlit has them, and exporting frames as pictures into the project.
 */
export function DesignSection({ media }: { media: Media }) {
  const t = useT('figcraft')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const shownId = useDesign((s) => s.formatId)
  const all = [...media.formats, ...media.versions.flatMap((v) => v.formats)]
  const format = all.find((f) => f.id === shownId) ?? primaryFormat(media)
  const info = useDesignInfo(media.id, format)
  const status = useFigcraftStatus()
  const library = useDesignFonts()
  const phase = useDesign((s) => s.phase)
  const missing = useDesign((s) => s.missingFonts)
  const host = useDesign((s) => s.host)
  const canExport = useCan('media.upload') && !!status.data?.renderer
  const [exporting, setExporting] = useState(false)
  const [open, setOpen] = useState<Record<number, boolean>>({})

  if (!format || format.mime !== FIGCRAFT_MIME) return null
  if (format.processing.state !== 'ready' || info.isLoading)
    return (
      <section>
        <div className="mb-2 t-headline text-ink">{t('section.title')}</div>
        <Skeleton className="h-4 w-2/3" />
      </section>
    )
  const d = info.data
  if (!d) return null

  const live = phase === 'ready' && !!host
  const show = (page: DesignPage, frameId: number) => {
    if (!live) return
    host.showFrame(page.id, frameId).catch((err) => toast.error(err))
  }
  const run = async (frames: number[], as: Format) => {
    setExporting(true)
    try {
      const r = await exportFrames(media.id, {
        formatId: format.id,
        frames,
        format: as,
        scale: as === 'pdf' ? 1 : 2,
      })
      void qc.invalidateQueries({ queryKey: qk.media() })
      toast.done(t('section.exported', { count: r.mediaIds.length }), {
        action: r.mediaIds[0]
          ? { label: t('open'), onClick: () => navigate(`/media/${r.mediaIds[0]}`) }
          : undefined,
      })
    } catch (err) {
      toast.error(err, t('section.exportFailed'))
    } finally {
      setExporting(false)
    }
  }
  const exportItems = (frames: number[]): MenuEntry[] =>
    canExport
      ? [
          { group: t('section.exportAs', { count: frames.length }) },
          { label: t('section.png'), icon: ImageDown, onSelect: () => void run(frames, 'png') },
          { label: t('section.jpg'), icon: ImageDown, onSelect: () => void run(frames, 'jpg') },
          { label: t('section.pdf'), icon: ImageDown, onSelect: () => void run(frames, 'pdf') },
        ]
      : []

  const frameCount = d.pages.reduce((n, p) => n + p.frames.length, 0)
  const known = new Set((library.data ?? []).map((f) => f.family.toLowerCase()))
  const counts = [
    [t('section.layers'), d.layers],
    [t('section.components'), d.components],
    [t('section.styles'), d.styles],
    [t('section.variables'), d.variables],
    [t('section.images'), d.images],
    [t('section.savedVersions'), d.versions],
  ] as const

  return (
    <section>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="t-headline text-ink">{t('section.title')}</span>
        <span className="t-caption text-ink-3">
          {t('section.pages', { count: d.pages.length })} · {t('section.frames', { count: frameCount })}
        </span>
      </div>
      {!live && <p className="mb-2 t-caption text-ink-3">{t('section.clickHint')}</p>}

      <div className="-mx-2 flex flex-col">
        {d.pages.map((page, pi) => {
          const expanded = open[page.id] ?? pi === 0
          return (
            <div key={page.id}>
              <div className="group flex items-center gap-1 rounded-control pr-1 hover:bg-hover">
                <button
                  type="button"
                  className="press flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-2 text-left"
                  onClick={() => setOpen((o) => ({ ...o, [page.id]: !expanded }))}
                  aria-expanded={expanded}
                >
                  <ChevronRight
                    size={13}
                    className={cn(
                      'shrink-0 text-ink-3 transition-transform duration-150',
                      expanded && 'rotate-90',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate t-callout text-ink">
                    {page.name || t('section.page')}
                  </span>
                  <span className="t-meta text-ink-3">{page.frames.length}</span>
                </button>
                {canExport && page.frames.length > 0 && (
                  <Menu
                    align="end"
                    width={220}
                    items={exportItems(page.frames.map((f) => f.id))}
                    trigger={
                      <IconButton
                        icon={ImageDown}
                        size="xs"
                        label={t('section.exportPage')}
                        disabled={exporting}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      />
                    }
                  />
                )}
              </div>
              {expanded && (
                <ul className="mb-1 flex flex-col">
                  {page.frames.map((f) => (
                    <li
                      key={f.id}
                      className="group/frame flex items-center gap-1 rounded-control pr-1 hover:bg-hover"
                    >
                      <button
                        type="button"
                        disabled={!live}
                        onClick={() => show(page, f.id)}
                        className="press flex min-w-0 flex-1 items-center gap-2 py-1 pl-7 text-left disabled:cursor-default"
                        title={live ? t('section.showFrame') : undefined}
                      >
                        <span className="min-w-0 flex-1 truncate t-callout text-ink-2">
                          {f.name || f.type}
                        </span>
                        <span className="shrink-0 t-meta text-ink-3">
                          {Math.round(f.width)} × {Math.round(f.height)}
                        </span>
                      </button>
                      {(live || canExport) && (
                        <Menu
                          align="end"
                          width={220}
                          items={[
                            live && {
                              label: t('section.showFrame'),
                              icon: Maximize,
                              onSelect: () => show(page, f.id),
                            },
                            ...exportItems([f.id]),
                          ]}
                          trigger={
                            <IconButton
                              icon={Ellipsis}
                              size="xs"
                              label={t('common:more')}
                              className="opacity-0 group-hover/frame:opacity-100 focus-visible:opacity-100"
                            />
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {d.fonts.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 t-label">{t('section.fonts')}</div>
          <ul className="flex flex-col gap-1">
            {d.fonts.map((family) => {
              const isMissing = live ? missing.includes(family) : false
              const inGreenlit = known.has(family.toLowerCase())
              return (
                <li key={family} className="flex items-center gap-2 t-callout">
                  <Type size={13} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-ink">{family}</span>
                  {isMissing ? (
                    <span className="flex items-center gap-1.5 t-caption text-ink-3">
                      <Tally tone="changes" size={7} />
                      {t('section.fontMissing')}
                    </span>
                  ) : inGreenlit ? (
                    <span className="t-caption text-ink-3">{t('section.fontInGreenlit')}</span>
                  ) : live ? (
                    <span className="t-caption text-ink-3">{t('section.fontBuiltIn')}</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 t-callout">
        {counts
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="t-meta text-[12px] text-ink">{n}</dd>
            </div>
          ))}
        <dt className="text-ink-3">{t('section.preview')}</dt>
        <dd className="text-ink">{t(`section.rendered.${d.rendered}`)}</dd>
      </dl>
    </section>
  )
}
