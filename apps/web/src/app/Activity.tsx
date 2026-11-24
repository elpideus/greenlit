import type { Me } from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity as ActivityIcon, ArrowRight, RotateCw, Square, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { qk, queryClient } from '@/lib/query'
import { useTopic } from '@/lib/realtime'
import { useSession } from '@/lib/session'
import { formatRelative, useTimeZone } from '@/lib/time'
import { cancelUpload, retryUpload, useUploads } from '@/lib/uploads'
import { Button, EmptyState, IconButton, Popover, ProgressBar, ProgressRing, Tally, toast } from '@/ui'

export interface TaskView {
  id: string
  kind: string
  title: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  message: string
  entityType: string | null
  entityId: string | null
  /** Who started it (null: Greenlit itself). */
  createdBy: string | null
  error: string | null
  result?: unknown
  createdAt: string
  updatedAt: string
}

export const isRunning = (task: Pick<TaskView, 'state'>) =>
  task.state === 'queued' || task.state === 'running'

/** Whoever started a task, or an admin, can stop it while it waits or runs (the server checks the same). */
export const canStop = (me: Pick<Me, 'id' | 'role'>, task: TaskView) =>
  isRunning(task) && (me.role === 'admin' || (!!task.createdBy && task.createdBy === me.id))

/** Stops a task and its background job: it is never tried again, work in progress ends within seconds. */
export async function stopTask(task: Pick<TaskView, 'id'>) {
  try {
    await api.post(`/tasks/${task.id}/cancel`)
  } catch (err) {
    toast.error(err)
  } finally {
    void queryClient.invalidateQueries({ queryKey: qk.tasks })
    void queryClient.invalidateQueries({ queryKey: qk.taskHistory().slice(0, 1) })
  }
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
  const navigate = useNavigate()
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
      : (activeUploads.reduce((s, u) => s + u.progress, 0) + active.reduce((s, x) => s + x.progress, 0)) /
        busy

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
          <button
            type="button"
            className="press relative grid size-8 place-items-center rounded-control text-signal hover:bg-hover"
            aria-label={t('shell.activity')}
          >
            <ProgressRing value={overall} size={18} />
            <span className="absolute t-micro text-[9px] text-ink-2">{busy}</span>
          </button>
        ) : (
          <IconButton icon={ActivityIcon} label={t('shell.activity')} tooltip={!open} />
        )
      }
    >
      <div className="flex items-center justify-between gap-3 pt-2.5 pr-2 pb-1 pl-4">
        <span className="t-headline text-ink">{t('shell.activity')}</span>
        <Button
          size="sm"
          variant="ghost"
          iconRight={ArrowRight}
          onClick={() => {
            setOpen(false)
            clear()
            navigate('/activity')
          }}
        >
          {t('shell.allActivity')}
        </Button>
      </div>
      <div className="max-h-[min(70dvh,520px)] overflow-y-auto px-2 pb-2">
        {!uploads.length && !active.length && !data?.recent.length && (
          <EmptyState
            compact
            icon={ActivityIcon}
            title={t('shell.noActivity')}
            body={t('shell.noActivityBody')}
          />
        )}
        {uploads.length > 0 && <Group label={t('shell.uploads')} />}
        {uploads.map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded-[9px] px-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate t-callout text-ink">{u.label}</span>
                <span className="shrink-0 t-meta text-ink-3">
                  {u.state === 'failed'
                    ? '—'
                    : u.state === 'done'
                      ? formatBytes(u.file.size)
                      : `${Math.round(u.progress * 100)}%`}
                </span>
              </div>
              {u.state === 'failed' ? (
                <div className="mt-0.5 truncate t-caption text-cut">{u.error}</div>
              ) : (
                <ProgressBar
                  value={u.progress}
                  className="mt-1.5"
                  tone={u.state === 'done' ? 'ink' : 'signal'}
                />
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
            <Tally
              tone={task.state === 'failed' ? 'failed' : task.state === 'done' ? 'greenlit' : 'draft'}
              size={7}
            />
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
  const t = useT()
  const me = useSession()
  return (
    <div className="flex items-center gap-3 rounded-[9px] px-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate t-callout text-ink">{task.title}</span>
          <span className="shrink-0 t-meta text-ink-3">{Math.round(task.progress * 100)}%</span>
        </div>
        {task.message && <div className="mt-0.5 truncate t-caption text-ink-3">{task.message}</div>}
        <ProgressBar value={task.state === 'queued' ? null : task.progress} className="mt-1.5" />
      </div>
      {canStop(me, task) && (
        <IconButton size="sm" icon={Square} label={t('shell.stop')} onClick={() => void stopTask(task)} />
      )}
    </div>
  )
}
