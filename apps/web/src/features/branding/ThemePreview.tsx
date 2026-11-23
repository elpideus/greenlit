import '@fontsource-variable/cinzel'
import '@fontsource-variable/jost'
import type { Theme } from '@greenlit/shared'
import { themeToCss } from '@greenlit/shared'
import type { CSSProperties } from 'react'
import { primaryFormat, useMediaList } from '@/data/media'
import { cn } from '@/lib/cn'
import { useElementSize } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { Signal, Tally, Toggle } from '@/ui'

const W = 560
const H = 272

/**
 * A miniature of Greenlit painted with a theme: the real tokens, type and components, scoped to this box
 * (data-theme-mode + the theme's roles as variables), with the library's own thumbnails. Scales to its container.
 */
export function ThemePreview({
  theme,
  mode,
  className,
}: {
  theme: Theme
  mode: 'light' | 'dark'
  className?: string
}) {
  const t = useT('branding')
  const [ref, size] = useElementSize<HTMLDivElement>()
  const media = useMediaList({ kind: 'image', limit: 6 })
  const thumbs = (media.data?.pages[0]?.items ?? [])
    .map((m) => primaryFormat(m)?.urls.thumbnail ?? m.thumbnailUrl)
    .filter(Boolean)
    .slice(0, 3) as string[]
  const scale = size.width ? size.width / W : 0
  const vars = themeToCss(theme, mode) as CSSProperties
  return (
    <div
      ref={ref}
      className={cn('relative w-full overflow-hidden', className)}
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      {scale > 0 && (
        <div
          data-theme-mode={mode}
          className="pointer-events-none absolute top-0 left-0 origin-top-left overflow-hidden bg-canvas text-ink select-none"
          style={{
            ...vars,
            width: W,
            height: H,
            transform: `scale(${scale})`,
            fontFamily: 'var(--gl-font-ui)',
            fontSize: 14,
            letterSpacing: '-0.006em',
          }}
          aria-hidden
        >
          {/* top bar */}
          <div className="flex h-11 items-center gap-3 px-5 shadow-[0_1px_0_var(--line)]">
            <Signal tone="greenlit" size={18} animate={false} />
            <span className="t-callout font-[600] text-ink">{theme.name}</span>
            <div className="mx-auto flex gap-1">
              <span className="rounded-control bg-hover px-2.5 py-1 t-caption font-[550] text-ink">
                {t('sample.library')}
              </span>
              <span className="px-2.5 py-1 t-caption text-ink-3">{t('sample.projects')}</span>
              <span className="px-2.5 py-1 t-caption text-ink-3">{t('sample.review')}</span>
            </div>
            <span className="size-6 rounded-full bg-[color-mix(in_oklab,var(--signal)_25%,var(--raised))]" />
          </div>
          <div className="flex gap-5 px-5 pt-5">
            <div className="min-w-0 flex-1">
              <div className="t-title-1 text-[22px] text-ink">{t('sample.title')}</div>
              <div className="mt-1 t-caption text-ink-3">{t('sample.meta')}</div>
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <div className="aspect-[4/3] overflow-hidden rounded-tile bg-stage">
                      {thumbs[i] ? (
                        <img src={thumbs[i]} alt="" className="size-full object-cover" draggable={false} />
                      ) : (
                        <div className="size-full bg-[linear-gradient(135deg,#2b2f2c,#121412)]" />
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Tally tone={i === 0 ? 'greenlit' : i === 1 ? 'review' : 'draft'} size={6} />
                      <span className="h-[5px] w-16 rounded-full bg-[color-mix(in_oklab,var(--ink)_22%,transparent)]" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="w-[168px] shrink-0 rounded-panel bg-panel p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="flex items-center gap-2">
                <Signal tone="greenlit" size={26} animate={false} />
                <div>
                  <div className="t-caption font-[600] text-ink">{t('sample.send')}</div>
                  <div className="h-[5px] w-14 rounded-full bg-[color-mix(in_oklab,var(--ink)_16%,transparent)]" />
                </div>
              </div>
              <div className="mt-3 flex h-7 items-center justify-center rounded-control bg-signal t-caption font-[600] text-signal-ink">
                {t('sample.send')}
              </div>
              <div className="mt-1.5 flex h-7 items-center justify-center rounded-control bg-review-soft t-caption font-[550] text-review">
                {t('sample.changes')}
              </div>
              <div className="mt-3.5 flex items-center justify-between">
                <span className="h-[5px] w-12 rounded-full bg-[color-mix(in_oklab,var(--ink)_16%,transparent)]" />
                <Toggle checked onChange={() => {}} size="sm" />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="h-[5px] w-16 rounded-full bg-[color-mix(in_oklab,var(--ink)_16%,transparent)]" />
                <Toggle checked={false} onChange={() => {}} size="sm" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
