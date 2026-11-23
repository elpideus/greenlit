import type { Media, MediaKind } from '@greenlit/shared'
import { Check, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { uploadMedia, useMediaList } from '@/data/media'
import { useProjects } from '@/data/projects'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Button, Dialog, EmptyState, SearchInput, Segmented, Select, Skeleton, toast } from '@/ui'
import { MediaThumb } from './MediaThumb'

/**
 * Choose media from the library (comment attachments, post media, editor assets, project covers).
 * Upload new files from here too: they land in the library (in `projectId` when given) and are picked.
 */
export function MediaPicker({
  open,
  onOpenChange,
  onPick,
  multiple = true,
  kinds,
  projectId,
  title,
  confirmLabel,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onPick: (items: Media[]) => void
  multiple?: boolean
  kinds?: MediaKind[]
  projectId?: string | null
  title?: string
  confirmLabel?: string
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'project' | 'all'>(projectId ? 'project' : 'all')
  const [project, setProject] = useState<string | null>(projectId ?? null)
  const [picked, setPicked] = useState<Map<string, Media>>(new Map())
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: projects } = useProjects()
  const kind = kinds?.length === 1 ? kinds[0] : undefined
  const list = useMediaList(
    { q: q || undefined, projectId: scope === 'project' && project ? project : undefined, kind, sort: 'recent', limit: 90 },
    { enabled: open },
  )
  const items = useMemo(
    () => (list.data?.pages.flatMap((p) => p.items) ?? []).filter((m) => !kinds || kinds.includes(m.kind)),
    [list.data, kinds],
  )

  const toggle = (m: Media) => {
    setPicked((prev) => {
      const next = new Map(multiple ? prev : [])
      if (next.has(m.id)) next.delete(m.id)
      else next.set(m.id, m)
      return next
    })
  }
  const finish = (chosen: Media[]) => {
    onPick(chosen)
    setPicked(new Map())
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={880}
      title={title ?? 'Choose from the library'}
      footer={
        <>
          <input
            ref={fileRef}
            type="file"
            multiple={multiple}
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (!files.length) return
              toast.info(`Uploading ${files.length === 1 ? files[0]!.name : `${files.length} files`}`)
              const ids = await uploadMedia(files, { projectId: project ?? projectId ?? null })
              await list.refetch()
              const fresh = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((m) => ids.includes(m.id))
              if (fresh.length) finish(fresh)
            }}
          />
          <Button variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()} className="mr-auto">
            Upload from this device
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={!picked.size} onClick={() => finish([...picked.values()])}>
            {confirmLabel ?? (picked.size > 1 ? `Add ${picked.size} items` : 'Add')}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} className="w-64" autoFocus />
        {projectId !== undefined && (
          <Segmented
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'project', label: 'This project' },
              { value: 'all', label: 'Everything' },
            ]}
          />
        )}
        {projectId === undefined && (
          <Select
            size="sm"
            value={project ?? 'all'}
            onChange={(v) => {
              setProject(v === 'all' ? null : v)
              setScope(v === 'all' ? 'all' : 'project')
            }}
            options={[{ value: 'all', label: 'All projects' }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]}
            className="w-52"
          />
        )}
      </div>
      {list.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {Array.from({ length: 12 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <Skeleton key={i} className="aspect-video rounded-tile" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState compact title="Nothing here yet" body="Upload from this device, or search everything." />
      ) : (
        <div className="grid max-h-[52dvh] grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-4 overflow-y-auto p-0.5">
          {items.map((m) => {
            const on = picked.has(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m)}
                onDoubleClick={() => finish([m])}
                className="press group text-left"
              >
                <div className={cn('relative rounded-tile transition-shadow duration-150', on && 'shadow-[0_0_0_2px_var(--signal)]')}>
                  <MediaThumb media={m} className="aspect-video" />
                  <span
                    className={cn(
                      'absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full transition-all duration-150',
                      on ? 'bg-signal text-signal-ink' : 'bg-black/40 text-transparent opacity-0 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.7)] group-hover:opacity-100',
                    )}
                  >
                    <Check size={12} strokeWidth={3} />
                  </span>
                </div>
                <div className="mt-1.5 truncate t-caption text-ink-2">{m.title || t('untitled')}</div>
              </button>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}
