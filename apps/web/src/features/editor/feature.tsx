import type { Me, Media, Project } from '@greenlit/shared'
import { Command } from 'cmdk'
import { Clapperboard, Plus } from 'lucide-react'
import { type PaletteResultsProps, paletteGroupClass, paletteItemClass } from '@/app/CommandPalette'
import { defineFeature } from '@/app/feature'
import { i18next, useT } from '@/lib/i18n'
import { can } from '@/lib/session'
import { useCompositions } from './api'
import { EditsTab } from './EditsTab'
import en from './locales/en.json'
import it from './locales/it.json'
import { NewEditHost, openNewEdit } from './NewEdit'

/** ⌘K results: edits whose name matches. */
function PaletteEdits({ query, go }: PaletteResultsProps) {
  const t = useT('editor')
  const { data } = useCompositions()
  const q = query.toLowerCase()
  const hits = (data ?? []).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6)
  if (!hits.length) return null
  return (
    <Command.Group heading={t('edits.searchGroup')} className={paletteGroupClass}>
      {hits.map((c) => (
        <Command.Item
          key={c.id}
          value={`edit ${c.name} ${c.id}`}
          onSelect={() => go(`/edit/${c.id}`)}
          className={paletteItemClass}
        >
          {c.posterUrl ? (
            <img src={c.posterUrl} alt="" className="h-6 w-10 rounded-[4px] object-cover" />
          ) : (
            <Clapperboard size={16} strokeWidth={1.75} className="text-ink-3" />
          )}
          <span className="flex-1 truncate">{c.name}</span>
          <span className="t-meta text-ink-4">{c.document.formats.map((f) => f.name).join(' · ')}</span>
        </Command.Item>
      ))}
    </Command.Group>
  )
}

export default defineFeature({
  id: 'editor',
  locales: { en, it },
  routes: [
    {
      path: '/edit/:id',
      layout: 'full',
      load: () => import('./EditorPage'),
      permission: 'compositions.read',
    },
    // The headless renderer's page (token-authenticated by the render session, no sign-in).
    { path: '/render/:id', layout: 'public', load: () => import('./RenderPage') },
  ],
  slots: {
    'project.tabs': [
      {
        id: 'edits',
        order: 20,
        label: 'Edits',
        icon: Clapperboard,
        permission: 'compositions.read',
        component: EditsTab as React.ComponentType<{ project: Project }>,
      },
    ],
    'palette.results': [{ id: 'edits', order: 40, permission: 'compositions.read', component: PaletteEdits }],
  },
  menus: {
    media: [
      {
        id: 'new-edit',
        order: 40,
        items: ({ items, me }: { items: Media[]; me: Me }) => {
          const usable = items.filter((m) => ['video', 'image', 'audio'].includes(m.kind))
          if (!usable.length || !can(me, 'compositions.edit')) return []
          return [
            {
              label:
                usable.length > 1
                  ? i18next.t('editor:edits.newWithMany', { count: usable.length })
                  : i18next.t('editor:edits.newWith'),
              icon: Clapperboard,
              onSelect: () => openNewEdit({ projectId: usable[0]!.projectId, media: usable }),
            },
          ]
        },
      },
    ],
  },
  commands: [
    {
      id: 'new-edit',
      label: 'edits.new',
      icon: Plus,
      keywords: ['edit', 'video', 'composition', 'montaggio', 'timeline'],
      permission: 'compositions.edit',
      run: () => openNewEdit(),
    },
  ],
  globals: [NewEditHost],
})
