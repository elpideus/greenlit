import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity as ActivityIcon, RotateCw, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useTopic } from '@/lib/realtime'
import { formatRelative, useTimeZone } from '@/lib/time'
import { cancelUpload, retryUpload, useUploads } from '@/lib/uploads'
import { EmptyState, IconButton, Popover, ProgressBar, ProgressRing, Tally } from '@/ui'

export interface TaskView {
  id: string
  kind: string
  title: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  message: string
  entityType: string | null
  entityId: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export function useTasks() {
  const qc = useQueryClient()
  useTopic('tasks', () => void qc.invalidateQueries({ queryKey: qk.tasks }))
  return useQuery({
    queryKey: qk.tasks,
    queryFn: () => api.get<{ active: TaskView[]; recent: TaskView[] }>('/tasks'),
    refetchInterval: (q) => (q.state.data?.active.length ? 4000 : false),
  })
}

/**
 * Background work you started: uploads (in this tab) and the server's tasks (processing, exports, publishing).
 * The icon becomes a progress ring while anything runs.
 */
export function ActivityButton() {
  const t = useT()
  const tz = useTimeZone()
  const [open, setOpen] = useState(false)
  const { data } = useTasks()
  const uploads = useUploads((s) => s.items)
  const clear = useUploads((s) => s.clearFinished)
  const activeUploads = uploads.filter((u) => u.state === 'uploading' || u.state === 'queued')
  const active = data?.active ?? []
  const busy = activeUploads.length + active.length
  const overall =
    busy === 0
      ? 0
      : (activeUploads.reduce((s, u) => s + u.progress, 0) + active.reduce((s, x) => s + x.progress, 0)) / busy

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) clear()
      }}
      align="end"
      width={360}
      trigger={
        busy > 0 ? (
          <button type="button" className="press relative grid size-8 place-items-center rounded-control text-signal hover:bg-hover" aria-label={t('shell.activity')}>
            <ProgressRing value={overall} size={18} />
            <span className="absolute t-micro text-[9px] text-ink-2">{busy}</span>
          </button>
        ) : (
          <IconButton icon={ActivityIcon} label={t('shell.activity')} tooltip={!open} />
        )
      }
    >
      <div className="px-4 pt-3.5 pb-1 t-headline text-ink">{t('shell.activity')}</div>
      <div className="max-h-[min(70dvh,520px)] overflow-y-auto px-2 pb-2">
        {!uploads.length && !active.length && !data?.recent.length && (
          <EmptyState compact icon={ActivityIcon} title={t('shell.noActivity')} body={t('shell.noActivityBody')} />
        )}
        {uploads.length > 0 && <Group label={t('shell.uploads')} />}
        {uploads.map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded-[9px] px-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate t-callout text-ink">{u.label}</span>
                <span className="shrink-0 t-meta text-ink-3">
                  {u.state === 'failed' ? '—' : u.state === 'done' ? formatBytes(u.file.size) : `${Math.round(u.progress * 100)}%`}
                </span>
              </div>
              {u.state === 'failed' ? (
                <div className="mt-0.5 truncate t-caption text-cut">{u.error}</div>
              ) : (
                <ProgressBar value={u.progress} className="mt-1.5" tone={u.state === 'done' ? 'ink' : 'signal'} />
              )}
            </div>
            {u.state === 'failed' ? (
              <IconButton size="sm" icon={RotateCw} label="Retry" onClick={() => retryUpload(u.id)} />
            ) : u.state !== 'done' && u.state !== 'cancelled' ? (
              <IconButton size="sm" icon={X} label="Cancel" onClick={() => cancelUpload(u.id)} />
            ) : null}
          </div>
        ))}
        {active.length > 0 && <Group label={t('shell.running')} />}
        {active.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
        {!!data?.recent.length && <Group label={t('shell.recent')} />}
        {data?.recent.slice(0, 12).map((task) => (
          <div key={task.id} className="flex items-center gap-3 rounded-[9px] px-2 py-1.5">
            <Tally tone={task.state === 'failed' ? 'failed' : task.state === 'done' ? 'greenlit' : 'draft'} size={7} />
            <span className="min-w-0 flex-1 truncate t-callout text-ink-2">{task.title}</span>
            <span className="shrink-0 t-meta text-ink-4">{formatRelative(task.updatedAt, tz)}</span>
          </div>
        ))}
      </div>
    </Popover>
  )
}

function Group({ label }: { label: string }) {
  return <div className="px-2 pt-3 pb-1 t-micro text-ink-3">{label}</div>
}

function TaskRow({ task }: { task: TaskView }) {
  return (
    <div className="rounded-[9px] px-2 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate t-callout text-ink">{task.title}</span>
        <span className="shrink-0 t-meta text-ink-3">{Math.round(task.progress * 100)}%</span>
      </div>
      {task.message && <div className="mt-0.5 truncate t-caption text-ink-3">{task.message}</div>}
      <ProgressBar value={task.state === 'queued' ? null : task.progress} className="mt-1.5" />
    </div>
  )
}
