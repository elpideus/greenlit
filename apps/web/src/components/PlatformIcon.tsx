import type { Platform } from '@greenlit/shared'
import { cn } from '@/lib/cn'

/** Each platform's own colour, used only on its glyph (never as UI chrome). */
export const PLATFORM_COLOR: Record<Platform, string> = {
  instagram: '#E4405F',
  facebook: '#1877F2',
  tiktok: '#EDEFED',
  youtube: '#FF0033',
}

export const PLATFORM_NAME: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}

/**
 * Simplified platform glyphs (drawn for Greenlit, recognisable at 12–20 px). `tile` puts the glyph on a rounded
 * square of the platform colour, like an app icon.
 */
export function PlatformIcon({
  platform,
  size = 16,
  tile,
  mono,
  className,
}: {
  platform: Platform
  size?: number
  tile?: boolean
  mono?: boolean
  className?: string
}) {
  const color = mono ? 'currentColor' : PLATFORM_COLOR[platform]
  const glyph = (fill: string, inner: string) => {
    switch (platform) {
      case 'instagram':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="5.5" fill="none" stroke={fill} strokeWidth="2" />
            <circle cx="12" cy="12" r="4.1" fill="none" stroke={fill} strokeWidth="2" />
            <circle cx="17.3" cy="6.7" r="1.25" fill={fill} />
          </>
        )
      case 'facebook':
        return (
          <>
            <circle cx="12" cy="12" r="10" fill={fill} />
            <path d="M13.4 21.9v-7.1h2.4l.4-2.8h-2.8v-1.8c0-.8.2-1.4 1.4-1.4h1.5V6.3c-.3 0-1.1-.1-2.2-.1-2.2 0-3.6 1.3-3.6 3.7V12H8.1v2.8h2.4v7.1" fill={inner} />
          </>
        )
      case 'tiktok':
        return (
          <path
            d="M16.6 3c.3 2.3 1.6 3.8 3.9 4v2.7c-1.4.1-2.6-.3-3.9-1.1v5.6c0 3.8-3.1 6.3-6.6 5.7-3.1-.5-5-3.6-4.2-6.6.7-2.6 3.3-4.3 6-3.9v2.9c-1.4-.4-2.9.3-3.3 1.6-.5 1.6.7 3.1 2.3 3.1 1.4 0 2.4-1 2.4-2.5V3h3.4Z"
            fill={fill}
          />
        )
      case 'youtube':
        return (
          <>
            <rect x="1.8" y="5" width="20.4" height="14" rx="4.2" fill={fill} />
            <path d="m10 9 5.2 3-5.2 3V9Z" fill={inner} />
          </>
        )
    }
  }
  if (tile) {
    const bg = platform === 'tiktok' ? '#0c0d0c' : PLATFORM_COLOR[platform]
    const fg = platform === 'tiktok' ? '#edefed' : '#ffffff'
    return (
      <span
        className={cn('inline-grid shrink-0 place-items-center rounded-[28%]', className)}
        style={{ width: size, height: size, background: bg, boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.14)' }}
        role="img"
        aria-label={PLATFORM_NAME[platform]}
      >
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" aria-hidden>
          {glyph(fg, bg)}
        </svg>
      </span>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('shrink-0', platform === 'tiktok' && !mono && 'text-ink', className)}
      role="img"
      aria-label={PLATFORM_NAME[platform]}
    >
      {glyph(platform === 'tiktok' && !mono ? 'currentColor' : color, mono ? 'var(--canvas)' : '#fff')}
    </svg>
  )
}
