import { depthMapFor, type Media, type MediaFormat } from '@greenlit/shared'
import type { TFunction as T } from 'i18next'
import { Box, Columns2, Download, Image, Mountain, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { useCan } from '@/lib/session'
import { IconButton, Menu, type MenuEntry, toast } from '@/ui'
import { generateDepth, generatedState, useDepthJob } from './generate'
import { useShownDepth } from './Overlay'
import { canShow3d } from './Parallax'
import { type DepthView, useDepthView } from './store'
import { fileKind, pickDepthFile, uploadDepth } from './upload'

/** A format's name in messages: "Main", or "Main · English" when the item has versions. */
export function formatName(media: Pick<Media, 'versions'>, format: MediaFormat) {
  const version = media.versions.length > 1 ? media.versions.find((v) => v.key === format.version)?.label : ''
  return version ? `${format.label} · ${version}` : format.label
}

/** Adds (or replaces) the depth map of a format: file picker, kind check, upload. */
export async function addDepthMap(media: Media, format: MediaFormat, t: T) {
  const file = await pickDepthFile()
  if (!file) return false
  return addDepthFile(media, format, file, t)
}

export async function addDepthFile(media: Media, format: MediaFormat, file: File, t: T) {
  const kind = fileKind(file)
  if (kind !== format.kind) {
    toast.error(t(format.kind === 'video' ? 'needVideo' : 'needPicture'))
    return false
  }
  const replacing = media.depthMaps.some((d) => d.key === format.key && d.version === format.version)
  const name = formatName(media, format)
  toast.info(t(replacing ? 'replacing' : 'uploading', { name: file.name, format: name }))
  const ok = await uploadDepth(media, format, file)
  if (ok) toast.done(t(replacing ? 'replaced' : 'added', { format: name }))
  else toast.error(t('failed', { name: file.name }))
  return ok
}

/**
 * In the viewer's top bar for pictures and videos: how to show the frame (picture, depth map, split, 3D) when it has
 * a depth map, and adding or replacing one. `D` switches between the picture and the last depth view.
 */
export function DepthTool({ media, format }: { media: Media; format: MediaFormat }) {
  const t = useT('depth')
  const canUpload = useCan('media.upload')
  const view = useDepthView((s) => s.view)
  const setView = useDepthView((s) => s.setView)
  const toggle = useDepthView((s) => s.toggle)
  const found = depthMapFor(media, format)
  const shown = useShownDepth(media, format)
  const job = useDepthJob(media, format)
  useHotkey('d', toggle, { enabled: !!shown })
  if (!found && !canUpload) return null

  const views: { value: DepthView; icon: typeof Image; label: string }[] = [
    { value: 'picture', icon: Image, label: t('view.picture') },
    { value: 'depth', icon: Mountain, label: t('view.depth') },
    { value: 'split', icon: Columns2, label: t('view.split') },
    { value: '3d', icon: Box, label: t('view.3d') },
  ]
  const own = found && !found.inherited
  const generated = own ? generatedState(found.map, format) : null
  const name = formatName(media, format)
  const items: MenuEntry[] = [
    job && {
      label: t(job.state === 'queued' ? 'gen.queued' : 'gen.making', { n: Math.round(job.progress * 100) }),
      icon: Sparkles,
      disabled: true,
    },
    job && 'separator',
    found && { group: !shown ? t('preparing') : found.inherited ? t('fromMain') : t('show') },
    ...(found
      ? views.map((v) => ({
          label: v.label,
          icon: v.icon,
          checked: view === v.value || (v.value === 'picture' && !shown),
          disabled: (v.value !== 'picture' && !shown) || (v.value === '3d' && !canShow3d()),
          hint: v.value === '3d' && !canShow3d() ? t('no3dShort') : undefined,
          onSelect: () => setView(v.value),
        }))
      : []),
    found && 'separator',
    canUpload &&
      !job && {
        label: generated
          ? t('gen.again')
          : own
            ? t('gen.instead')
            : found
              ? t('gen.forVersion')
              : t('gen.make'),
        icon: Sparkles,
        hint: generated?.stale ? t('gen.staleShort') : undefined,
        onSelect: () => void generateDepth(media, format, t, name),
      },
    canUpload &&
      (own
        ? {
            label: t('replace', { format: format.label }),
            icon: RefreshCw,
            onSelect: () => void addDepthMap(media, format, t),
          }
        : {
            label: found ? t('addForVersion') : t('add', { format: format.label }),
            icon: Upload,
            onSelect: () => void addDepthMap(media, format, t),
          }),
    found && {
      label: t('download'),
      icon: Download,
      onSelect: () => window.open(found.map.urls.download, '_self'),
    },
  ]
  const active = !!shown && view !== 'picture'
  return (
    <Menu
      align="end"
      width={248}
      items={items}
      trigger={
        <IconButton
          icon={Mountain}
          label={found ? t('tool') : t('add', { format: format.label })}
          shortcut={shown ? 'd' : undefined}
          active={active || undefined}
        />
      }
    />
  )
}
