import { DEPTH_ACCEPT, type DepthMatch, type DepthTarget, type Media } from '@greenlit/shared'
import { FileImage, FileVideo, Mountain, Search, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { MediaPicker } from '@/components/MediaPicker'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { droppedFiles } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { qk, queryClient } from '@/lib/query'
import { upload } from '@/lib/uploads'
import { Badge, Button, Checkbox, Dialog, IconButton, Select, Spinner, toast } from '@/ui'
import { fileKind } from './upload'

/** Opens the "Add depth maps" dialog from the library toolbar or ⌘K. */
export const useDepthMatch = create<{
  open: boolean
  projectId: string | null
  show: (p: string | null) => void
  close: () => void
}>((set) => ({
  open: false,
  projectId: null,
  show: (projectId) => set({ open: true, projectId }),
  close: () => set({ open: false }),
}))

/** In the library and project toolbars. */
export function DepthMapsButton({ projectId }: { projectId: string | null }) {
  const t = useT('depth')
  const show = useDepthMatch((s) => s.show)
  return <IconButton icon={Mountain} label={t('match.open')} onClick={() => show(projectId)} />
}

interface Row {
  file: File
  kind: 'image' | 'video' | null
  targets: DepthTarget[]
  /** The chosen target: an index into `targets`, or one picked by hand. */
  choice: number
  picked: DepthTarget | null
  include: boolean
}

const targetOf = (r: Row) => r.picked ?? r.targets[r.choice] ?? null

/** Mounted once: the dialog that matches depth map files to pictures and videos by name, then uploads them. */
export function DepthMatchHost() {
  const { open, projectId, close } = useDepthMatch()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) {
      setRows(null)
      setBusy(false)
    }
  }, [open])
  return (
    <DepthMatchDialog
      open={open}
      onOpenChange={(o) => !o && close()}
      projectId={projectId}
      rows={rows}
      setRows={setRows}
      busy={busy}
      setBusy={setBusy}
    />
  )
}

function DepthMatchDialog({
  open,
  onOpenChange,
  projectId,
  rows,
  setRows,
  busy,
  setBusy,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId: string | null
  rows: Row[] | null
  setRows: (r: Row[] | null | ((prev: Row[] | null) => Row[] | null)) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const t = useT('depth')
  const input = useRef<HTMLInputElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const [picking, setPicking] = useState<number | null>(null)

  const take = async (files: File[]) => {
    const list = files.filter((f) => !f.name.startsWith('.'))
    if (!list.length) return
    setBusy(true)
    try {
      const matches = await api.post<DepthMatch[]>('/media/depth-maps/match', {
        names: list.map((f) => f.name),
        ...(projectId ? { projectId } : {}),
      })
      setRows((prev) => [
        ...(prev ?? []),
        ...list.map((file, i) => {
          const kind = fileKind(file)
          // Only targets of the file's kind; the format that has no depth map yet first.
          const targets = (matches[i]?.targets ?? [])
            .filter((x) => x.kind === kind)
            .sort((a, b) => Number(a.hasDepth) - Number(b.hasDepth))
          return { file, kind, targets, choice: 0, picked: null, include: targets.length > 0 }
        }),
      ])
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  // Drops land here, not on the library behind the dialog.
  useEffect(() => {
    const el = zone.current
    if (!el) return
    const files = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      e.stopPropagation()
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!files(e) || el.contains(e.relatedTarget as Node | null)) return
      setOver(false)
    }
    const drop = (e: DragEvent) => {
      if (!files(e) || !e.dataTransfer) return
      e.preventDefault()
      e.stopPropagation()
      setOver(false)
      void droppedFiles(e.dataTransfer).then(take)
    }
    el.addEventListener('dragenter', enter)
    el.addEventListener('dragover', enter)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    return () => {
      el.removeEventListener('dragenter', enter)
      el.removeEventListener('dragover', enter)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', drop)
    }
  })

  const patch = (i: number, p: Partial<Row>) =>
    setRows((prev) => prev?.map((r, j) => (j === i ? { ...r, ...p } : r)) ?? null)
  const chosen = (rows ?? []).filter((r) => r.include && targetOf(r))
  const unmatched = (rows ?? []).filter((r) => !targetOf(r)).length

  const start = async () => {
    const jobs = chosen.map((r) => ({ file: r.file, target: targetOf(r)! }))
    onOpenChange(false)
    toast.info(t('match.uploading', { count: jobs.length }))
    let ok = 0
    let next = 0
    const lane = async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!
        try {
          await upload(job.file, {
            purpose: 'media.upload',
            label: job.file.name,
            target: {
              mediaId: job.target.mediaId,
              formatKey: job.target.formatKey,
              ...(job.target.version ? { version: job.target.version } : {}),
              depth: true,
            },
          })
          ok++
        } catch {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, lane))
    void queryClient.invalidateQueries({ queryKey: qk.media() })
    if (ok === jobs.length) toast.done(t('match.done', { count: ok }))
    else toast.error(t('match.someFailed', { count: jobs.length - ok, total: jobs.length }))
  }

  const pickedMedia = (m: Media | undefined) => {
    if (picking === null || !m) return
    const f = m.formats.find((x) => x.isPrimary) ?? m.formats[0]
    if (!f || (f.kind !== 'image' && f.kind !== 'video')) return
    patch(picking, {
      include: true,
      picked: {
        mediaId: m.id,
        title: m.title,
        thumbnailUrl: m.thumbnailUrl,
        formatKey: f.key,
        formatLabel: f.label,
        version: '',
        versionLabel: m.versions[0]?.label ?? '',
        kind: f.kind,
        filename: f.filename,
        width: f.width,
        height: f.height,
        hasDepth: m.depthMaps.some((d) => d.key === f.key && d.version === ''),
      },
    })
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('match.title')}
        description={t('match.description')}
        width={rows?.length ? 640 : 480}
        footer={
          rows?.length ? (
            <>
              <span className="mr-auto t-caption text-ink-3">
                {unmatched ? t('match.unmatched', { count: unmatched }) : null}
              </span>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t('common:cancel')}
              </Button>
              <Button variant="primary" icon={Upload} disabled={!chosen.length} onClick={() => void start()}>
                {t('match.start', { count: chosen.length })}
              </Button>
            </>
          ) : undefined
        }
      >
        <div ref={zone} className="flex min-h-0 flex-col gap-3">
          {rows?.length ? (
            <div className="-mx-1 flex max-h-[52dvh] flex-col overflow-y-auto">
              {rows.map((r, i) => (
                <MatchRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows only grow; files may share a name
                  key={i}
                  row={r}
                  onInclude={(include) => patch(i, { include })}
                  onChoice={(choice) => patch(i, { choice, picked: null })}
                  onPick={() => setPicking(i)}
                  onClear={() => patch(i, { picked: null, include: r.targets.length > 0 })}
                />
              ))}
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className={cn(
              'press flex flex-col items-center justify-center gap-1.5 rounded-tile border border-dashed px-4 text-center transition-colors duration-150',
              rows?.length ? 'py-3' : 'py-9',
              over ? 'border-signal bg-signal-soft' : 'border-line-strong hover:bg-hover',
            )}
          >
            {busy ? <Spinner /> : <Mountain size={rows?.length ? 16 : 22} className="text-ink-3" />}
            <span className="t-callout text-ink">{rows?.length ? t('match.more') : t('match.drop')}</span>
            {!rows?.length && <span className="t-caption text-ink-3">{t('match.names')}</span>}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={DEPTH_ACCEPT}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              void take(files)
            }}
          />
        </div>
      </Dialog>
      <MediaPicker
        open={picking !== null}
        onOpenChange={(o) => !o && setPicking(null)}
        multiple={false}
        kinds={picking !== null && rows?.[picking]?.kind ? [rows[picking]!.kind!] : ['image', 'video']}
        projectId={projectId}
        title={t('match.pickTitle', { name: picking !== null ? rows?.[picking]?.file.name : '' })}
        confirmLabel={t('match.pickConfirm')}
        onPick={(items) => {
          pickedMedia(items[0])
          setPicking(null)
        }}
      />
    </>
  )
}

function MatchRow({
  row,
  onInclude,
  onChoice,
  onPick,
  onClear,
}: {
  row: Row
  onInclude: (v: boolean) => void
  onChoice: (i: number) => void
  onPick: () => void
  onClear: () => void
}) {
  const t = useT('depth')
  const target = targetOf(row)
  const KindIcon = row.kind === 'video' ? FileVideo : FileImage
  return (
    <div className="flex items-center gap-3 border-t border-line px-1 py-2.5 first:border-t-0">
      <Checkbox checked={row.include && !!target} disabled={!target} onChange={onInclude} />
      <div className="flex w-[34%] min-w-0 items-center gap-2">
        <KindIcon size={14} className="shrink-0 text-ink-3" />
        <span className="truncate t-callout text-ink" title={row.file.name}>
          {row.file.name}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {target ? (
          <>
            <span className="size-9 shrink-0 overflow-hidden rounded-[6px] bg-well">
              {target.thumbnailUrl && (
                <img src={target.thumbnailUrl} alt="" className="size-full object-cover" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              {row.targets.length > 1 && !row.picked ? (
                <Select
                  size="sm"
                  value={String(row.choice)}
                  onChange={(v) => onChoice(Number(v))}
                  options={row.targets.map((x, i) => ({ value: String(i), label: targetName(x, t) }))}
                  className="w-full"
                />
              ) : (
                <div className="truncate t-callout text-ink">{target.title || t('common:untitled')}</div>
              )}
              <div className="truncate t-caption text-ink-3">
                {[target.formatLabel, target.versionLabel].filter(Boolean).join(' · ')}
              </div>
            </div>
            {target.hasDepth ? (
              <Badge tone="review">{t('match.replaces')}</Badge>
            ) : (
              <Badge tone="signal">{t('match.new')}</Badge>
            )}
            {row.picked && <IconButton size="xs" icon={X} label={t('match.clear')} onClick={onClear} />}
          </>
        ) : (
          <>
            <span className="flex-1 t-caption text-ink-3">
              {row.kind ? t('match.none') : t('match.notDepth')}
            </span>
            {row.kind && (
              <Button size="xs" variant="ghost" icon={Search} onClick={onPick}>
                {t('match.pick')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function targetName(x: DepthTarget, t: ReturnType<typeof useT>) {
  return `${x.title || t('common:untitled')}${x.versionLabel ? ` · ${x.versionLabel}` : ''}`
}
