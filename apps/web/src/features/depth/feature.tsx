import type { Me, Media, MediaFormat } from '@greenlit/shared'
import { Mountain, RefreshCw, Upload } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { i18next } from '@/lib/i18n'
import { can } from '@/lib/session'
import type { MenuEntry } from '@/ui'
import en from './locales/en.json'
import it from './locales/it.json'
import { DepthMapsButton, DepthMatchHost, useDepthMatch } from './MatchDialog'
import { DepthOverlay, DepthSplitHandle } from './Overlay'
import { DepthSection } from './Section'
import { addDepthMap, DepthTool } from './Tool'

const t = i18next.getFixedT(null, 'depth')
const pictureOrVideo = (p: { format: MediaFormat }) => p.format.kind === 'image' || p.format.kind === 'video'

/**
 * Depth maps made elsewhere, kept beside the format they describe: shown in the viewer (in place of the picture,
 * split with it or in 3D), listed in Info, matched to many items at once by file name, and found with has:depth /
 * no:depth in the library. Greenlit never makes depth maps itself.
 */
export default defineFeature({
  id: 'depth',
  locales: { en, it },
  globals: [DepthMatchHost],
  commands: [
    {
      id: 'depth.match',
      label: 'palette.match',
      icon: Mountain,
      permission: 'media.upload',
      keywords: ['depth', 'depth map', 'disparity', 'profondità', 'mappa'],
      run: () => useDepthMatch.getState().show(null),
    },
  ],
  slots: {
    'media.viewer.tools': [{ id: 'depth', order: 30, component: DepthTool, when: pictureOrVideo }],
    // Under the notes (50), so pins stay on top; the split line above them, so it can be dragged.
    'media.viewer.overlay': [
      { id: 'depth', order: 5, component: DepthOverlay, when: pictureOrVideo },
      { id: 'depth-split', order: 95, component: DepthSplitHandle, when: pictureOrVideo },
    ],
    'media.info.sections': [{ id: 'depth', order: 30, component: DepthSection, when: pictureOrVideo }],
    'library.toolbar': [{ id: 'depth', order: 20, component: DepthMapsButton, permission: 'media.upload' }],
  },
  menus: {
    media: [{ id: 'depth', order: 85, items: mediaMenuItems }],
  },
})

/** Right-click on one picture or video: add (or replace) the depth map of its main format. */
function mediaMenuItems({ items, me }: { items: Media[]; me: Me }): MenuEntry[] {
  if (items.length !== 1 || !can(me, 'media.upload')) return []
  const media = items[0]!
  const format = media.formats.find((f) => f.isPrimary) ?? media.formats[0]
  if (!format || (format.kind !== 'image' && format.kind !== 'video')) return []
  const has = media.depthMaps.some((d) => d.key === format.key && d.version === format.version)
  return [
    {
      label: has ? t('menu.replace') : t('menu.add'),
      icon: has ? RefreshCw : Upload,
      onSelect: () => void addDepthMap(media, format, t),
    },
  ]
}
