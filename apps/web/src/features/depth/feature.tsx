import type { Me, Media, MediaFormat } from '@greenlit/shared'
import { Mountain, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { defineFeature } from '@/app/feature'
import { i18next } from '@/lib/i18n'
import { can } from '@/lib/session'
import type { MenuEntry } from '@/ui'
import { BulkDepth } from './BulkDepth'
import { generateDepth, generateDepthMany } from './generate'
import en from './locales/en.json'
import it from './locales/it.json'
import { DepthMapsButton, DepthMatchHost, useDepthMatch } from './MatchDialog'
import { DepthOverlay, DepthSplitHandle } from './Overlay'
import { DepthSection } from './Section'
import { addDepthMap, DepthTool, formatName } from './Tool'

const t = i18next.getFixedT(null, 'depth')
const pictureOrVideo = (p: { format: MediaFormat }) => p.format.kind === 'image' || p.format.kind === 'video'

/**
 * Depth maps, kept beside the format they describe: uploaded (made elsewhere; matched to many items at once by file
 * name) or made by Greenlit (the depth server module: on request, for a selection, or for every new upload with the
 * setting on). Shown in the viewer (in place of the picture, split with it or in 3D), listed in Info, and found with
 * has:depth / no:depth in the library.
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
    {
      id: 'depth.settings',
      label: 'palette.settings',
      icon: Sparkles,
      permission: 'depth.manage',
      keywords: ['depth', 'automatic', 'generate', 'profondità', 'automatico', 'genera'],
      run: ({ navigate }) => navigate('/settings/depth'),
    },
  ],
  settings: [
    {
      id: 'depth',
      label: 'settings.title',
      icon: Mountain,
      group: 'workspace',
      order: 60,
      permission: 'depth.manage',
      load: () => import('./SettingsDepth'),
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
    'media.bulk': [{ id: 'depth', order: 60, component: BulkDepth, permission: 'media.upload' }],
  },
  menus: {
    media: [{ id: 'depth', order: 85, items: mediaMenuItems }],
  },
})

/**
 * Right-click on pictures and videos: make their depth maps, and (one item) add or replace its main format's map
 * with a file.
 */
function mediaMenuItems({ items, me }: { items: Media[]; me: Me }): MenuEntry[] {
  if (!can(me, 'media.upload')) return []
  const usable = items.filter((m) => m.kind === 'image' || m.kind === 'video')
  if (!usable.length) return []
  if (usable.length > 1 || items.length > 1)
    return [
      {
        label: t('menu.makeMany', { count: usable.length }),
        icon: Sparkles,
        onSelect: () =>
          void generateDepthMany(
            usable.map((m) => m.id),
            t,
          ),
      },
    ]
  const media = usable[0]!
  const format = media.formats.find((f) => f.isPrimary) ?? media.formats[0]
  if (!format || (format.kind !== 'image' && format.kind !== 'video')) return []
  const own = media.depthMaps.find((d) => d.key === format.key && d.version === format.version)
  return [
    {
      label: own?.depth?.generated ? t('gen.again') : own ? t('gen.instead') : t('gen.make'),
      icon: Sparkles,
      onSelect: () => void generateDepth(media, format, t, formatName(media, format)),
    },
    {
      label: own ? t('menu.replace') : t('menu.add'),
      icon: own ? RefreshCw : Upload,
      onSelect: () => void addDepthMap(media, format, t),
    },
  ]
}
