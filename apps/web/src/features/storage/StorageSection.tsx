import type { ArchivePolicy, ArchiveStrategy } from '@greenlit/shared'
import type { GcReport, StorageJobStarted, StorageOverview } from '@greenlit/shared/areas/storage-admin'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ChevronDown, Sparkles, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { SavedHint, SettingsGroup, SettingsRow, SettingsSection } from '@/components/SettingsSection'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useTopic } from '@/lib/realtime'
import { formatDateTime, formatRelative, useTimeZone } from '@/lib/time'
import { Button, confirm, Input, ProgressBar, Segmented, Select, Skeleton, Tally, Toggle, toast } from '@/ui'

type Kind = keyof ArchivePolicy['strategies']
const KINDS: Kind[] = ['video', 'image', 'audio', 'document', 'other']
const OPTIONS: Record<Kind, ArchiveStrategy[]> = {
  video: ['av1', 'lossless', 'none'],
  image: ['jxl', 'lossless', 'none'],
  audio: ['flac', 'lossless', 'none'],
  document: ['lossless', 'none'],
  other: ['lossless', 'none'],
}
const TOOL: Partial<Record<ArchiveStrategy, 'av1' | 'jxl' | 'flac' | 'zstd'>> = {
  av1: 'av1',
  jxl: 'jxl',
  flac: 'flac',
  lossless: 'zstd',
}

function useStorage() {
  const qc = useQueryClient()
  useTopic('storage', () => void qc.invalidateQueries({ queryKey: qk.storage }))
  useTopic('tasks', () => void qc.invalidateQueries({ queryKey: qk.storage }))
  return useQuery({
    queryKey: qk.storage,
    queryFn: () => api.get<StorageOverview>('/storage/stats'),
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 60_000),
  })
}

export default function StorageSection() {
  const t = useT('storage')
  const { data } = useStorage()
  if (!data)
    return (
      <SettingsSection title={t('section')} description={t('description')}>
        <Skeleton className="h-44 rounded-panel" />
        <Skeleton className="h-72 rounded-panel" />
      </SettingsSection>
    )
  return (
    <SettingsSection title={t('section')} description={t('description')}>
      <DiskCard data={data} />
      <ArchiveCard data={data} />
      <CleanupCard data={data} />
    </SettingsSection>
  )
}

function DiskCard({ data }: { data: StorageOverview }) {
  const t = useT('storage')
  const total = data.disk.total || 1
  const ours = data.originals.hot + data.originals.archived + data.derived + data.attachments + data.temporary
  const other = Math.max(0, total - data.disk.free - ours)
  const parts = [
    { key: 'originals', bytes: data.originals.hot, color: 'var(--ink)' },
    { key: 'archived', bytes: data.originals.archived, color: 'var(--cue)' },
    { key: 'derived', bytes: data.derived, color: 'color-mix(in oklab, var(--ink) 52%, var(--panel))' },
    { key: 'attachments', bytes: data.attachments, color: 'var(--review)' },
    { key: 'temporary', bytes: data.temporary, color: 'color-mix(in oklab, var(--ink) 30%, var(--panel))' },
    { key: 'other', bytes: other, color: 'color-mix(in oklab, var(--ink) 14%, var(--panel))' },
  ]
  const used = total - data.disk.free
  const maxKind = Math.max(1, ...data.byKind.map((k) => k.bytes))
  return (
    <div className="rounded-panel bg-panel p-5 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="t-micro text-ink-3">{t('disk')}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[28px] leading-none font-[600] tracking-[-0.03em] text-ink tabular">
              {formatBytes(ours)}
            </span>
            <span className="t-callout text-ink-3">Greenlit</span>
          </div>
        </div>
        <div className="text-right">
          <div className="t-callout text-ink-2">
            {t('diskOf', { used: formatBytes(used), total: formatBytes(total) })}
          </div>
          <div className="t-caption text-ink-3">{t('free', { size: formatBytes(data.disk.free) })}</div>
        </div>
      </div>
      {/* Greenlit's own files, by part */}
      <div className="mt-5 flex h-3 gap-[2px] overflow-hidden rounded-full">
        {parts
          .filter((p) => p.key !== 'other' && p.bytes > 0)
          .map((p, i) => (
            <motion.div
              key={p.key}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.08 * i, ease }}
              className="h-full origin-left first:rounded-l-full last:rounded-r-full"
              style={{ flexGrow: p.bytes, flexBasis: 0, minWidth: 4, background: p.color }}
            />
          ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
        {parts
          .filter((p) => p.key !== 'other')
          .map((p) => (
            <div key={p.key} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_var(--line-strong)]"
                style={{ background: p.color }}
              />
              <span className="min-w-0 flex-1 truncate t-caption text-ink-2">{t(`parts.${p.key}`)}</span>
              <span className="t-meta text-ink-3">{formatBytes(p.bytes)}</span>
            </div>
          ))}
      </div>
      {/* the whole disk */}
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative h-1.5 min-w-[220px] flex-1 overflow-hidden rounded-full bg-well shadow-[inset_0_0_0_1px_var(--line)]">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, ease }}
            className="absolute inset-y-0 left-0 origin-left rounded-full bg-[color-mix(in_oklab,var(--ink)_22%,var(--panel))]"
            style={{ width: `${(used / total) * 100}%` }}
          />
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.1, ease }}
            className="absolute inset-y-0 left-0 origin-left rounded-full bg-signal"
            style={{ width: `${Math.max(0.6, (ours / total) * 100)}%` }}
          />
        </div>
        <span className="shrink-0 t-caption text-ink-3">
          <span className="text-signal">Greenlit</span> · {t('parts.other')} · {t('parts.free')}
        </span>
      </div>
      {data.byKind.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <div className="mb-2.5 t-micro text-ink-3">{t('byKind')}</div>
          <div className="flex flex-col gap-2">
            {data.byKind
              .slice()
              .sort((a, b) => b.bytes - a.bytes)
              .map((k) => (
                <div key={k.kind} className="grid grid-cols-[96px_minmax(0,1fr)_120px] items-center gap-3">
                  <span className="t-caption text-ink-2">
                    {t(`kinds.${k.kind}`, { defaultValue: k.kind })}
                  </span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-well">
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.6, ease }}
                      className="h-full origin-left rounded-full bg-ink-3"
                      style={{ width: `${(k.bytes / maxKind) * 100}%` }}
                    />
                  </div>
                  <span className="text-right t-meta text-ink-3">
                    {formatBytes(k.bytes)} · {t('files', { count: k.count })}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ArchiveCard({ data }: { data: StorageOverview }) {
  const t = useT('storage')
  const tz = useTimeZone()
  const qc = useQueryClient()
  const [policy, setPolicy] = useState(data.policy)
  const [tick, setTick] = useState(0)
  const [starting, setStarting] = useState(false)
  const [showItems, setShowItems] = useState(false)
  useEffect(() => setPolicy(data.policy), [data.policy])

  const save = async (patch: Partial<ArchivePolicy>) => {
    const prev = policy
    setPolicy((p) => ({ ...p, ...patch, strategies: { ...p.strategies, ...(patch.strategies ?? {}) } }))
    try {
      await api.patch<ArchivePolicy>('/storage/policy', patch)
      setTick((n) => n + 1)
      void qc.invalidateQueries({ queryKey: qk.storage })
    } catch (err) {
      setPolicy(prev)
      toast.error(err)
    }
  }
  const preset = [90, 183, 365].includes(policy.afterDays) ? String(policy.afterDays) : 'custom'
  const age =
    policy.afterDays % 30 === 0 || [183, 365].includes(policy.afterDays)
      ? policy.afterDays === 365
        ? t('year')
        : t('months', { count: Math.round(policy.afterDays / 30.5) })
      : `${policy.afterDays} ${t('days')}`
  const run = data.lastRun

  return (
    <SettingsGroup title={t('archive')} aside={<SavedHint tick={tick} label={t('saved')} />}>
      <SettingsRow inline label={t('archiveOn')} description={t('archiveOnHint')}>
        <Toggle checked={policy.enabled} onChange={(enabled) => void save({ enabled })} />
      </SettingsRow>
      <div
        className={cn(
          'transition-opacity duration-200 [&>*+*]:border-t [&>*+*]:border-line',
          !policy.enabled && 'pointer-events-none opacity-45',
        )}
      >
        <SettingsRow label={t('after')} description={t('afterHint')}>
          <Segmented
            value={preset}
            onChange={(v) => v !== 'custom' && void save({ afterDays: Number(v) })}
            options={[
              { value: '90', label: t('months', { count: 3 }) },
              { value: '183', label: t('months', { count: 6 }) },
              { value: '365', label: t('year') },
              { value: 'custom', label: t('custom') },
            ]}
          />
          {preset === 'custom' && (
            <span className="flex items-center gap-1.5">
              <Input
                type="number"
                min={7}
                max={3650}
                defaultValue={policy.afterDays}
                className="w-20 text-right t-meta"
                onBlur={(e) => {
                  const v = Math.round(Number(e.target.value))
                  if (v >= 7 && v <= 3650 && v !== policy.afterDays) void save({ afterDays: v })
                }}
              />
              <span className="t-caption text-ink-3">{t('days')}</span>
            </span>
          )}
        </SettingsRow>
        <SettingsRow
          label={t('runAt')}
          description={
            <>
              {t('runAtHint', { tz: data.timeZone.replace(/_/g, ' ') })}
              {data.nextRunAt && (
                <span className="text-ink-4">
                  {' '}
                  · {t('nextRun', { when: formatDateTime(data.nextRunAt, tz) })}
                </span>
              )}
            </>
          }
        >
          <input
            type="time"
            value={policy.runAt}
            onChange={(e) => setPolicy((p) => ({ ...p, runAt: e.target.value }))}
            onBlur={(e) =>
              e.target.value !== data.policy.runAt &&
              /^\d{2}:\d{2}$/.test(e.target.value) &&
              void save({ runAt: e.target.value })
            }
            className="h-8 rounded-control bg-well px-2.5 t-meta text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)] [color-scheme:inherit]"
          />
        </SettingsRow>
        <SettingsRow label={t('how')} description={t('howHint')} stack>
          <div className="w-full overflow-hidden rounded-tile bg-well shadow-[inset_0_0_0_1px_var(--line)] [&>*+*]:border-t [&>*+*]:border-line">
            {KINDS.map((kind) => {
              const value = policy.strategies[kind]
              const tool = TOOL[value]
              const missing = tool && !data.tools[tool]
              return (
                <div key={kind} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5">
                  <span className="w-28 shrink-0 t-callout text-ink">{t(`kinds.${kind}`)}</span>
                  <span className={cn('min-w-0 flex-1 t-caption', missing ? 'text-review' : 'text-ink-3')}>
                    {missing ? t('missingTool') : t(`strategy.${value}Hint`)}
                  </span>
                  <Select
                    size="sm"
                    align="end"
                    className="w-[220px]"
                    value={value}
                    onChange={(v) => void save({ strategies: { ...policy.strategies, [kind]: v } })}
                    options={OPTIONS[kind].map((s) => ({ value: s, label: t(`strategy.${s}`) }))}
                  />
                </div>
              )
            })}
          </div>
        </SettingsRow>
        <SettingsRow inline label={t('keepPreviews')} description={t('keepPreviewsHint')}>
          <Toggle checked={policy.keepPreviews} onChange={(keepPreviews) => void save({ keepPreviews })} />
        </SettingsRow>
        <SettingsRow inline label={t('skipScheduled')} description={t('skipScheduledHint')}>
          <Toggle checked={policy.skipScheduled} onChange={(skipScheduled) => void save({ skipScheduled })} />
        </SettingsRow>
      </div>

      <div className="py-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-control bg-hover text-ink-2">
            <Archive size={17} strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="t-callout font-[550] text-ink">{t('candidates')}</div>
            <div className="t-caption text-ink-3">
              {data.archiveCandidates.count
                ? t('candidatesBody', {
                    files: t('files', { count: data.archiveCandidates.count }),
                    size: formatBytes(data.archiveCandidates.bytes),
                    age,
                  })
                : t('nothingOld')}
            </div>
          </div>
          <Button
            icon={Archive}
            disabled={!data.archiveCandidates.count || !!data.running}
            loading={starting || !!data.running}
            onClick={async () => {
              setStarting(true)
              try {
                const r = await api.post<StorageJobStarted>('/storage/archive/run')
                toast.done(r.alreadyRunning ? t('alreadyRunning') : t('started'))
                void qc.invalidateQueries({ queryKey: qk.storage })
              } catch (err) {
                toast.error(err)
              } finally {
                setStarting(false)
              }
            }}
          >
            {data.running ? t('archiving') : t('archiveNow')}
          </Button>
        </div>
        <AnimatePresence>
          {data.running && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-3.5">
                <ProgressBar value={data.running.progress} />
                <div className="mt-1.5 t-caption text-ink-3">{data.running.message}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {run && (
        <div className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tally tone={run.errors ? 'changes' : 'greenlit'} size={8} />
            <div className="min-w-0 flex-1">
              <div className="t-callout font-[550] text-ink">{t('lastRun')}</div>
              <div className="t-caption text-ink-3">
                {t('lastRunBody', {
                  when: formatRelative(run.finishedAt, tz),
                  archived: run.archived,
                  saved: formatBytes(run.savedBytes),
                })}
                {run.errors > 0 && <span className="text-cut"> · {t('errors', { count: run.errors })}</span>}
                {run.stoppedEarly && <span> · {t('stoppedEarly')}</span>}
              </div>
            </div>
            {run.items.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                iconRight={ChevronDown}
                onClick={() => setShowItems((s) => !s)}
                className={cn('[&>svg]:transition-transform', showItems && '[&>svg]:rotate-180')}
              >
                {showItems ? t('hideFiles') : t('showFiles')}
              </Button>
            )}
          </div>
          <AnimatePresence>
            {showItems && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease }}
                className="overflow-hidden"
              >
                <div className="mt-3 max-h-72 overflow-y-auto rounded-tile bg-well shadow-[inset_0_0_0_1px_var(--line)] [&>*+*]:border-t [&>*+*]:border-line">
                  {run.items.map((it) => (
                    <div key={it.blobId} className="flex items-center gap-3 px-3 py-2">
                      <Tally
                        tone={
                          it.outcome === 'failed'
                            ? 'failed'
                            : it.outcome === 'archived'
                              ? 'greenlit'
                              : 'draft'
                        }
                        size={6}
                      />
                      <span
                        className="min-w-0 flex-1 truncate t-caption text-ink-2"
                        title={it.note ?? undefined}
                      >
                        {it.filename}
                      </span>
                      <span className="t-meta text-ink-3">
                        {formatBytes(it.before)}
                        {it.after !== null && ` → ${formatBytes(it.after)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </SettingsGroup>
  )
}

function CleanupCard({ data }: { data: StorageOverview }) {
  const t = useT('storage')
  const tz = useTimeZone()
  const qc = useQueryClient()
  const [report, setReport] = useState<GcReport | null>(null)
  const [busy, setBusy] = useState<'check' | 'delete' | null>(null)
  const filesLabel = (n: number) => t('files', { count: n })
  const check = async () => {
    setBusy('check')
    try {
      setReport(await api.post<GcReport>('/storage/gc', { dryRun: true }))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }
  const remove = async () => {
    if (!report) return
    const files = filesLabel(report.removedBlobs)
    if (
      !(await confirm({
        title: t('deleteTitle', { files }),
        body: t('deleteBody'),
        confirm: t('delete', { files }),
        danger: true,
      }))
    )
      return
    setBusy('delete')
    try {
      await api.post('/storage/gc', { dryRun: false })
      setReport(null)
      toast.done(t('cleaning'))
      void qc.invalidateQueries({ queryKey: qk.storage })
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(null)
    }
  }
  return (
    <SettingsGroup title={t('cleanup')} description={t('cleanupHint')}>
      <div className="flex flex-wrap items-center gap-4 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-hover text-ink-2">
          <Sparkles size={17} strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          {report ? (
            <>
              <div className="t-callout font-[550] text-ink">
                {report.removedBlobs
                  ? t('found', {
                      files: filesLabel(report.removedBlobs),
                      size: formatBytes(report.freedBytes),
                    })
                  : t('foundNone')}
              </div>
              {report.keptRecent > 0 && (
                <div className="t-caption text-ink-3">{t('keptRecent', { count: report.keptRecent })}</div>
              )}
            </>
          ) : (
            <div className="t-caption text-ink-3">
              {data.lastGc
                ? t('lastCleanup', {
                    when: formatRelative(data.lastGc.at, tz),
                    freed: formatBytes(data.lastGc.freedBytes),
                  })
                : t('cleanupHint')}
            </div>
          )}
        </div>
        {report?.removedBlobs ? (
          <Button
            variant="danger-ghost"
            icon={Trash2}
            loading={busy === 'delete'}
            onClick={() => void remove()}
          >
            {t('delete', { files: filesLabel(report.removedBlobs) })}
          </Button>
        ) : (
          <Button loading={busy === 'check'} onClick={() => void check()}>
            {t('check')}
          </Button>
        )}
      </div>
      {report && report.blobs.length > 0 && (
        <div className="pb-4">
          <div className="max-h-56 overflow-y-auto rounded-tile bg-well shadow-[inset_0_0_0_1px_var(--line)] [&>*+*]:border-t [&>*+*]:border-line">
            {report.blobs.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate t-caption text-ink-2">{b.filename}</span>
                <span className="t-meta text-ink-4">{b.usage}</span>
                <span className="w-20 text-right t-meta text-ink-3">{formatBytes(b.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SettingsGroup>
  )
}
