import { Command } from 'cmdk'
import { MapPin } from 'lucide-react'
import { type PaletteResultsProps, paletteGroupClass, paletteItemClass } from '@/app/CommandPalette'
import { useT } from '@/lib/i18n'
import { useKnownPlaces } from './api'

/** ⌘K: places already used in Greenlit; picking one opens it on the map. */
export function PlacesPaletteResults({ query, go }: PaletteResultsProps) {
  const t = useT('places')
  const { data } = useKnownPlaces(query)
  if (!data?.length) return null
  return (
    <Command.Group heading={t('palette')} className={paletteGroupClass}>
      {data.map((p) => (
        <Command.Item
          key={p.id}
          value={`place ${p.name} ${p.address} ${query}`}
          onSelect={() => go(`/map?focus=place:${p.id}`)}
          className={paletteItemClass}
        >
          <MapPin size={16} strokeWidth={1.75} className="text-ink-3" />
          <span className="min-w-0 flex-1 truncate">
            {p.name}
            {p.address && <span className="ml-2 t-caption text-ink-3">{p.address}</span>}
          </span>
          <span className="t-meta text-ink-4">{t('used', { count: p.usage })}</span>
        </Command.Item>
      ))}
    </Command.Group>
  )
}
