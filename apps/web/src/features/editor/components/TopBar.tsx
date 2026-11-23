import { placements } from '@greenlit/platforms'
import type { Platform } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Redo2, ScanLine, Sparkles, Undo2, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTasks } from '@/app/Activity'
import { PLATFORM_NAME } from '@/components/PlatformIcon'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import {
  AvatarStack,
  Button,
  Checkbox,
  Dialog,
  IconButton,
  InlineEdit,
  Menu,
  ProgressRing,
  Segmented,
  Tally,
  Tooltip,
  toast,
} from '@/ui'
import { compositionApi } from '../api'
import { redo, setOnRendered, undo, useDoc, useEditor } from '../store'
import { AspectBox } from './AspectBox'

export function TopBar() {
  const t = useT('editor')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const meta = useEditor((s) => s.meta)
  const id = useEditor((s) => s.id)
  const doc = useDoc()
  const status = useEditor((s) => s.status)
  const readOnly = useEditor((s) => s.readOnly)
  const formatId = useEditor((s) => s.formatId)
  const canUndo = useEditor((s) => s.undo.length > 0)
  const canRedo = useEditor((s) => s.redo.length > 0)
  const guides = useEditor((s) => s.guides)
  const [exporting, setExporting] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)

  useEffect(() => {
    setOnRendered(({ mediaId }) => {
      setTaskId(null)
      toast.done(t('export.done', { name: useEditor.getState().meta?.name ?? '' }), {
        action: { label: t('export.open'), onClick: () => navigate(`/media/${mediaId}`) },
      })
    })
    return () => setOnRendered(null)
  }, [navigate, t])

  useEffect(() => {
    const open = () => !useEditor.getState().readOnly && setExporting(true)
    window.addEventListener('gl-editor-export', open)
    return () => window.removeEventListener('gl-editor-export', open)
  }, [])

  const safe = placements.filter((p) => p.safeZone)

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <IconButton
          icon={ChevronLeft}
          label={t('bar.back')}
          onClick={() => (meta?.projectId ? navigate(`/projects/${meta.projectId}?tab=edits`) : navigate(-1))}
        />
        <div className="flex min-w-0 flex-col leading-tight">
          {meta && (
            <InlineEdit
              value={meta.name}
              disabled={readOnly}
              onSave={async (name) => {
                useEditor.setState((s) => ({ meta: s.meta ? { ...s.meta, name } : s.meta }))
                await api.patch(`/compositions/${id}`, { name }).catch((e) => toast.error(e))
                void qc.invalidateQueries({ queryKey: ['compositions'] })
              }}
              className="t-callout font-[600] text-ink"
            />
          )}
          <SaveState status={status} readOnly={readOnly} duration={doc?.duration ?? 0} />
        </div>
      </div>

      {doc && doc.formats.length > 1 && (
        <Segmented
          size="sm"
          value={formatId}
          onChange={(v) => useEditor.setState({ formatId: v })}
          options={doc.formats.map((f) => ({
            value: f.id,
            label: (
              <span className="flex items-center gap-1.5">
                <AspectBox w={f.width} h={f.height} size={13} active={f.id === formatId} />
                {f.name}
              </span>
            ),
          }))}
        />
      )}

      <div className="flex flex-1 items-center justify-end gap-1">
        <RemoteActivity />
        <Presence />
        <Menu
          align="end"
          width={240}
          trigger={<IconButton icon={ScanLine} label={t('bar.guides')} active={!!guides || undefined} />}
          items={[
            {
              label: t('bar.noGuides'),
              checked: !guides,
              onSelect: () => useEditor.setState({ guides: null }),
            },
            'separator',
            ...safe.map((p) => {
              const platform = p.key.split('.')[0] as Platform
              return {
                label: `${PLATFORM_NAME[platform]} ${p.label}`,
                checked: guides === p.key,
                onSelect: () => useEditor.setState({ guides: p.key }),
              }
            }),
          ]}
        />
        <span className="mx-1 h-5 w-px bg-line" />
        <IconButton
          icon={Undo2}
          label={t('bar.undo')}
          shortcut="mod+z"
          disabled={!canUndo || readOnly}
          onClick={undo}
        />
        <IconButton
          icon={Redo2}
          label={t('bar.redo')}
          shortcut="mod+shift+z"
          disabled={!canRedo || readOnly}
          onClick={redo}
        />
        <ExportProgress taskId={taskId} />
        {!readOnly && (
          <Button
            variant="primary"
            icon={Upload}
            className="ml-1.5"
            onClick={() => setExporting(true)}
            kbd="mod+e"
          >
            {t('bar.export')}
          </Button>
        )}
      </div>
      {id && doc && (
        <ExportDialog
          open={exporting}
          onOpenChange={setExporting}
          onStarted={(tid) => {
            setTaskId(tid)
            toast.info(t('export.running'))
          }}
        />
      )}
    </header>
  )
}

function SaveState({ status, readOnly, duration }: { status: string; readOnly: boolean; duration: number }) {
  const t = useT('editor')
  const label = readOnly
    ? t('bar.readOnly')
    : status === 'saving'
      ? t('bar.saving')
      : status === 'offline'
        ? t('bar.offline')
        : t('bar.saved')
  return (
    <span className="flex items-center gap-1.5 t-micro text-ink-3">
      <Tally
        tone={status === 'saving' ? 'review' : status === 'offline' ? 'changes' : 'greenlit'}
        size={6}
        pulse={status === 'saving'}
      />
      <span className="truncate">{label}</span>
      <span className="text-ink-4">· {formatDuration(duration)}</span>
    </span>
  )
}

/** "Claude is editing": lit while ops from MCP (or another editor) keep arriving. */
function RemoteActivity() {
  const t = useT('editor')
  const remote = useEditor((s) => s.remote)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!remote) return
    const i = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(i)
  }, [remote])
  const live = remote && Date.now() - remote.at < 8000
  const isAgent = remote && (remote.source === 'mcp' || remote.source === 'api')
  return (
    <AnimatePresence>
      {live && (
        <motion.span
          initial={{ opacity: 0, scale: 0.92, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.28, ease }}
          className={cn(
            'mr-1 flex h-7 items-center gap-2 rounded-full pr-3 pl-2 t-caption font-[550]',
            isAgent ? 'bg-signal-soft text-signal' : 'bg-cue-soft text-cue',
          )}
        >
          {isAgent ? <Sparkles size={13} strokeWidth={2} /> : <Tally tone="scheduled" size={7} />}
          {isAgent ? t('bar.claude') : t('bar.someone', { name: remote?.author?.displayName ?? '' })}
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1 rounded-full bg-current"
                style={{ animation: `gl-pulse 1.2s ${i * 0.18}s infinite` }}
              />
            ))}
          </span>
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function Presence() {
  const t = useT('editor')
  const presence = useEditor((s) => s.presence)
  const people = presence
    .filter((p) => p.user && Date.now() - p.at < 10 * 60_000)
    .map((p) => ({ id: p.user!.id, displayName: p.user!.displayName, avatarUrl: null as string | null }))
  const unique = [...new Map(people.map((p) => [p.id, p])).values()]
  if (!unique.length) return null
  return (
    <Tooltip label={unique.map((u) => t('bar.watching', { name: u.displayName })).join(' · ')}>
      <span className="mr-1">
        <AvatarStack users={unique} size={24} />
      </span>
    </Tooltip>
  )
}

function ExportProgress({ taskId }: { taskId: string | null }) {
  const { data } = useTasks()
  if (!taskId) return null
  const task = data?.active.find((x) => x.id === taskId)
  if (!task) return null
  return (
    <Tooltip label={task.message || task.title}>
      <span className="ml-1 flex h-8 items-center gap-1.5 rounded-control px-2 text-signal">
        <ProgressRing value={task.progress} size={16} />
        <span className="t-meta">{Math.round(task.progress * 100)}%</span>
      </span>
    </Tooltip>
  )
}

function ExportDialog({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onStarted: (taskId: string | null) => void
}) {
  const t = useT('editor')
  const doc = useDoc()
  const id = useEditor((s) => s.id)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the choice each time the dialog opens
  useEffect(() => {
    if (open && doc) setPicked(doc.formats.map((f) => f.id))
  }, [open])
  if (!doc || !id) return null
  const frames = Math.ceil(doc.duration * doc.fps)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('export.title')}
      description={t('export.body')}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="primary"
            icon={Upload}
            loading={busy}
            disabled={!picked.length}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await compositionApi.render(id, picked.length === doc.formats.length ? [] : picked)
                onStarted(r.taskId)
                onOpenChange(false)
              } catch (err) {
                toast.error(err, t('export.failed'))
              } finally {
                setBusy(false)
              }
            }}
          >
            {picked.length > 1 ? t('export.start', { count: picked.length }) : t('export.startOne')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {doc.formats.map((f) => {
          const on = picked.includes(f.id)
          return (
            <label
              key={f.id}
              className={cn(
                'flex cursor-default items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors',
                on
                  ? 'bg-signal-soft shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--signal)_35%,transparent)]'
                  : 'bg-well shadow-[inset_0_0_0_1px_var(--line)]',
              )}
            >
              <Checkbox
                checked={on}
                onChange={(v) => setPicked((p) => (v ? [...p, f.id] : p.filter((x) => x !== f.id)))}
              />
              <AspectBox w={f.width} h={f.height} size={26} active={on} />
              <span className="flex-1">
                <span className="block t-callout font-[550] text-ink">{f.name}</span>
                <span className="t-meta text-ink-3">
                  {f.width}×{f.height} · {doc.fps} fps
                </span>
              </span>
            </label>
          )
        })}
        <div className="mt-2 t-caption text-ink-3">
          {formatDuration(doc.duration)} · {t('export.frames', { count: frames })}
        </div>
      </div>
    </Dialog>
  )
}
