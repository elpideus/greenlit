import type { Media } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { Folder } from 'lucide-react'
import type { PaletteResultsProps } from '@/app/CommandPalette'
import { paletteGroupClass, paletteItemClass } from '@/app/CommandPalette'
import { MediaThumb } from '@/components/MediaThumb'
import { useProjects } from '@/data/projects'
import { api } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Tally, toneFor } from '@/ui'

/** ⌘K results: media matching the query (server search, tokens included) and projects by name. */
export function PaletteResults({ query, go }: PaletteResultsProps) {
  const t = useT('library')
  const tc = useT()
  const { data } = useQuery({
    queryKey: ['media', 'palette', query],
    queryFn: ({ signal }) => api.get<{ items: Media[] }>('/media', { q: query, limit: 6 }, signal),
    staleTime: 10_000,
  })
  const { data: projects } = useProjects()
  const words = query.toLowerCase()
  const matchingProjects = (projects ?? []).filter((p) => p.name.toLowerCase().includes(words)).slice(0, 4)
  return (
    <>
      {matchingProjects.length > 0 && (
        <Command.Group heading={t('palette.projects')} className={paletteGroupClass}>
          {matchingProjects.map((p) => (
            <Command.Item
              key={p.id}
              value={`project ${p.name} ${query}`}
              onSelect={() => go(`/projects/${p.id}`)}
              className={paletteItemClass}
            >
              <span className="grid size-7 place-items-center overflow-hidden rounded-[6px] bg-hover text-ink-3">
                {p.coverUrl ? (
                  <img src={p.coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <Folder size={14} />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="t-meta text-ink-4">{p.mediaCount}</span>
            </Command.Item>
          ))}
        </Command.Group>
      )}
      {!!data?.items.length && (
        <Command.Group heading={t('palette.media')} className={paletteGroupClass}>
          {data.items.map((m) => (
            <Command.Item
              key={m.id}
              value={`media ${m.title} ${m.id} ${query}`}
              onSelect={() => go(`/media/${m.id}`)}
              className={paletteItemClass}
            >
              <MediaThumb media={m} className="h-7 w-11 shrink-0" rounded showDuration={false} />
              <span className="min-w-0 flex-1 truncate">{m.title || tc('untitled')}</span>
              <Tally tone={toneFor(m.status)} size={7} />
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </>
  )
}
