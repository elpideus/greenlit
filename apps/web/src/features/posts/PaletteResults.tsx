import { Command } from 'cmdk'
import { Send } from 'lucide-react'
import { type PaletteResultsProps, paletteGroupClass, paletteItemClass } from '@/app/CommandPalette'
import { PlatformIcon } from '@/components/PlatformIcon'
import { useT } from '@/lib/i18n'
import { Tally } from '@/ui'
import { usePosts } from './api'
import { firstLine, postTone } from './parts'

/** ⌘K: posts whose name, title or caption match. */
export function PostsPaletteResults({ query, go }: PaletteResultsProps) {
  const t = useT('posts')
  const { data } = usePosts()
  const q = query.toLowerCase()
  const hits = (data ?? [])
    .filter((p) => `${p.name} ${p.title} ${p.caption}`.toLowerCase().includes(q))
    .slice(0, 6)
  if (!hits.length) return null
  return (
    <Command.Group heading={t('palette.group')} className={paletteGroupClass}>
      {hits.map((p) => {
        const label = p.name || p.title || firstLine(p.caption) || t('untitled')
        const platforms = [...new Set(p.targets.filter((x) => x.state !== 'removed').map((x) => x.platform))]
        return (
          <Command.Item
            key={p.id}
            value={`post ${p.id} ${label} ${query}`}
            onSelect={() => go(`/posts/${p.id}`)}
            className={paletteItemClass}
          >
            {p.media[0]?.thumbnailUrl ? (
              <img src={p.media[0].thumbnailUrl} alt="" className="size-7 rounded-[6px] object-cover" />
            ) : (
              <Send size={16} className="text-ink-3" />
            )}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="flex items-center gap-1">
              {platforms.map((pl) => (
                <PlatformIcon key={pl} platform={pl} size={14} />
              ))}
            </span>
            <Tally tone={postTone(p.status)} size={7} />
          </Command.Item>
        )
      })}
    </Command.Group>
  )
}
