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
          <Button size="sm" icon={Sparkles} disabled={!missing} onClick={() => void makeMissing()}>
            {t('settings.allButton')}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.model')}>
        <SettingsRow label={data.model.name} description={t('settings.modelHint')}>
          <div className="flex items-center gap-2 t-caption text-ink-3">
            <Badge tone="neutral">{data.model.license}</Badge>
            {data.model.installed ? (
              <Badge tone="signal">{t('settings.installed')}</Badge>
            ) : (
              <span>{t('settings.notInstalled', { size: formatBytes(data.model.size) })}</span>
            )}
          </div>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  )
}
