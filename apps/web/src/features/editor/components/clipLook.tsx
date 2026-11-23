import type { Asset, Clip } from '@greenlit/composition'
import type { Media } from '@greenlit/shared'
import {
  AudioLines,
  Code2,
  Film,
  Image as ImageIcon,
  type LucideIcon,
  Shapes,
  Square,
  Type,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadSprite, type SpriteInfo } from '@/data/media'
import { assetThumb } from '../assets'

/** Clip-type tints: editor-only colours, deliberately apart from the status lamps. */
export const TYPE_LOOK: Record<Clip['type'], { icon: LucideIcon; tint: string }> = {
  video: { icon: Film, tint: '#7d8a83' },
  image: { icon: ImageIcon, tint: '#7d8a83' },
  audio: { icon: AudioLines, tint: '#42d77b' },
  text: { icon: Type, tint: '#9d8cff' },
  shape: { icon: Shapes, tint: '#e0a46e' },
  solid: { icon: Square, tint: '#b49b74' },
  html: { icon: Code2, tint: '#5ec8c0' },
}

export function clipLabel(c: Clip, asset?: Asset) {
  if (c.name) return c.name
  if (c.type === 'text') return c.text?.content?.split('\n')[0] || 'Text'
  if (asset) return asset.name
  return c.type
}

const waveCache = new Map<string, Promise<{ perSecond: number; duration: number; peaks: number[] } | null>>()
function loadWave(url: string) {
  let p = waveCache.get(url)
  if (!p) {
    p = fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    waveCache.set(url, p)
  }
  return p
}

/** The inside of a timeline clip: a filmstrip from the sprite sheet, a picture strip, or a waveform. */
export function ClipBody({
  clip,
  asset,
  media,
  width,
  height,
}: {
  clip: Clip
  asset?: Asset
  media: Map<string, Media>
  width: number
  height: number
}) {
  const info = asset ? assetThumb(asset, media) : null
  const [sprite, setSprite] = useState<SpriteInfo | null>(null)
  const [wave, setWave] = useState<{ perSecond: number; peaks: number[] } | null>(null)
  useEffect(() => {
    if (info?.sprite && clip.type === 'video') void loadSprite(info.sprite).then(setSprite)
  }, [info?.sprite, clip.type])
  useEffect(() => {
    if (info?.waveform && (clip.type === 'audio' || clip.type === 'video'))
      void loadWave(info.waveform).then(setWave)
  }, [info?.waveform, clip.type])

  if (clip.type === 'audio')
    return <Waveform clip={clip} wave={wave} width={width} height={height} color="#42d77b" />

  if (clip.type === 'video' && sprite && info?.sprite) {
    const th = height
    const tw = Math.max(24, (sprite.w / sprite.h) * th)
    const n = Math.min(80, Math.ceil(width / tw))
    const tiles = []
    for (let i = 0; i < n; i++) {
      const local = (((i + 0.5) * tw) / Math.max(1, width)) * clip.duration
      const mt = (clip.in ?? 0) + local * (clip.speed ?? 1)
      const idx = Math.max(0, Math.min(sprite.count - 1, Math.floor(mt / sprite.interval)))
      const col = idx % sprite.cols
      const row = Math.floor(idx / sprite.cols)
      const s = th / sprite.h
      tiles.push(
        <div
          key={i}
          className="h-full shrink-0"
          style={{
            width: tw,
            backgroundImage: `url(${info.sprite})`,
            backgroundSize: `${sprite.cols * sprite.w * s}px ${sprite.rows * sprite.h * s}px`,
            backgroundPosition: `${-col * sprite.w * s}px ${-row * sprite.h * s}px`,
          }}
        />,
      )
    }
    return (
      <div className="absolute inset-0 flex overflow-hidden opacity-90">
        {tiles}
        {wave && asset?.hasAudio && (
          <div className="absolute inset-x-0 bottom-0 h-[34%] bg-gradient-to-t from-black/70 to-transparent">
            <Waveform
              clip={clip}
              wave={wave}
              width={width}
              height={height * 0.34}
              color="rgba(255,255,255,.75)"
            />
          </div>
        )}
      </div>
    )
  }
  if ((clip.type === 'video' || clip.type === 'image') && info?.thumb)
    return (
      <div
        className="absolute inset-0 opacity-90"
        style={{
          backgroundImage: `url(${info.thumb})`,
          backgroundSize: 'auto 100%',
          backgroundRepeat: 'repeat-x',
        }}
      />
    )
  if (clip.type === 'solid')
    return <div className="absolute inset-0 opacity-70" style={{ background: clip.fill ?? '#000' }} />
  return null
}

function Waveform({
  clip,
  wave,
  width,
  height,
  color,
}: {
  clip: Clip
  wave: { perSecond: number; peaks: number[] } | null
  width: number
  height: number
  color: string
}) {
  if (!wave || width < 4) return null
  const bars = Math.min(600, Math.floor(width / 3))
  const pts: string[] = []
  for (let i = 0; i < bars; i++) {
    const local = (i / bars) * clip.duration
    const mt = (clip.in ?? 0) + local * (clip.speed ?? 1)
    const p = wave.peaks[Math.floor(mt * wave.perSecond)] ?? 0
    const h = Math.max(1, p * height * 0.9)
    pts.push(`M${(i * width) / bars} ${height / 2 - h / 2}v${h}`)
  }
  return (
    <svg width={width} height={height} className="absolute inset-0" aria-hidden>
      <path
        d={pts.join('')}
        stroke={color}
        strokeWidth={Math.max(1, width / bars - 1)}
        strokeLinecap="round"
        opacity={0.85}
      />
    </svg>
  )
}
