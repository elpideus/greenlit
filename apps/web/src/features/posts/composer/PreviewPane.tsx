import { AlertTriangle, CircleCheck, Info, OctagonAlert, Smartphone } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useSlot } from '@/app/Slot'
import { PlatformIcon } from '@/components/PlatformIcon'
import { PlatformPreview } from '@/components/platform-preview'
import { cn } from '@/lib/cn'
import { useElementSize } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { spring } from '@/lib/motion'
import { EmptyState, Segmented, Toggle, Tooltip } from '@/ui'
import { soundAudioUrl } from '../api'
import { finalCaption, specOf } from '../model'
import { useWhere } from '../parts'
import { useComposer } from './state'
import { formatFor, trackFor } from './TargetSections'

/** The side of the composer: the live preview of one version (and other features' tabs: notes, history). */
export function PreviewPane() {
  const t = useT('posts')
  const c = useComposer()
  const panels = useSlot('post.panels', { post: c.post })
  const [tab, setTab] = useState('preview')
  const active = panels.find((p) => `${p.feature}:${p.id}` === tab)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {panels.length > 0 && (
        <div className="flex h-12 shrink-0 items-center px-4">
          <Segmented
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'preview', label: t('preview.tab') },
              ...panels.map((p) => ({
                value: `${p.feature}:${p.id}`,
                label: t(`${p.feature}:${p.label ?? p.id}`, { defaultValue: p.label ?? p.id }),
              })),
            ]}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {active ? (
          <div className="p-3">
            <active.component post={c.post} />
          </div>
        ) : (
          <LivePreview />
        )}
      </div>
    </div>
  )
}

function LivePreview() {
  const t = useT('posts')
  const where = useWhere()
  const c = useComposer()
  const [safe, setSafe] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [box, size] = useElementSize<HTMLDivElement>()
  const enabled = c.draft.targets.filter((x) => x.enabled)
  const target =
    enabled.find((x) => x.key === c.selected) ?? enabled.find((x) => x.key === pick) ?? enabled[0]
  const account = target && c.accounts.find((a) => a.id === target.accountId)
  const width = Math.max(220, Math.min(330, (size.width || 360) - 72))

  if (!enabled.length)
    return (
      <EmptyState
        compact
        icon={Smartphone}
        title={t('preview.tab')}
        body={t('preview.noTarget')}
        className="px-6"
      />
    )
  if (!c.media.length)
    return (
      <EmptyState
        compact
        icon={Smartphone}
        title={t('preview.tab')}
        body={t('preview.noMedia')}
        className="px-6"
      />
    )
  if (!target || !account) return null
  const spec = specOf(account.platform, target.placement)
  const platformSpec = { platform: account.platform, placement: target.placement }
  const checks = c.checks.find((x) => x.targetId === target.id)?.issues ?? []

  return (
    <div ref={box} className="flex flex-col items-center px-4 pt-3 pb-8">
      {enabled.length > 1 && (
        <div className="no-scrollbar mb-4 flex w-full gap-1 overflow-x-auto">
          {enabled.map((x) => {
            const a = c.accounts.find((acc) => acc.id === x.accountId)
            if (!a) return null
            const on = x.key === target.key
            return (
              <Tooltip key={x.key} label={`${a.name} · ${where(a.platform, x.placement)}`}>
                <button
                  type="button"
                  onClick={() => (c.selected === 'all' ? setPick(x.key) : c.select(x.key))}
                  className={cn(
                    'press flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 t-caption',
                    on
                      ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line-strong),var(--shadow-lift)]'
                      : 'text-ink-3 hover:bg-hover hover:text-ink',
                  )}
                >
                  <PlatformIcon platform={a.platform} size={16} tile />
                  {t(`placement.${x.placement}`)}
                </button>
              </Tooltip>
            )
          })}
        </div>
      )}
      <motion.div
        key={target.key}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={spring.move}
      >
        <PlatformPreview
          {...platformSpec}
          width={width}
          safeZones={safe}
          media={c.media.map((m) => {
            const f = formatFor(m, target, spec)
            return {
              kind: m.kind,
              src: f?.previewUrl ?? null,
              poster: f?.posterUrl ?? m.thumbnailUrl,
              width: f?.width ?? null,
              height: f?.height ?? null,
              duration: f?.duration ?? null,
            }
          })}
          account={{
            name: account.name,
            handle: account.handle || account.name,
            avatarUrl: account.avatarUrl,
          }}
          caption={finalCaption(c.draft, target)}
          title={target.title ?? c.draft.title}
          music={target.music}
          musicSrc={
            target.music ? soundAudioUrl(account.id, target.music.trackId, target.music.previewUrl) : null
          }
          musicStartAt={target.music?.startAt}
          trackSrc={c.media[0] ? (trackFor(c.media[0], target)?.previewUrl ?? null) : null}
          audio={target.audio}
          location={target.location?.name ?? null}
          firstComment={target.firstComment}
          startAt={target.thumbnail.mode === 'frame' ? target.thumbnail.time : undefined}
        />
      </motion.div>
      <label className="mt-4 flex items-center gap-2.5 t-caption text-ink-3">
        <Toggle size="sm" checked={safe} onChange={setSafe} />
        <span>
          <span className="text-ink-2">{t('preview.safeZones')}</span> · {t('preview.safeZonesHint')}
        </span>
      </label>
      <Checks issues={checks} where={where(account.platform, target.placement)} saved={!!target.id} />
    </div>
  )
}

function Checks({
  issues,
  where,
  saved,
}: {
  issues: { level: string; code: string; message: string }[]
  where: string
  saved: boolean
}) {
  const t = useT('posts')
  if (!saved) return null
  const order = { error: 0, warning: 1, info: 2 } as Record<string, number>
  const sorted = [...issues].sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3))
  return (
    <div className="mt-6 w-full">
      <div className="mb-2 t-label">{t('check.title')}</div>
      {!sorted.some((i) => i.level !== 'info') && (
        <div className="mb-1.5 flex items-center gap-2 t-callout text-ok">
          <CircleCheck size={15} />
          {t('check.allGood', { where })}
        </div>
      )}
      <ul className="flex flex-col gap-1.5">
        {sorted.map((i) => {
          const Icon = i.level === 'error' ? OctagonAlert : i.level === 'warning' ? AlertTriangle : Info
          return (
            <li
              key={`${i.code}${i.message}`}
              className={cn(
                'flex items-start gap-2.5 rounded-[9px] px-2.5 py-2 t-caption',
                i.level === 'error'
                  ? 'bg-cut-soft text-cut'
                  : i.level === 'warning'
                    ? 'bg-review-soft text-review'
                    : 'text-ink-3',
              )}
            >
              <Icon size={14} className="mt-px shrink-0" />
              <span className={i.level === 'info' ? 'text-ink-3' : 'text-ink'}>{i.message}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
