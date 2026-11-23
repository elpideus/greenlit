import {
  aspectLabel,
  type DepthNear,
  depthMapFor,
  depthMismatch,
  type Media,
  type MediaFormat,
} from '@greenlit/shared'
import { AlertTriangle, Download, Eye, Mountain, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { droppedFiles } from '@/lib/dom'
import { formatBytes, formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { qk, queryClient } from '@/lib/query'
import { useCan } from '@/lib/session'
import { Button, confirm, IconButton, ProgressRing, Segmented, Tooltip, toast } from '@/ui'
import { generateDepth, generatedState, useDepthJob } from './generate'
import { useDepthView } from './store'
import { addDepthFile, addDepthMap, formatName } from './Tool'

/**
 * In the viewer's Info tab, for the format on screen: its depth map (what it is, which end is near, whether it lines
 * up with the picture) and adding, replacing, downloading or removing it. A file dropped on the section is added.
 */
export function DepthSection({ media, format }: { media: Media; format: MediaFormat }) {
  const t = useT('depth')
  const canUpload = useCan('media.upload')
  const canEdit = useCan('media.edit')
  const setView = useDepthView((s) => s.setView)
  const found = depthMapFor(media, format)
  const map = found?.map
  const drop = useRef<HTMLElement>(null)
  const [over, setOver] = useState(false)
  const job = useDepthJob(media, format)

  // Files dropped here are this format's depth map; the drop stops here (the page around may take drops too).
  useEffect(() => {
    const el = drop.current
    if (!el || !canUpload) return
    const files = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      e.stopPropagation()
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!files(e) || el.contains(e.relatedTarget as Node | null)) return
      e.stopPropagation()
      setOver(false)
    }
    const dropped = (e: DragEvent) => {
      if (!files(e) || !e.dataTransfer) return
      e.preventDefault()
      e.stopPropagation()
      setOver(false)
      void droppedFiles(e.dataTransfer).then((list) => {
        if (list[0]) void addDepthFile(media, format, list[0], t)
      })
    }
    el.addEventListener('dragenter', enter)
    el.addEventListener('dragover', enter)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', dropped)
    return () => {
      el.removeEventListener('dragenter', enter)
      el.removeEventListener('dragover', enter)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', dropped)
    }
  }, [media, format, canUpload, t])

  if (!map && !canUpload) return null
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
    void queryClient.invalidateQueries({ queryKey: qk.media() })
  }
  const setNear = async (near: DepthNear) => {
    if (!map) return
    try {
      await api.patch(`/media/${media.id}/formats/${map.id}`, { near })
      refresh()
    } catch (err) {
      toast.error(err)
    }
  }
  const remove = async () => {
    if (!map) return
    if (
      !(await confirm({
        title: t('removeConfirm', { format: formatName(media, format) }),
        body: t('removeBody'),
        confirm: t('remove'),
        danger: true,
      }))
    )
      return
    try {
      await api.delete(`/media/${media.id}/formats/${map.id}`)
      toast.done(t('removed', { format: formatName(media, format) }))
      if (useDepthView.getState().view !== 'picture') setView('picture')
      refresh()
    } catch (err) {
      toast.error(err)
    }
  }
  const show = () => setView(useDepthView.getState().last)

  const busy = map && (map.processing.state === 'pending' || map.processing.state === 'processing')
  const generated =
    map && found
      ? generatedState(
          map,
          found.inherited ? (media.formats.find((f) => f.key === format.key) ?? format) : format,
        )
      : null
  const mismatch = map ? depthMismatch(format, map) : null
  const details = map
    ? [
        map.width && map.height ? `${map.width} × ${map.height}` : null,
        map.depth?.float ? t('float') : map.depth?.bitDepth ? t('bits', { n: map.depth.bitDepth }) : null,
        map.kind === 'video' && map.duration ? formatDuration(map.duration) : null,
        formatBytes(map.size),
      ].filter(Boolean)
    : []

  return (
    <section
      ref={drop}
      className={cn(
        'relative -mx-2 flex flex-col gap-2.5 rounded-tile px-2 py-1 transition-colors duration-150',
        over && 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--signal)]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-label">
          {t('title')} <span className="font-normal text-ink-3">· {format.label}</span>
        </h3>
        {map && !found.inherited && (
          <div className="flex items-center gap-0.5">
            {canUpload && !job && (
              <IconButton
                size="xs"
                icon={Sparkles}
                label={map.depth?.generated ? t('gen.again') : t('gen.instead')}
                onClick={() => void generateDepth(media, format, t, formatName(media, format))}
              />
            )}
            {canUpload && (
              <IconButton
                size="xs"
                icon={RefreshCw}
                label={t('replace', { format: format.label })}
                onClick={() => void addDepthMap(media, format, t)}
              />
            )}
            <IconButton
              size="xs"
              icon={Download}
              label={t('download')}
              onClick={() => window.open(map.urls.download, '_self')}
            />
            {canEdit && <IconButton size="xs" icon={Trash2} label={t('remove')} onClick={remove} />}
          </div>
        )}
      </div>

      {job && (
        <div className="flex items-center gap-2.5 rounded-[8px] bg-well px-3 py-2.5 t-caption text-ink-2">
          <ProgressRing value={job.progress} size={16} className="shrink-0 text-signal" />
          <span className="min-w-0 flex-1">
            {job.state === 'queued'
              ? t('gen.queued')
              : t('gen.making', { n: Math.round(job.progress * 100) })}
            {format.kind === 'video' && <span className="block text-ink-3">{t('gen.videoHint')}</span>}
          </span>
        </div>
      )}
      {!map && !job ? (
        <div className="flex flex-col items-start gap-2 rounded-tile border border-dashed border-line-strong px-3.5 py-3">
          <p className="t-caption text-ink-3">
            {format.kind === 'video' ? t('emptyVideo') : t('emptyPicture')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              icon={Sparkles}
              onClick={() => void generateDepth(media, format, t, formatName(media, format))}
            >
              {t('gen.make')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Upload}
              onClick={() => void addDepthMap(media, format, t)}
            >
              {t('addFile')}
            </Button>
          </div>
        </div>
      ) : !map ? null : (
        <>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={show}
              className="press group relative shrink-0 overflow-hidden rounded-[8px] bg-well shadow-[inset_0_0_0_.5px_var(--line)]"
              style={{
                width: 88,
                aspectRatio: map.width && map.height ? `${map.width} / ${map.height}` : '16 / 9',
                maxHeight: 120,
              }}
              title={t('showOnStage')}
            >
              {map.urls.thumbnail ? (
                <img src={map.urls.thumbnail} alt="" className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-ink-3">
                  {busy ? (
                    <ProgressRing value={map.processing.progress} size={16} className="text-signal" />
                  ) : (
                    <Mountain size={18} />
                  )}
                </span>
              )}
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <Eye size={16} />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate t-callout text-ink" title={map.filename}>
                {map.filename}
              </div>
              <div className="t-caption text-ink-3">{busy ? t('preparing') : details.join(' · ')}</div>
              {map.depth?.range && map.processing.state === 'ready' && (
                <Tooltip label={t('rangeHint')}>
                  <div className="mt-0.5 w-fit t-caption text-ink-3">
                    {t(map.depth.curve === 'log' ? 'rangeLog' : 'range', {
                      low: formatValue(map.depth.range[0]),
                      high: formatValue(map.depth.range[1]),
                    })}
                  </div>
                </Tooltip>
              )}
              {generated && (
                <div className="mt-1 flex items-center gap-1 t-caption text-ink-3">
                  <Sparkles size={11} className="shrink-0" />
                  {t('gen.madeBy')}
                </div>
              )}
              {generated?.stale && !job && <div className="mt-1 t-caption text-review">{t('gen.stale')}</div>}
              {found.inherited && <div className="mt-1 t-caption text-ink-2">{t('fromMainHint')}</div>}
              {map.processing.state === 'failed' && (
                <div className="mt-1 t-caption text-cut">{t('unreadable')}</div>
              )}
            </div>
          </div>

          {mismatch && (
            <div className="flex items-start gap-2 rounded-[8px] bg-review-soft px-2.5 py-2 t-caption text-ink-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-review" />
              <span>
                {mismatch.kind === 'shape'
                  ? t('mismatchShape', {
                      picture: aspectLabel(format.width, format.height),
                      depth: aspectLabel(map.width, map.height),
                    })
                  : t('mismatchLength', {
                      picture: formatDuration(mismatch.picture),
                      depth: formatDuration(mismatch.depth),
                    })}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="t-caption text-ink-2">{t('near')}</span>
            {canEdit && !found.inherited ? (
              <Segmented<DepthNear>
                size="sm"
                value={map.depth?.near ?? 'light'}
                onChange={(v) => void setNear(v)}
                options={[
                  { value: 'light', label: <NearLabel near="light" text={t('nearLight')} /> },
                  { value: 'dark', label: <NearLabel near="dark" text={t('nearDark')} /> },
                ]}
              />
            ) : (
              // Set on the map's own format (the main version's, for a borrowed one).
              <span className="t-caption text-ink">
                <NearLabel
                  near={map.depth?.near ?? 'light'}
                  text={map.depth?.near === 'dark' ? t('nearDark') : t('nearLight')}
                />
              </span>
            )}
          </div>
          {found.inherited && canUpload && (
            <Button
              size="sm"
              variant="ghost"
              icon={Upload}
              className="self-start"
              onClick={() => void addDepthMap(media, format, t)}
            >
              {t('addForVersion')}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

/** "Lighter" or "darker", with a swatch that runs from near (left) to far. */
function NearLabel({ near, text }: { near: DepthNear; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-4 rounded-[3px] shadow-[inset_0_0_0_.5px_rgba(0,0,0,.25)]"
        style={{
          background:
            near === 'light' ? 'linear-gradient(90deg,#fff,#111)' : 'linear-gradient(90deg,#111,#fff)',
        }}
      />
      {text}
    </span>
  )
}

const formatValue = (v: number) =>
  Math.abs(v) >= 1000 || Number.isInteger(v)
    ? Math.round(v).toLocaleString()
    : Number(v.toPrecision(3)).toLocaleString()
