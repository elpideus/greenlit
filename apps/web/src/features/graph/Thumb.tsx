import type { GraphNode } from '@greenlit/shared'
import { Clapperboard, FileText, Film, Image as ImageIcon, Music, Send } from 'lucide-react'
import { cn } from '@/lib/cn'

const KIND_ICON = {
  video: Film,
  image: ImageIcon,
  audio: Music,
  document: FileText,
  composition: Clapperboard,
  post: Send,
} as const

export function Thumb({ node, className }: { node: GraphNode; className?: string }) {
  const Icon =
    KIND_ICON[(node.type === 'media' ? node.kind : node.type) as keyof typeof KIND_ICON] ?? FileText
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-[5px] bg-well',
        className,
      )}
    >
      {node.thumbnailUrl ? (
        <img src={node.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Icon size={14} className="text-ink-3" />
      )}
    </span>
  )
}
