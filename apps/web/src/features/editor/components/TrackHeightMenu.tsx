import { UnfoldVertical } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { IconButton, Menu } from '@/ui'
import { currentPreset, SIZE_PRESETS, type SizePreset, type TrackSizes } from '../trackSizes'

/** Every track at one size: small, medium (the default) or large. */
export function TrackHeightMenu({
  sizes,
  sizeAll,
}: {
  sizes: TrackSizes
  sizeAll: (to: SizePreset) => void
}) {
  const t = useT('editor')
  const now = currentPreset(sizes)
  return (
    <Menu
      align="end"
      width={236}
      trigger={<IconButton size="sm" icon={UnfoldVertical} label={t('timeline.trackHeight')} />}
      header={<div className="px-2 pt-1.5 pb-1 t-micro text-ink-3">{t('timeline.allTracks')}</div>}
      items={[
        ...(Object.keys(SIZE_PRESETS) as SizePreset[]).map((k) => ({
          label: t(`timeline.size.${k}`),
          checked: now === k,
          onSelect: () => sizeAll(k),
        })),
        'separator',
        { group: t('timeline.trackHeightWheel') },
      ]}
    />
  )
}
