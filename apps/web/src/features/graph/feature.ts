import type { Media } from '@greenlit/shared'
import { Network, Workflow } from 'lucide-react'
import { createElement, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { defineFeature } from '@/app/feature'
import { i18next } from '@/lib/i18n'
import type { MenuEntry } from '@/ui'
import en from './locales/en.json'
import it from './locales/it.json'
import { ProcessStrip, ProcessTool } from './ProcessStrip'

const t = i18next.getFixedT(null, 'graph')

/** Menus have no router of their own: the host below lends them one. */
let go: ((to: string) => void) | null = null
function Navigator() {
  const navigate = useNavigate()
  useEffect(() => {
    go = navigate
    return () => {
      go = null
    }
  }, [navigate])
  return null
}

/**
 * The production graph: a Graph page with every item of the projects and how each was made from the others (photos
 * and videos taken → AI stills → clips → edits → films → posts), and in the viewer a process strip showing where the
 * item on screen stands in that chain, with what came before and after it.
 */
export default defineFeature({
  id: 'graph',
  locales: { en, it },
  globals: [() => createElement(Navigator)],
  nav: [{ id: 'graph', label: 'nav', to: '/graph', icon: Network, order: 45, permission: 'links.read' }],
  routes: [{ path: '/graph', load: () => import('./GraphPage'), permission: 'links.read' }],
  commands: [
    {
      id: 'graph.open',
      label: 'palette.open',
      icon: Network,
      keywords: ['graph', 'process', 'links', 'production', 'grafo', 'processo', 'collegamenti'],
      permission: 'links.read',
      run: ({ navigate }) => navigate('/graph'),
    },
    {
      id: 'graph.process',
      label: 'palette.process',
      icon: Workflow,
      keywords: ['process', 'graph', 'grafo', 'processo'],
      permission: 'links.read',
      run: ({ navigate }) => navigate('/graph?layout=process'),
    },
  ],
  slots: {
    'media.viewer.tools': [{ id: 'process', order: 60, permission: 'links.read', component: ProcessTool }],
    'media.viewer.drawer': [{ id: 'process', order: 10, permission: 'links.read', component: ProcessStrip }],
  },
  menus: {
    media: [
      {
        id: 'graph',
        order: 15,
        items: ({ items }: { items: Media[] }): MenuEntry[] =>
          items.length === 1
            ? [
                {
                  label: t('menu.showInGraph'),
                  icon: Network,
                  onSelect: () => go?.(`/graph?focus=${encodeURIComponent(`media:${items[0]!.id}`)}`),
                },
              ]
            : [],
      },
    ],
  },
})
