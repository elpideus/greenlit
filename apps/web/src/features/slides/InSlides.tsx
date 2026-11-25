import type { Media } from '@greenlit/shared'
import { ArrowUpRight, GalleryHorizontalEnd } from 'lucide-react'
import { Link } from 'react-router'
import { useT } from '@/lib/i18n'

/** In a page's Info tab: the Slides items it is a slide of (the library lists those in its place). */
export function InSlidesSection({ media }: { media: Media }) {
  const t = useT('slides')
  const sets = media.inSlides ?? []
  if (!sets.length) return null
  return (
    <section>
      <div className="mb-1 t-headline text-ink">{t('inSlides')}</div>
      <p className="mb-2 t-caption text-ink-3">{t('inSlidesHint')}</p>
      <div className="flex flex-col gap-1">
        {sets.map((s) => (
          <Link
            key={s.id}
            to={`/media/${s.id}`}
            className="press -mx-2 flex items-center gap-2 rounded-[8px] px-2 py-1.5 t-callout text-ink hover:bg-hover"
          >
            <GalleryHorizontalEnd size={15} strokeWidth={1.75} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate">{s.title || t('common:untitled')}</span>
            <ArrowUpRight size={14} className="shrink-0 text-ink-3" />
          </Link>
        ))}
      </div>
    </section>
  )
}
