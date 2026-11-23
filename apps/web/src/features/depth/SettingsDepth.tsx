import type { DepthAuto, DepthStatus } from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { SavedHint, SettingsGroup, SettingsRow, SettingsSection } from '@/components/SettingsSection'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useTopic } from '@/lib/realtime'
import { Badge, Button, confirm, Segmented, Skeleton, Toggle, toast } from '@/ui'

const KEY = ['depth', 'status'] as const

/**
 * Settings → Depth maps: make them for every new picture and video (or pictures only), what makes them, and making
 * them for everything that has none yet.
 */
export default function SettingsDepth() {
  const t = useT('depth')
  const qc = useQueryClient()
  const [tick, setTick] = useState(0)
  useTopic('library', () => void qc.invalidateQueries({ queryKey: KEY }))
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<DepthStatus>('/depth/status'),
    refetchInterval: (q) => (q.state.data?.queued ? 4000 : 60_000),
  })
  if (!data)
    return (
      <SettingsSection title={t('settings.title')} description={t('settings.description')}>
        <Skeleton className="h-40 rounded-panel" />
        <Skeleton className="h-28 rounded-panel" />
      </SettingsSection>
    )

  const save = async (patch: Partial<DepthAuto>) => {
    try {
      const auto = await api.patch<DepthAuto>('/depth/auto', patch)
      qc.setQueryData<DepthStatus>(KEY, (s) => (s ? { ...s, auto } : s))
      setTick((n) => n + 1)
    } catch (err) {
      toast.error(err)
    }
  }
  const kinds = data.auto.kinds
  const parts = {
    pictures: t('settings.pictures', { count: data.missing.images }),
    videos: t('settings.videos', { count: data.missing.videos }),
  }
  const missing = kinds === 'images' ? data.missing.images : data.missing.images + data.missing.videos
  const makeMissing = async () => {
    if (
      !(await confirm({
        title: t('settings.allTitle', { count: missing }),
        body:
          kinds === 'all' && data.missing.videos ? t('settings.allBodyVideos', parts) : t('settings.allBody'),
        confirm: t('settings.allConfirm'),
      }))
    )
      return
    try {
      const r = await api.post<{ queued: number }>('/depth/generate', { missing: kinds })
      toast.info(t('gen.startedMany', { count: r.queued }))
      void qc.invalidateQueries({ queryKey: KEY })
    } catch (err) {
      toast.error(err)
    }
  }

  // Everything has one: Greenlit's own can be made again (uploaded ones stay).
  const made = kinds === 'images' ? data.made.images : data.made.images + data.made.videos
  const uploaded = kinds === 'images' ? data.uploaded.images : data.uploaded.images + data.uploaded.videos
  const remakeAll = async () => {
    const counts = {
      pictures: t('settings.pictures', { count: data.made.images }),
      videos: t('settings.videos', { count: data.made.videos }),
    }
    const body = [
      kinds === 'all' && data.made.videos ? t('settings.againBodyVideos', counts) : t('settings.againBody'),
      uploaded ? t('settings.againUploaded', { count: uploaded }) : '',
    ]
    if (
      !(await confirm({
        title: t('settings.againTitle', { count: made }),
        body: body.filter(Boolean).join(' '),
        confirm: t('settings.againConfirm'),
      }))
    )
      return
    try {
      const r = await api.post<{ queued: number }>('/depth/generate', { everything: kinds, again: true })
      toast.info(t('gen.startedMany', { count: r.queued }))
      void qc.invalidateQueries({ queryKey: KEY })
    } catch (err) {
      toast.error(err)
    }
  }

  const remakeOutdated = async () => {
    try {
      const r = await api.post<{ queued: number }>('/depth/generate', { outdated: true })
      toast.info(t('gen.startedMany', { count: r.queued }))
      void qc.invalidateQueries({ queryKey: KEY })
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <SettingsSection title={t('settings.title')} description={t('settings.description')}>
      <SettingsGroup title={t('settings.auto')} aside={<SavedHint tick={tick} label={t('settings.saved')} />}>
        <SettingsRow inline label={t('settings.autoOn')} description={t('settings.autoOnHint')}>
          <Toggle checked={data.auto.enabled} onChange={(enabled) => void save({ enabled })} />
        </SettingsRow>
        <div
          className={cn(
            'border-t border-line transition-opacity duration-200',
            !data.auto.enabled && 'pointer-events-none opacity-45',
          )}
        >
          <SettingsRow label={t('settings.kinds')} description={t('settings.kindsHint')}>
            <Segmented<DepthAuto['kinds']>
              value={kinds}
              onChange={(v) => void save({ kinds: v })}
              options={[
                { value: 'all', label: t('settings.kindsAll') },
                { value: 'images', label: t('settings.kindsImages') },
              ]}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.library')}>
        <SettingsRow
          label={
            missing
              ? t(kinds === 'images' ? 'settings.missingImages' : 'settings.missing', {
                  count: missing,
                  ...parts,
                })
              : t('settings.noneMissing')
          }
          description={data.queued ? t('settings.queued', { count: data.queued }) : t('settings.missingHint')}
        >
          {missing ? (
            <Button size="sm" icon={Sparkles} onClick={() => void makeMissing()}>
              {t('settings.allButton')}
            </Button>
          ) : (
            <Button size="sm" icon={Sparkles} disabled={!made} onClick={() => void remakeAll()}>
              {t('settings.againButton')}
            </Button>
          )}
        </SettingsRow>
        {data.outdated.images + data.outdated.videos > 0 && (
          <SettingsRow
            label={t('settings.outdated', { count: data.outdated.images + data.outdated.videos })}
            description={t('settings.outdatedHint', { model: data.models[0]?.name ?? '' })}
          >
            <Button size="sm" icon={Sparkles} onClick={() => void remakeOutdated()}>
              {t('settings.outdatedButton')}
            </Button>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('settings.model')} description={t('settings.modelHint')}>
        {data.models.map((m) => (
          <SettingsRow key={m.id} label={m.name} description={t(`settings.for.${m.for}`)}>
            <div className="flex items-center gap-2 t-caption text-ink-3">
              <Badge tone="neutral">{m.license}</Badge>
              {m.backend && (
                <Badge tone={m.backend === 'cpu' ? 'neutral' : 'signal'}>
                  {m.backend === 'cpu' ? t('settings.processor') : m.backend === 'cuda' ? 'CUDA' : 'WebGPU'}
                </Badge>
              )}
              {m.installed ? (
                <Badge tone="signal">{t('settings.installed')}</Badge>
              ) : (
                <span>{t('settings.notInstalled', { size: formatBytes(m.size) })}</span>
              )}
            </div>
          </SettingsRow>
        ))}
        <RunsOn device={data.device} />
      </SettingsGroup>
    </SettingsSection>
  )
}

/** Where the model runs: the graphics card (and through what) or the processor, and why not the card. */
function RunsOn({ device }: { device: DepthStatus['device'] }) {
  const t = useT('depth')
  const card = device.gpus[0]?.name ?? t('settings.gpuGeneric')
  // What this machine offers (the models then use the best of it they can; see their own badges above).
  const best = device.off ? 'cpu' : device.order[0]
  const label = best === 'cpu' ? t('settings.processor') : `${card} · ${best === 'cuda' ? 'CUDA' : 'WebGPU'}`
  const hint = device.off
    ? t('settings.gpuOff')
    : best === 'cuda'
      ? t('settings.gpuOn')
      : best === 'webgpu'
        ? t('settings.gpuWebgpu')
        : device.gpus.length
          ? t('settings.gpuUnused', { card })
          : t('settings.noGpu')
  return (
    <SettingsRow label={t('settings.runsOn')} description={hint}>
      <Badge tone={best === 'cpu' ? 'neutral' : 'signal'}>{label}</Badge>
    </SettingsRow>
  )
}
