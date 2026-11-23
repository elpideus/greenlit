import { getPlacement } from '@greenlit/platforms'
import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { appFont, usePlayback } from './parts'
import {
  FacebookFeed,
  FacebookReel,
  InstagramFeed,
  InstagramReel,
  Story,
  type SurfaceProps,
  TikTokVideo,
  YouTubePost,
  YouTubeShort,
  YouTubeWatch,
} from './surfaces'
import { type PlatformPreviewProps, SCREEN } from './types'

function seeded(text: string) {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const r = (n: number) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return Math.abs(h % n)
  }
  return {
    likes: 180 + r(4200),
    comments: 8 + r(160),
    shares: 4 + r(90),
    views: 1500 + r(48000),
    saves: 3 + r(120),
  }
}

/**
 * An interactive emulation of how a post looks in the platform's own app: tap the media to pause, unmute, like,
 * open "more", swipe carousels. The text is cut exactly as the platform cuts it (@greenlit/platforms display rules).
 * Drawn for Greenlit — no platform artwork.
 */
export function PlatformPreview(props: PlatformPreviewProps) {
  const { platform, placement, width = 300, device = true, safeZones = false, className } = props
  const spec = getPlacement(platform, placement)
  const playback = usePlayback({
    autoPlay: props.autoPlay ?? true,
    startAt: props.startAt,
    originalVolume: props.audio?.original ?? 1,
    musicSrc: props.musicSrc,
    musicStartAt: props.musicStartAt,
    musicVolume: props.audio?.music ?? 1,
  })
  const counts = useMemo(
    () => seeded(`${props.account.handle}${platform}${placement}`),
    [props.account.handle, platform, placement],
  )
  const surface: SurfaceProps = { ...props, playback, counts, display: spec?.display ?? {} }
  const scale = width / SCREEN.width
  const height = SCREEN.height * scale
  const bezel = device ? Math.max(6, 11 * scale) : 0
  const radius = 52 * scale
  const light = platform === 'facebook' && placement === 'feed'

  const screen = (() => {
    const key = `${platform}.${placement}`
    switch (key) {
      case 'instagram.reel':
        return <InstagramReel {...surface} />
      case 'instagram.story':
        return <Story {...surface} variant="instagram" />
      case 'instagram.feed':
        return <InstagramFeed {...surface} />
      case 'facebook.reel':
        return <FacebookReel {...surface} />
      case 'facebook.story':
        return <Story {...surface} variant="facebook" />
      case 'facebook.feed':
        return <FacebookFeed {...surface} />
      case 'tiktok.video':
      case 'tiktok.photo':
        return <TikTokVideo {...surface} />
      case 'youtube.short':
        return <YouTubeShort {...surface} />
      case 'youtube.post':
        return <YouTubePost {...surface} />
      default:
        return <YouTubeWatch {...surface} />
    }
  })()

  const zone = spec?.safeZone
  return (
    <div
      className={cn('relative shrink-0 select-none', className)}
      style={{
        width: width + bezel * 2,
        height: height + bezel * 2,
        padding: bezel,
        borderRadius: device ? radius + bezel : 0,
        background: device ? 'linear-gradient(145deg,#2b2d2b,#111211 40%,#1c1d1c)' : undefined,
        boxShadow: device
          ? '0 0 0 1px rgba(255,255,255,.08) inset, 0 0 0 1.5px #050505, 0 30px 80px -30px rgba(0,0,0,.75), 0 12px 30px -12px rgba(0,0,0,.5)'
          : undefined,
      }}
    >
      <div
        className="relative overflow-hidden bg-black"
        style={{ width, height, borderRadius: device ? radius : 0, isolation: 'isolate' }}
      >
        <div
          style={{
            ...appFont,
            width: SCREEN.width,
            height: SCREEN.height,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
          className="relative"
        >
          {screen}
          {device && <StatusBar light={light} />}
          {device && (
            <div
              className={cn(
                'pointer-events-none absolute bottom-[8px] left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full',
                light ? 'bg-black/80' : 'bg-white/85',
              )}
            />
          )}
          {safeZones && zone && (
            <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[52px]">
              <div
                className="absolute inset-x-0 top-0 bg-[repeating-linear-gradient(135deg,rgba(247,93,89,.28)_0_6px,rgba(247,93,89,.12)_6px_12px)]"
                style={{ height: `${zone.top * 100}%` }}
              />
              <div
                className="absolute inset-x-0 bottom-0 bg-[repeating-linear-gradient(135deg,rgba(247,93,89,.28)_0_6px,rgba(247,93,89,.12)_6px_12px)]"
                style={{ height: `${zone.bottom * 100}%` }}
              />
              <div
                className="absolute left-0 bg-[rgba(247,93,89,.18)]"
                style={{
                  top: `${zone.top * 100}%`,
                  bottom: `${zone.bottom * 100}%`,
                  width: `${zone.left * 100}%`,
                }}
              />
              <div
                className="absolute right-0 bg-[rgba(247,93,89,.18)]"
                style={{
                  top: `${zone.top * 100}%`,
                  bottom: `${zone.bottom * 100}%`,
                  width: `${zone.right * 100}%`,
                }}
              />
              {zone.regions.map((r) => (
                <div
                  key={r.label}
                  className="absolute bg-[rgba(247,93,89,.18)] shadow-[inset_0_0_0_1px_rgba(247,93,89,.55)]"
                  style={{
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                  }}
                />
              ))}
              <div
                className="absolute rounded-[6px] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.9),0_0_0_1px_rgba(0,0,0,.4)]"
                style={{
                  top: `${zone.top * 100}%`,
                  bottom: `${zone.bottom * 100}%`,
                  left: `${zone.left * 100}%`,
                  right: `${zone.right * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>
      {device && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-black"
          style={{ top: bezel + 11 * scale, width: 112 * scale, height: 32 * scale }}
        />
      )}
    </div>
  )
}

function StatusBar({ light }: { light: boolean }) {
  const c = light ? '#050505' : '#ffffff'
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 flex h-[50px] items-center justify-between px-[34px] pt-[6px] text-[16px] font-semibold"
      style={{ color: c }}
    >
      <span className="tabular-nums">9:41</span>
      <span className="flex items-center gap-[6px]">
        <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 4.7} y={9 - i * 3} width="3.2" height={3 + i * 3} rx="1" fill={c} />
          ))}
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
          <path
            d="M8 2.6a8.8 8.8 0 0 1 6.2 2.5l1.1-1.1A10.4 10.4 0 0 0 8 1 10.4 10.4 0 0 0 .7 4l1.1 1.1A8.8 8.8 0 0 1 8 2.6Zm0 3.2a5.6 5.6 0 0 1 3.9 1.6L13 6.3a7.2 7.2 0 0 0-10 0l1.1 1.1A5.6 5.6 0 0 1 8 5.8Zm0 3.2c-.6 0-1.2.2-1.6.7L8 11.3l1.6-1.6c-.4-.5-1-.7-1.6-.7Z"
            fill={c}
          />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden>
          <rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke={c} strokeOpacity=".4" />
          <rect x="2" y="2" width="20" height="9" rx="2" fill={c} />
          <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill={c} fillOpacity=".45" />
        </svg>
      </span>
    </div>
  )
}
