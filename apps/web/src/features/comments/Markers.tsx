import type { Media, MediaFormat } from '@greenlit/shared'
import { useViewer } from '@/components/viewer/store'
import { cn } from '@/lib/cn'
import { Avatar } from '@/ui'
import { useNotes } from './api'

/** Notes as lamps on the scrubber: amber while open, green when done. Hover reads the note, click goes there. */
export function NoteMarkers({ media, duration }: { media: Media; format: MediaFormat; duration: number }) {
  const { data } = useNotes('media', media.id)
  const active = useViewer((s) => s.activeNote)
  const hover = useViewer((s) => s.hoverNote)
  const set = useViewer((s) => s.set)
  if (!duration) return null
  const timed = (data ?? []).filter((n) => n.time !== null && n.time <= duration + 0.5)
  return (
    <>
      {timed.map((n) => {
        const lit = n.id === active || n.id === hover
        return (
          <div
            key={n.id}
            className="group/m pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(n.time! / duration) * 100}%` }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={() => set({ hoverNote: n.id })}
            onMouseLeave={() => set({ hoverNote: null })}
          >
            <button
              type="button"
              onClick={() => {
                const s = useViewer.getState()
                s.controls?.pause()
                s.controls?.seek(n.time!)
                set({ activeNote: n.id, tab: 'comments' })
              }}
              className={cn(
                'block size-[9px] rounded-full shadow-[0_0_0_2px_rgba(0,0,0,.7)] transition-transform duration-150',
                n.status === 'done' ? 'bg-signal' : 'bg-review',
                lit ? 'scale-150' : 'hover:scale-150',
              )}
              aria-label={n.body.slice(0, 60)}
            />
            <div
              className={cn(
                'pointer-events-none absolute bottom-full left-1/2 mb-3 w-60 -translate-x-1/2 rounded-[10px] bg-[#1c1e1c]/95 p-2.5 text-left opacity-0 shadow-[0_12px_30px_-8px_rgba(0,0,0,.8),inset_0_0_0_.5px_rgba(255,255,255,.14)] backdrop-blur-md transition-opacity duration-150',
                'group-hover/m:opacity-100',
              )}
            >
              <div className="flex items-center gap-2">
                <Avatar user={n.author} size={18} />
                <span className="truncate t-caption font-[550] text-white">{n.author.displayName}</span>
              </div>
              <div className="mt-1 line-clamp-3 t-caption text-white/75">{n.body}</div>
            </div>
          </div>
        )
      })}
    </>
  )
}
