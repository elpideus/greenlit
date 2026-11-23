import { placementName, placementsForKind } from '@greenlit/platforms'
import type { Media, MediaFormat, Placement, Platform } from '@greenlit/shared'
import { Smartphone, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PLATFORM_NAME, PlatformIcon } from '@/components/PlatformIcon'
import { PlatformPreview } from '@/components/platform-preview'
import { useViewer, viewer } from '@/components/viewer/store'
import { useAccounts } from '@/data/accounts'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { spring } from '@/lib/motion'
import { useConfig } from '@/lib/session'
import { IconButton, Menu, type MenuEntry, Segmented, Toggle } from '@/ui'
import { PLATFORM_ORDER } from './model'

function placementsFor(kind: string) {
  return placementsForKind(kind === 'image' ? 'image' : 'video').filter((p) => p.key !== 'youtube.post')
}

/** Viewer top bar: "Preview on…" picks a platform surface to see the frame as people will. */
export function PreviewTool({ media }: { media: Media; format?: MediaFormat }) {
  const t = useT('posts')
  const previewAs = useViewer((s) => s.previewAs)
  const set = useViewer((s) => s.set)
  const specs = placementsFor(media.kind)
  const items: MenuEntry[] = []
  for (const platform of PLATFORM_ORDER) {
    const list = specs.filter((s) => s.platform === platform)
    if (!list.length) continue
    items.push({ group: PLATFORM_NAME[platform] })
    for (const s of list) {
      const placement = placementName(s.key) as Placement
      items.push({
        label: t(`placement.${placement}`),
        checked: previewAs?.platform === platform && previewAs.placement === placement,
        onSelect: () => set({ previewAs: { platform, placement } }),
      })
    }
  }
  return (
    <Menu
      align="end"
      width={220}
      items={items}
      trigger={<IconButton icon={Smartphone} label={t('menu.previewOn')} active={!!previewAs || undefined} />}
    />
  )
}

/** Over the viewer while previewing: the frame inside the chosen platform's app, interactive. */
export function PreviewOverlay({ media, format }: { media: Media; format: MediaFormat }) {
  const previewAs = useViewer((s) => s.previewAs)
  return createPortal(
    <AnimatePresence>
      {previewAs && <PreviewLayer key="layer" media={media} format={format} as={previewAs} />}
    </AnimatePresence>,
    document.body,
  )
}

function PreviewLayer({
  media,
  format,
  as,
}: {
  media: Media
  format: MediaFormat
  as: { platform: Platform; placement: Placement }
}) {
  const t = useT('posts')
  const set = useViewer((s) => s.set)
  const { data: accounts } = useAccounts()
  const { data: config } = useConfig()
  const [safe, setSafe] = useState(false)
  const [startAt] = useState(() => viewer.get().time)
  const [h, setH] = useState(() => window.innerHeight)
  useEffect(() => {
    viewer.pause()
    const on = () => setH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const close = () => set({ previewAs: null })
  useHotkey('escape', close)

  const specs = placementsFor(media.kind)
  const platforms = PLATFORM_ORDER.filter((p) => specs.some((s) => s.platform === p))
  const placements = specs
    .filter((s) => s.platform === as.platform)
    .map((s) => placementName(s.key) as Placement)
  const account = (accounts ?? []).find(
    (a) => a.platform === as.platform && !a.mergedInto && a.state !== 'disabled',
  )
  const phoneH = Math.min(h - 150, 800)
  const width = Math.round((phoneH * 390) / 844)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="force-dark fixed inset-0 z-[60] flex flex-col items-center bg-[rgba(6,7,6,.86)] backdrop-blur-xl"
    >
      <div className="flex w-full items-center gap-3 px-5 pt-4">
        <div className="flex items-center gap-1 rounded-control bg-white/[.06] p-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]">
          {platforms.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                const first = specs.find((s) => s.platform === p)
                if (first)
                  set({ previewAs: { platform: p, placement: placementName(first.key) as Placement } })
              }}
              className={`press flex h-8 items-center gap-2 rounded-[calc(var(--r-control)-3px)] px-2.5 t-callout ${p === as.platform ? 'bg-white/[.12] text-white' : 'text-white/55 hover:text-white'}`}
            >
              <PlatformIcon platform={p} size={15} />
              {PLATFORM_NAME[p]}
            </button>
          ))}
        </div>
        {placements.length > 1 && (
          <Segmented
            value={as.placement}
            onChange={(v) => set({ previewAs: { platform: as.platform, placement: v } })}
            options={placements.map((p) => ({ value: p, label: t(`placement.${p}`) }))}
          />
        )}
        <label className="ml-auto flex items-center gap-2.5 t-callout text-white/70">
          {t('preview.safeZones')}
          <Toggle checked={safe} onChange={setSafe} size="sm" />
        </label>
        <IconButton icon={X} label={t('preview.close')} shortcut="escape" onClick={close} />
      </div>
      <motion.div
        key={`${as.platform}.${as.placement}`}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring.move}
        className="mt-6"
      >
        <PlatformPreview
          platform={as.platform}
          placement={as.placement}
          width={width}
          safeZones={safe}
          startAt={startAt}
          media={[
            {
              kind: format.kind,
              src:
                format.kind === 'image'
                  ? (format.urls.poster ?? format.urls.original)
                  : (format.urls.preview ?? format.urls.original),
              poster: format.urls.poster,
              width: format.width,
              height: format.height,
              duration: format.duration,
            },
          ]}
          account={{
            name: account?.name ?? config?.branding.appName ?? 'Greenlit',
            handle: account?.handle || account?.name || config?.branding.appName || 'greenlit',
            avatarUrl: account?.avatarUrl ?? config?.branding.mark ?? null,
          }}
          caption={media.description || media.title}
          title={media.title}
        />
      </motion.div>
    </motion.div>
  )
}
