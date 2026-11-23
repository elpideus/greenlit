import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink, Folder, MoreHorizontal, X, ZoomIn } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { kindIcon } from '@/components/MediaThumb'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { ease, spring } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useCan } from '@/lib/session'
import { IconButton, InlineEdit, Menu, toast } from '@/ui'
import { type PlaceGroup, usePlace } from './api'

/**
 * What is at a place: its projects, then its media. A floating panel on the right on wide screens, a bottom sheet on
 * phones. Projects open their page, media open the viewer.
 */
export function PlaceCard({
  group,
  sheet,
  onClose,
  onZoom,
}: {
  group: PlaceGroup
  sheet: boolean
  onClose: () => void
  onZoom: () => void
}) {
  const t = useT('map')
  const qc = useQueryClient()
  const canManage = useCan('places.manage')
  const { data: place } = usePlace(group.place.id)
  const rename = useMutation({
    mutationFn: (name: string) => api.patch(`/places/${group.place.id}`, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.places })
      void qc.invalidateQueries({ queryKey: qk.mapPoints })
    },
    onError: (e) => toast.error(e),
  })
  const coords = `${group.place.lat.toFixed(5)}, ${group.place.lng.toFixed(5)}`
  const subtitle = place?.address || coords

  const body = (
    <>
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="t-headline flex min-w-0 text-ink">
            {canManage ? (
              <InlineEdit value={group.place.name} onSave={(v) => rename.mutate(v)} className="t-headline" />
            ) : (
              <span className="truncate">{group.place.name}</span>
            )}
          </div>
          <div className="mt-0.5 truncate t-caption text-ink-3" title={subtitle}>
            {subtitle}
          </div>
        </div>
        <Menu
          align="end"
          trigger={<IconButton icon={MoreHorizontal} label={t('common:more')} size="sm" />}
          items={[
            { label: t('card.zoomTo'), icon: ZoomIn, onSelect: onZoom },
            {
              label: t('card.copyCoords'),
              icon: Copy,
              onSelect: () => {
                void navigator.clipboard.writeText(coords).then(() => toast.done(t('card.coordsCopied')))
              },
            },
            {
              label: t('card.openOsm'),
              icon: ExternalLink,
              onSelect: () =>
                window.open(
                  `https://www.openstreetmap.org/?mlat=${group.place.lat}&mlon=${group.place.lng}#map=17/${group.place.lat}/${group.place.lng}`,
                  '_blank',
                  'noopener',
                ),
            },
          ]}
        />
        <IconButton icon={X} label={t('card.close')} size="sm" onClick={onClose} />
      </div>

      <div
        className={cn(
          'overflow-y-auto overscroll-contain px-2 pb-2',
          sheet ? 'max-h-[46dvh]' : 'max-h-[calc(100dvh-var(--bar-h)-170px)]',
        )}
      >
        {group.projects.length > 0 && (
          <>
            <div className="px-2 pt-1 pb-1.5 t-micro text-ink-3">{t('projects')}</div>
            {group.projects.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, ease, delay: i * 0.03 }}
              >
                <Link
                  to={`/projects/${p.id}`}
                  className="press flex items-center gap-3 rounded-[10px] p-2 hover:bg-hover"
                >
                  <Cover url={p.thumbnailUrl} className="size-14 rounded-[9px]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate t-callout font-[550] text-ink">
                      <Folder size={13} strokeWidth={1.9} className="shrink-0 text-ink-3" />
                      <span className="truncate">{p.title}</span>
                    </span>
                    {p.mediaCount != null && (
                      <span className="mt-0.5 block t-caption text-ink-3">
                        {t('card.mediaCount', { count: p.mediaCount })}
                      </span>
                    )}
                  </span>
                </Link>
              </motion.div>
            ))}
          </>
        )}
        {group.media.length > 0 && (
          <>
            <div className="px-2 pt-3 pb-1.5 t-micro text-ink-3">{t('media')}</div>
            <div className="grid grid-cols-3 gap-1.5 px-1">
              {group.media.map((m, i) => {
                const Icon = kindIcon(m.kind ?? 'other')
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ ...spring.snap, delay: Math.min(i, 12) * 0.02 }}
                  >
                    <Link
                      to={`/media/${m.id}`}
                      className="press group block"
                      title={m.projectName ? `${m.title} — ${m.projectName}` : m.title}
                    >
                      <Cover url={m.thumbnailUrl} className="aspect-square w-full rounded-[8px]">
                        {m.kind === 'video' && (
                          <span className="absolute right-1 bottom-1 grid size-5 place-items-center rounded-[5px] bg-black/50 text-white backdrop-blur-md">
                            <Icon size={11} strokeWidth={2} />
                          </span>
                        )}
                      </Cover>
                      <span className="mt-1 block truncate px-0.5 t-caption text-ink-2 group-hover:text-ink">
                        {m.title}
                      </span>
                    </Link>
                  </motion.div>
                )
              })}
            </div>
          </>
        )}
        {!group.items.length && (
          <div className="px-3 py-6 text-center t-callout text-ink-3">{t('card.nothingHere')}</div>
        )}
      </div>
    </>
  )

  if (sheet)
    return (
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={spring.sheet}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 90 || info.velocity.y > 600) onClose()
        }}
        className="floating absolute inset-x-2 bottom-2 z-20 overflow-hidden rounded-sheet"
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong" />
        {body}
      </motion.div>
    )

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24, filter: 'blur(4px)' }}
      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: 16, filter: 'blur(3px)', transition: { duration: 0.16 } }}
      transition={{ duration: 0.34, ease }}
      className="floating absolute top-4 right-4 z-20 w-[360px] overflow-hidden"
    >
      {body}
    </motion.aside>
  )
}

function Cover({
  url,
  className,
  children,
}: {
  url: string | null
  className?: string
  children?: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'relative block shrink-0 overflow-hidden bg-stage shadow-[inset_0_0_0_.5px_var(--line)]',
        className,
      )}
    >
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          draggable={false}
        />
      )}
      {children}
    </span>
  )
}
