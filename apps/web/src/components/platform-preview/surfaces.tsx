import type { Display } from '@greenlit/platforms'
import {
  ArrowLeft,
  Bookmark,
  Camera,
  ChevronDown,
  Clapperboard,
  Download,
  Ellipsis,
  Globe,
  Heart,
  Home,
  MapPin,
  MessageCircle,
  Music2,
  Plus,
  Repeat2,
  Search,
  Send,
  Share2,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/cn'
import {
  AppAvatar,
  Caption,
  compact,
  handleOf,
  LikeButton,
  MediaView,
  MuteButton,
  type Playback,
  TapFlash,
  Ticker,
  verticalFit,
} from './parts'
import type { PlatformPreviewProps } from './types'

export interface SurfaceProps extends PlatformPreviewProps {
  playback: Playback
  display: { caption?: Display; title?: Display; description?: Display }
  /** Deterministic fake numbers so the preview looks lived-in. */
  counts: { likes: number; comments: number; shares: number; views: number; saves: number }
}

const icon = { strokeWidth: 1.9 } as const

function BottomNav({ items, dark = true }: { items: ReactNode[]; dark?: boolean }) {
  return (
    <div
      className={cn(
        'flex h-[52px] shrink-0 items-center justify-around px-2',
        dark ? 'bg-black text-white' : 'bg-white text-[#050505]',
      )}
    >
      {items.map((it, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static
        <span key={i} className="grid w-12 place-items-center">
          {it}
        </span>
      ))}
    </div>
  )
}

function ProgressLine({
  value,
  color = 'rgba(255,255,255,.9)',
  className,
}: {
  value: number
  color?: string
  className?: string
}) {
  return (
    <div className={cn('h-[2px] w-full bg-white/25', className)}>
      <div
        className="h-full transition-[width] duration-200 ease-linear"
        style={{ width: `${value * 100}%`, background: color }}
      />
    </div>
  )
}

function RailItem({ children, label }: { children: ReactNode; label?: ReactNode }) {
  return (
    <span className="flex flex-col items-center gap-1 text-white [filter:drop-shadow(0_1px_2px_rgba(0,0,0,.45))]">
      {children}
      {label !== undefined && <span className="text-[12px] font-semibold">{label}</span>}
    </span>
  )
}

/** Vertical video surfaces share one layout: media behind, rail right, caption block bottom-left. */
function VerticalShell({
  p,
  top,
  rail,
  bottom,
  nav,
  progressColor,
}: {
  p: SurfaceProps
  top: ReactNode
  rail: ReactNode
  bottom: ReactNode
  nav?: ReactNode
  progressColor?: string
}) {
  const item = p.media[0]
  return (
    <div className="flex h-full flex-col bg-black text-white">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: preview */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: preview */}
      <div className="relative min-h-0 flex-1 overflow-hidden" onClick={p.playback.toggle}>
        <MediaView
          item={item}
          playback={p.playback}
          fit={verticalFit(item)}
          className="absolute inset-0 size-full"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/45 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        <TapFlash flash={p.playback.flash} />
        <div className="absolute inset-x-0 top-0 pt-[52px]">{top}</div>
        <div className="absolute right-2.5 bottom-5 flex flex-col items-center gap-[18px]">{rail}</div>
        <div className="absolute right-[76px] bottom-4 left-3.5">{bottom}</div>
        {item?.kind === 'video' && (
          <MuteButton playback={p.playback} className="absolute top-[100px] right-3" />
        )}
        <div className="absolute inset-x-0 bottom-0">
          <ProgressLine value={p.playback.progress} color={progressColor} />
        </div>
      </div>
      {nav}
    </div>
  )
}

function MusicLine({ p, fallback }: { p: SurfaceProps; fallback: string }) {
  const text = p.music ? `${p.music.title}${p.music.artist ? ` · ${p.music.artist}` : ''}` : fallback
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[13px]">
      <Music2 size={13} className="shrink-0" />
      <Ticker className="max-w-[210px]">{text}</Ticker>
    </div>
  )
}

// ── Instagram ──────────────────────────────────────────────────────────────────────

export function InstagramReel(p: SurfaceProps) {
  const [liked, setLiked] = useState(false)
  const [following, setFollowing] = useState(false)
  return (
    <VerticalShell
      p={p}
      top={
        <div className="flex items-center justify-between px-4 text-[22px] font-bold">
          <span className="flex items-center gap-1">
            Reels <ChevronDown size={18} />
          </span>
          <Camera size={24} {...icon} />
        </div>
      }
      rail={
        <>
          <LikeButton
            liked={liked}
            onToggle={() => setLiked((l) => !l)}
            render={(l) => (
              <RailItem label={compact(p.counts.likes + (l ? 1 : 0))}>
                <Heart size={28} {...icon} className={l ? 'fill-[#ff3040] text-[#ff3040]' : ''} />
              </RailItem>
            )}
          />
          <RailItem label={compact(p.counts.comments)}>
            <MessageCircle size={28} {...icon} className="-scale-x-100" />
          </RailItem>
          <RailItem label={compact(p.counts.shares)}>
            <Send size={26} {...icon} />
          </RailItem>
          <RailItem>
            <Ellipsis size={24} />
          </RailItem>
          <span className="size-7 overflow-hidden rounded-[7px] shadow-[0_0_0_2px_white]">
            {p.music?.coverUrl ? (
              <img src={p.music.coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <AppAvatar account={p.account} size={28} />
            )}
          </span>
        </>
      }
      bottom={
        <div className="text-[14px] leading-[1.32]">
          <div className="mb-2.5 flex items-center gap-2.5">
            <AppAvatar account={p.account} size={32} />
            <span className="font-semibold">{handleOf(p.account)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setFollowing((f) => !f)
              }}
              className="rounded-[8px] px-2.5 py-[3px] text-[13px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,.75)]"
            >
              {following ? 'Following' : 'Follow'}
            </button>
          </div>
          <Caption
            text={p.caption ?? ''}
            display={p.display.caption}
            tagClass="text-white"
            moreClass="text-white/65"
            clamp
          />
          <MusicLine p={p} fallback={`${handleOf(p.account)} · Original audio`} />
          {p.location && (
            <div className="mt-1.5 flex items-center gap-1 text-[12.5px] text-white/85">
              <MapPin size={12} />
              {p.location}
            </div>
          )}
        </div>
      }
      nav={
        <BottomNav
          items={[
            <Home key="h" size={25} />,
            <Search key="s" size={25} />,
            <Plus key="p" size={26} className="rounded-[7px] shadow-[inset_0_0_0_2px_white]" />,
            <Clapperboard key="r" size={25} />,
            <AppAvatar key="a" account={p.account} size={26} />,
          ]}
        />
      }
    />
  )
}

export function Story(p: SurfaceProps & { variant: 'instagram' | 'facebook' }) {
  const item = p.media[0]
  const [liked, setLiked] = useState(false)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: preview
    // biome-ignore lint/a11y/noStaticElementInteractions: preview
    <div className="relative flex h-full flex-col bg-black text-white" onClick={p.playback.toggle}>
      <div className="relative mx-0 mt-[48px] min-h-0 flex-1 overflow-hidden rounded-[10px]">
        {item?.src && verticalFit(item) === 'contain' && (
          <MediaView
            item={{ ...item, kind: 'image', src: item.poster ?? item.src }}
            className="absolute inset-0 size-full scale-125 blur-2xl brightness-75"
          />
        )}
        <MediaView
          item={item}
          playback={p.playback}
          fit={verticalFit(item)}
          className="absolute inset-0 size-full"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />
        <TapFlash flash={p.playback.flash} />
        <div className="absolute inset-x-2.5 top-2 flex gap-1">
          {p.media.map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments
            <div key={i} className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-white/35">
              <div
                className="h-full bg-white"
                style={{
                  width: i === 0 ? `${(item?.kind === 'video' ? p.playback.progress : 0.4) * 100}%` : '0%',
                }}
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-x-3 top-5 flex items-center gap-2 text-[14px]">
          <AppAvatar account={p.account} size={32} ring={p.variant === 'facebook' ? '#1877f2' : undefined} />
          <span className="font-semibold">
            {p.variant === 'facebook' ? p.account.name : handleOf(p.account)}
          </span>
          <span className="text-white/70">2h</span>
          <span className="ml-auto flex items-center gap-3">
            {item?.kind === 'video' && <MuteButton playback={p.playback} className="size-7 bg-transparent" />}
            <Ellipsis size={20} />
            <X size={24} />
          </span>
        </div>
        {p.music && (
          <div className="absolute top-[26%] left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-[12px] bg-white px-3 py-2 text-[#111] shadow-lg">
            <span className="grid size-9 place-items-center overflow-hidden rounded-[6px] bg-[#eee]">
              {p.music.coverUrl ? (
                <img src={p.music.coverUrl} alt="" className="size-full object-cover" />
              ) : (
                <Music2 size={16} />
              )}
            </span>
            <span className="max-w-[170px]">
              <span className="block truncate text-[13px] font-semibold">{p.music.title}</span>
              <span className="block truncate text-[12px] text-[#666]">{p.music.artist}</span>
            </span>
          </div>
        )}
        {p.location && (
          <div className="absolute bottom-[22%] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[8px] bg-white px-3 py-1.5 text-[13px] font-bold tracking-[.01em] text-[#c13584] uppercase shadow-lg">
            <MapPin size={14} />
            {p.location}
          </div>
        )}
      </div>
      <div className="flex h-[64px] shrink-0 items-center gap-3 px-3 pb-2">
        <div className="flex h-11 flex-1 items-center rounded-full px-4 text-[14px] text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,.55)]">
          {p.variant === 'facebook' ? 'Reply…' : 'Send message'}
        </div>
        <LikeButton
          liked={liked}
          onToggle={() => setLiked((l) => !l)}
          render={(l) =>
            p.variant === 'facebook' ? (
              <ThumbsUp size={26} {...icon} className={l ? 'fill-[#1877f2] text-[#1877f2]' : ''} />
            ) : (
              <Heart size={27} {...icon} className={l ? 'fill-[#ff3040] text-[#ff3040]' : ''} />
            )
          }
        />
        <Send size={25} {...icon} />
      </div>
    </div>
  )
}

/** Instagram feed: post card in the home feed (dark appearance). Several items = a carousel. */
export function InstagramFeed(p: SurfaceProps) {
  const [index, setIndex] = useState(0)
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)
  const item = p.media[index]
  const first = p.media[0]
  const r = first?.width && first.height ? Math.min(1.91, Math.max(0.8, first.width / first.height)) : 1
  return (
    <div className="flex h-full flex-col bg-black text-white">
      <div className="flex h-[96px] shrink-0 items-end justify-between px-4 pb-2.5">
        <span className="text-[25px] font-semibold tracking-[-0.02em] italic">Instagram</span>
        <span className="flex gap-5">
          <Heart size={25} {...icon} />
          <Send size={24} {...icon} />
        </span>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <span className="rounded-full bg-[conic-gradient(#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5,#feda75)] p-[2px]">
            <span className="block rounded-full bg-black p-[2px]">
              <AppAvatar account={p.account} size={30} />
            </span>
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[14px] font-semibold">{handleOf(p.account)}</span>
            {(p.location || p.music) && (
              <span className="block truncate text-[12px] text-white/80">
                {p.location ?? (p.music ? `♫ ${p.music.title} · ${p.music.artist}` : '')}
              </span>
            )}
          </span>
          <Ellipsis size={20} />
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: preview */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: preview */}
        <div
          className="relative w-full overflow-hidden bg-[#111]"
          style={{ aspectRatio: String(r) }}
          onDoubleClick={() => setLiked(true)}
          onClick={p.playback.toggle}
        >
          <motion.div
            className="flex h-full"
            animate={{ x: `${-index * 100}%` }}
            transition={{ type: 'spring', bounce: 0, duration: 0.42 }}
            drag={p.media.length > 1 ? 'x' : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(_e, info) => {
              if (info.offset.x < -40) setIndex((i) => Math.min(p.media.length - 1, i + 1))
              if (info.offset.x > 40) setIndex((i) => Math.max(0, i - 1))
            }}
          >
            {p.media.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: carousel
              <div key={i} className="relative h-full w-full shrink-0">
                <MediaView
                  item={m}
                  playback={i === index ? p.playback : undefined}
                  fit="cover"
                  className="absolute inset-0 size-full"
                />
              </div>
            ))}
          </motion.div>
          <TapFlash flash={p.playback.flash} />
          {p.media.length > 1 && (
            <span className="absolute top-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[12px] font-semibold">
              {index + 1}/{p.media.length}
            </span>
          )}
          {item?.kind === 'video' && (
            <MuteButton playback={p.playback} className="absolute right-3 bottom-3 size-7" />
          )}
        </div>
        <div className="flex items-center gap-4 px-3 pt-3">
          <LikeButton
            liked={liked}
            onToggle={() => setLiked((l) => !l)}
            render={(l) => <Heart size={26} {...icon} className={l ? 'fill-[#ff3040] text-[#ff3040]' : ''} />}
          />
          <MessageCircle size={25} {...icon} className="-scale-x-100" />
          <Send size={24} {...icon} />
          {p.media.length > 1 && (
            <span className="absolute left-1/2 flex -translate-x-1/2 gap-1">
              {p.media.map((_, i) => (
                <span
                  key={i}
                  className={cn('size-1.5 rounded-full', i === index ? 'bg-[#0095f6]' : 'bg-white/30')}
                />
              ))}
            </span>
          )}
          <button type="button" className="ml-auto" onClick={() => setSaved((s) => !s)}>
            <Bookmark size={25} {...icon} className={saved ? 'fill-white' : ''} />
          </button>
        </div>
        <div className="px-3 pt-2 text-[14px] font-semibold">
          {compact(p.counts.likes + (liked ? 1 : 0))} likes
        </div>
        <div className="px-3 pt-1 text-[14px] leading-[1.35]">
          <Caption
            text={p.caption ?? ''}
            display={p.display.caption}
            lead={<span className="mr-1 font-semibold">{handleOf(p.account)}</span>}
            tagClass="text-[#e0f1ff]"
            moreClass="text-white/55"
          />
        </div>
        {p.firstComment && (
          <div className="px-3 pt-1 text-[14px] leading-[1.35]">
            <span className="mr-1 font-semibold">{handleOf(p.account)}</span>
            {p.firstComment}
          </div>
        )}
        <div className="px-3 pt-1 text-[14px] text-white/55">View all {p.counts.comments} comments</div>
        <div className="px-3 pt-1 pb-4 text-[12px] text-white/55">2 hours ago</div>
        <div className="flex items-center gap-2.5 px-3 py-2.5 opacity-40">
          <span className="size-8 rounded-full bg-white/20" />
          <span className="h-3 w-28 rounded bg-white/20" />
        </div>
        <div className="aspect-square w-full bg-white/[.06]" />
      </div>
      <BottomNav
        items={[
          <Home key="h" size={25} fill="white" />,
          <Search key="s" size={25} />,
          <Plus key="p" size={26} className="rounded-[7px] shadow-[inset_0_0_0_2px_white]" />,
          <Clapperboard key="r" size={25} />,
          <AppAvatar key="a" account={p.account} size={26} />,
        ]}
      />
    </div>
  )
}

// ── TikTok ─────────────────────────────────────────────────────────────────────────

export function TikTokVideo(p: SurfaceProps) {
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)
  const photo = p.placement === 'photo'
  const [index, setIndex] = useState(0)
  const pp = photo ? { ...p, media: [p.media[index] ?? p.media[0]!].filter(Boolean) } : p
  return (
    <VerticalShell
      p={pp}
      progressColor="rgba(255,255,255,.95)"
      top={
        <div className="relative flex items-center justify-center gap-5 px-4 text-[16.5px] font-semibold">
          <span className="absolute left-4 rounded-[4px] px-1 text-[11px] font-bold shadow-[inset_0_0_0_1.5px_white]">
            LIVE
          </span>
          <span className="text-white/65">Following</span>
          <span className="relative">
            For You
            <span className="absolute -bottom-1.5 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-white" />
          </span>
          <Search size={23} className="absolute right-4" {...icon} />
        </div>
      }
      rail={
        <>
          <span className="relative mb-1">
            <AppAvatar account={p.account} size={46} ring="white" />
            <span className="absolute -bottom-2.5 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-[#fe2c55]">
              <Plus size={13} strokeWidth={3} />
            </span>
          </span>
          <LikeButton
            liked={liked}
            onToggle={() => setLiked((l) => !l)}
            render={(l) => (
              <RailItem label={compact(p.counts.likes + (l ? 1 : 0))}>
                <Heart size={33} fill="currentColor" className={l ? 'text-[#fe2c55]' : 'text-white'} />
              </RailItem>
            )}
          />
          <RailItem label={compact(p.counts.comments)}>
            <MessageCircle size={32} fill="currentColor" className="text-white" />
          </RailItem>
          <LikeButton
            liked={saved}
            onToggle={() => setSaved((s) => !s)}
            render={(s) => (
              <RailItem label={compact(p.counts.saves + (s ? 1 : 0))}>
                <Bookmark size={30} fill="currentColor" className={s ? 'text-[#facd3d]' : 'text-white'} />
              </RailItem>
            )}
          />
          <RailItem label={compact(p.counts.shares)}>
            <Share2 size={29} fill="currentColor" className="text-white" />
          </RailItem>
          <motion.span
            className="grid size-11 place-items-center overflow-hidden rounded-full bg-[conic-gradient(#222,#444,#222,#444,#222)] p-2.5"
            animate={{ rotate: p.playback.playing ? 360 : 0 }}
            transition={{
              duration: 5,
              ease: 'linear',
              repeat: p.playback.playing ? Number.POSITIVE_INFINITY : 0,
            }}
          >
            <span className="size-full overflow-hidden rounded-full">
              {p.music?.coverUrl ? (
                <img src={p.music.coverUrl} alt="" className="size-full object-cover" />
              ) : (
                <AppAvatar account={p.account} size={24} />
              )}
            </span>
          </motion.span>
        </>
      }
      bottom={
        <div className="text-[15px] leading-[1.32]">
          {photo && p.media.length > 1 && (
            <div className="mb-3 flex gap-1">
              {p.media.map((_, i) => (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: dots
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIndex(i)
                  }}
                  className={cn('h-1.5 rounded-full', i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/45')}
                />
              ))}
            </div>
          )}
          <div className="mb-1 font-semibold">{p.account.name || handleOf(p.account)}</div>
          {photo && p.title && <div className="mb-0.5 font-semibold">{p.title}</div>}
          <Caption
            text={p.caption ?? ''}
            display={p.display.caption ?? p.display.description}
            tagClass="font-semibold text-white"
            moreClass="font-semibold text-white"
            clamp
          />
          <MusicLine p={p} fallback={`original sound - ${handleOf(p.account)}`} />
        </div>
      }
      nav={
        <BottomNav
          items={[
            <Home key="h" size={24} fill="white" />,
            <Users key="f" size={24} />,
            <span
              key="p"
              className="relative grid h-8 w-12 place-items-center rounded-[9px] bg-white text-black shadow-[-3px_0_0_#25f4ee,3px_0_0_#fe2c55]"
            >
              <Plus size={20} strokeWidth={3} />
            </span>,
            <MessageCircle key="i" size={24} />,
            <UserRound key="u" size={24} />,
          ]}
        />
      }
    />
  )
}

// ── YouTube ────────────────────────────────────────────────────────────────────────

export function YouTubeShort(p: SurfaceProps) {
  const [vote, setVote] = useState<1 | -1 | 0>(0)
  const [sub, setSub] = useState(false)
  return (
    <VerticalShell
      p={p}
      progressColor="#ff0033"
      top={
        <div className="flex items-center justify-end gap-6 px-4">
          <Search size={24} {...icon} />
          <Ellipsis size={22} className="rotate-90" />
        </div>
      }
      rail={
        <>
          <LikeButton
            liked={vote === 1}
            onToggle={() => setVote((v) => (v === 1 ? 0 : 1))}
            render={(l) => (
              <RailItem label={compact(p.counts.likes + (l ? 1 : 0))}>
                <span className="grid size-12 place-items-center rounded-full bg-white/15 backdrop-blur-md">
                  <ThumbsUp size={23} fill={l ? 'white' : 'none'} {...icon} />
                </span>
              </RailItem>
            )}
          />
          <LikeButton
            liked={vote === -1}
            onToggle={() => setVote((v) => (v === -1 ? 0 : -1))}
            render={(l) => (
              <RailItem label="Dislike">
                <span className="grid size-12 place-items-center rounded-full bg-white/15 backdrop-blur-md">
                  <ThumbsDown size={23} fill={l ? 'white' : 'none'} {...icon} />
                </span>
              </RailItem>
            )}
          />
          <RailItem label={compact(p.counts.comments)}>
            <span className="grid size-12 place-items-center rounded-full bg-white/15 backdrop-blur-md">
              <MessageCircle size={23} {...icon} />
            </span>
          </RailItem>
          <RailItem label="Share">
            <span className="grid size-12 place-items-center rounded-full bg-white/15 backdrop-blur-md">
              <Share2 size={22} {...icon} />
            </span>
          </RailItem>
          <RailItem label="Remix">
            <span className="grid size-12 place-items-center rounded-full bg-white/15 backdrop-blur-md">
              <Repeat2 size={23} {...icon} />
            </span>
          </RailItem>
          <span className="size-10 overflow-hidden rounded-[8px] bg-white/20 shadow-[0_0_0_2px_rgba(255,255,255,.9)]">
            {p.music?.coverUrl ? (
              <img src={p.music.coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <AppAvatar account={p.account} size={40} />
            )}
          </span>
        </>
      }
      bottom={
        <div className="text-[14px] leading-[1.35]">
          <div className="mb-2 flex items-center gap-2">
            <AppAvatar account={p.account} size={32} />
            <span className="font-medium">@{handleOf(p.account)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setSub((s) => !s)
              }}
              className={cn(
                'ml-1 rounded-full px-3 py-1.5 text-[13px] font-semibold',
                sub ? 'bg-white/20 text-white' : 'bg-white text-black',
              )}
            >
              {sub ? 'Subscribed' : 'Subscribe'}
            </button>
          </div>
          <Caption
            text={p.title ?? ''}
            display={p.display.title ?? { lines: 2, more: '' }}
            tagClass="text-white"
          />
          <MusicLine p={p} fallback={`Original sound · ${p.account.name}`} />
        </div>
      }
      nav={
        <BottomNav
          items={[
            <Home key="h" size={24} />,
            <Clapperboard key="s" size={24} fill="white" />,
            <Plus key="p" size={30} className="rounded-full p-1 shadow-[inset_0_0_0_1.5px_white]" />,
            <Users key="u" size={24} />,
            <AppAvatar key="a" account={p.account} size={26} />,
          ]}
        />
      }
    />
  )
}

export function YouTubeWatch(p: SurfaceProps) {
  const item = p.media[0]
  const [vote, setVote] = useState<1 | -1 | 0>(0)
  const [sub, setSub] = useState(false)
  const [desc, setDesc] = useState(false)
  return (
    <div className="flex h-full flex-col bg-[#0f0f0f] text-[#f1f1f1]">
      <div className="h-[48px] shrink-0 bg-black" />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: preview */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: preview */}
      <div className="relative aspect-video w-full shrink-0 bg-black" onClick={p.playback.toggle}>
        <MediaView item={item} playback={p.playback} fit="contain" className="absolute inset-0 size-full" />
        <TapFlash flash={p.playback.flash} />
        {item?.kind === 'video' && (
          <MuteButton playback={p.playback} className="absolute top-2 right-2 size-7" />
        )}
        <div className="absolute inset-x-0 bottom-0">
          <div className="h-[3px] w-full bg-white/25">
            <div
              className="relative h-full bg-[#ff0033] transition-[width] duration-200 ease-linear"
              style={{ width: `${p.playback.progress * 100}%` }}
            >
              <span className="absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 rounded-full bg-[#ff0033]" />
            </div>
          </div>
        </div>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pt-3">
          <Caption
            text={p.title || 'Untitled video'}
            display={desc ? undefined : (p.display.title ?? { lines: 2, more: '' })}
            className="text-[18px] leading-[1.28] font-semibold tracking-[-0.01em]"
            tagClass="text-[#3ea6ff]"
          />
          <button
            type="button"
            onClick={() => setDesc((d) => !d)}
            className="mt-1.5 text-left text-[12px] text-[#aaa]"
          >
            {compact(p.counts.views)} views · 2h ago{' '}
            {p.caption && !desc && <span className="font-semibold text-[#f1f1f1]">...more</span>}
          </button>
        </div>
        <div className="flex items-center gap-2.5 px-3 py-3">
          <AppAvatar account={p.account} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-semibold">{p.account.name}</span>
            <span className="block text-[12px] text-[#aaa]">{compact(p.counts.likes * 9)} subscribers</span>
          </span>
          <button
            type="button"
            onClick={() => setSub((s) => !s)}
            className={cn(
              'rounded-full px-3.5 py-2 text-[13.5px] font-semibold',
              sub ? 'bg-[#272727] text-white' : 'bg-white text-black',
            )}
          >
            {sub ? 'Subscribed' : 'Subscribe'}
          </button>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pb-3">
          <span className="flex shrink-0 items-center rounded-full bg-[#272727] text-[13.5px] font-medium">
            <button
              type="button"
              onClick={() => setVote((v) => (v === 1 ? 0 : 1))}
              className="flex items-center gap-1.5 py-2 pr-3 pl-3.5"
            >
              <ThumbsUp size={18} fill={vote === 1 ? 'white' : 'none'} {...icon} />
              {compact(p.counts.likes + (vote === 1 ? 1 : 0))}
            </button>
            <span className="h-5 w-px bg-white/20" />
            <button
              type="button"
              onClick={() => setVote((v) => (v === -1 ? 0 : -1))}
              className="py-2 pr-3.5 pl-3"
            >
              <ThumbsDown size={18} fill={vote === -1 ? 'white' : 'none'} {...icon} />
            </button>
          </span>
          {[
            [Share2, 'Share'],
            [Repeat2, 'Remix'],
            [Download, 'Download'],
            [Bookmark, 'Save'],
          ].map(([I, l]) => {
            const Ico = I as typeof Share2
            return (
              <span
                key={l as string}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#272727] px-3.5 py-2 text-[13.5px] font-medium"
              >
                <Ico size={18} {...icon} />
                {l as string}
              </span>
            )
          })}
        </div>
        {desc && p.caption ? (
          <div className="mx-3 mb-3 rounded-[12px] bg-[#272727] p-3 text-[13.5px] leading-[1.42]">
            <Caption text={p.caption} tagClass="text-[#3ea6ff]" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDesc(true)}
            className="mx-3 mb-3 block w-[calc(100%-24px)] rounded-[12px] bg-[#272727] p-3 text-left"
          >
            <span className="text-[14px] font-semibold">Comments </span>
            <span className="text-[13px] text-[#aaa]">{p.counts.comments}</span>
            <span className="mt-2 flex items-center gap-2 text-[12.5px] text-[#ddd]">
              <span className="size-6 rounded-full bg-white/20" />
              <span className="truncate">{p.firstComment || 'Add a comment…'}</span>
            </span>
          </button>
        )}
        {[0, 1].map((i) => (
          <div key={i} className="mb-4 opacity-40">
            <div className="aspect-video w-full bg-white/[.07]" />
            <div className="flex gap-3 px-3 pt-3">
              <span className="size-9 rounded-full bg-white/15" />
              <span className="flex-1 space-y-2 pt-1">
                <span className="block h-3 w-4/5 rounded bg-white/15" />
                <span className="block h-3 w-2/5 rounded bg-white/10" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function YouTubePost(p: SurfaceProps) {
  const [vote, setVote] = useState(false)
  return (
    <div className="flex h-full flex-col bg-[#0f0f0f] pt-[60px] text-[#f1f1f1]">
      <div className="mx-3 rounded-[14px] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]">
        <div className="flex items-center gap-2.5">
          <AppAvatar account={p.account} size={34} />
          <span className="text-[13.5px] font-semibold">{p.account.name}</span>
          <span className="text-[12px] text-[#aaa]">2 hours ago</span>
        </div>
        <Caption
          text={p.caption ?? p.title ?? ''}
          display={p.display.caption}
          className="mt-2.5 text-[14px] leading-[1.42]"
          tagClass="text-[#3ea6ff]"
          moreClass="font-semibold text-[#aaa]"
        />
        {p.media[0] && <MediaView item={p.media[0]} className="mt-3 aspect-square w-full rounded-[12px]" />}
        <div className="mt-3 flex items-center gap-5 text-[13px] text-[#ddd]">
          <button type="button" onClick={() => setVote((v) => !v)} className="flex items-center gap-1.5">
            <ThumbsUp size={17} fill={vote ? 'white' : 'none'} /> {compact(p.counts.likes + (vote ? 1 : 0))}
          </button>
          <ThumbsDown size={17} />
          <span className="ml-auto flex items-center gap-1.5">
            <MessageCircle size={17} /> {p.counts.comments}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Facebook ───────────────────────────────────────────────────────────────────────

export function FacebookReel(p: SurfaceProps) {
  const [liked, setLiked] = useState(false)
  const [following, setFollowing] = useState(false)
  return (
    <VerticalShell
      p={p}
      top={
        <div className="flex items-center gap-3 px-4 text-[20px] font-bold">
          <ArrowLeft size={24} />
          Reels
          <span className="ml-auto flex gap-5">
            <Search size={23} />
            <Camera size={23} />
          </span>
        </div>
      }
      rail={
        <>
          <LikeButton
            liked={liked}
            onToggle={() => setLiked((l) => !l)}
            render={(l) => (
              <RailItem label={compact(p.counts.likes + (l ? 1 : 0))}>
                <ThumbsUp size={27} {...icon} className={l ? 'fill-[#1877f2] text-[#1877f2]' : ''} />
              </RailItem>
            )}
          />
          <RailItem label={compact(p.counts.comments)}>
            <MessageCircle size={27} {...icon} />
          </RailItem>
          <RailItem label={compact(p.counts.shares)}>
            <Share2 size={26} {...icon} />
          </RailItem>
          <RailItem>
            <Ellipsis size={24} />
          </RailItem>
        </>
      }
      bottom={
        <div className="text-[14px] leading-[1.35]">
          <div className="mb-2 flex items-center gap-2">
            <AppAvatar account={p.account} size={34} />
            <span className="font-semibold">{p.account.name}</span>
            <span className="text-white/70">·</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setFollowing((f) => !f)
              }}
              className="font-semibold"
            >
              {following ? 'Following' : 'Follow'}
            </button>
          </div>
          <Caption
            text={p.caption ?? ''}
            display={p.display.caption}
            tagClass="text-white"
            moreClass="font-semibold text-white/80"
            clamp
          />
          <MusicLine p={p} fallback={`${p.account.name} · Original audio`} />
        </div>
      }
    />
  )
}

/** Facebook feed: a Page post in the light feed. */
export function FacebookFeed(p: SurfaceProps) {
  const [liked, setLiked] = useState(false)
  const items = p.media
  return (
    <div className="flex h-full flex-col bg-[#f0f2f5] text-[#050505]">
      <div className="flex h-[96px] shrink-0 items-end justify-between bg-white px-4 pb-2.5">
        <span className="text-[27px] font-bold tracking-[-0.04em] text-[#1877f2]">facebook</span>
        <span className="flex gap-2.5">
          {[Plus, Search, MessageCircle].map((I, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static
            <span key={i} className="grid size-9 place-items-center rounded-full bg-[#e4e6eb]">
              <I size={19} strokeWidth={2.3} />
            </span>
          ))}
        </span>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mt-2 bg-white pb-1">
          <div className="flex items-center gap-2.5 px-3 pt-3">
            <AppAvatar account={p.account} size={40} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[15px] font-semibold">{p.account.name}</span>
              <span className="flex items-center gap-1 text-[13px] text-[#65676b]">
                2h · {p.location ? `${p.location} · ` : ''}
                <Globe size={11} />
              </span>
            </span>
            <Ellipsis size={20} className="text-[#65676b]" />
            <X size={22} className="text-[#65676b]" />
          </div>
          <div className="px-3 pt-2.5 pb-2.5 text-[15px] leading-[1.34]">
            <Caption
              text={p.caption ?? ''}
              display={p.display.caption}
              tagClass="font-semibold text-[#385898]"
              moreClass="font-semibold text-[#65676b]"
            />
          </div>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: preview */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: preview */}
          <div onClick={p.playback.toggle} className="relative">
            {items.length <= 1 ? (
              <div
                className="relative w-full bg-black"
                style={{
                  aspectRatio: String(
                    items[0]?.width && items[0].height
                      ? Math.min(1.91, Math.max(0.8, items[0].width / items[0].height))
                      : 1,
                  ),
                }}
              >
                <MediaView item={items[0]} playback={p.playback} className="absolute inset-0 size-full" />
                {items[0]?.kind === 'video' && (
                  <MuteButton playback={p.playback} className="absolute right-3 bottom-3 size-7" />
                )}
              </div>
            ) : (
              <div className="grid aspect-square w-full grid-cols-2 gap-[2px] bg-white">
                <MediaView item={items[0]} className="row-span-2 size-full" />
                <MediaView item={items[1]} className="size-full" />
                <div className="relative">
                  <MediaView item={items[2] ?? items[1]} className="size-full" />
                  {items.length > 3 && (
                    <span className="absolute inset-0 grid place-items-center bg-black/45 text-[26px] font-semibold text-white">
                      +{items.length - 3}
                    </span>
                  )}
                </div>
              </div>
            )}
            <TapFlash flash={p.playback.flash} />
          </div>
          <div className="flex items-center justify-between px-3 py-2.5 text-[13.5px] text-[#65676b]">
            <span className="flex items-center gap-1.5">
              <span className="grid size-[18px] place-items-center rounded-full bg-[#1877f2] text-white">
                <ThumbsUp size={10} fill="white" />
              </span>
              {compact(p.counts.likes + (liked ? 1 : 0))}
            </span>
            <span>
              {p.counts.comments} comments · {p.counts.shares} shares
            </span>
          </div>
          <div className="mx-3 flex border-t border-[#ced0d4] text-[14.5px] font-semibold text-[#65676b]">
            <button
              type="button"
              onClick={() => setLiked((l) => !l)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 py-2.5',
                liked && 'text-[#1877f2]',
              )}
            >
              <ThumbsUp size={19} fill={liked ? '#1877f2' : 'none'} /> Like
            </button>
            <span className="flex flex-1 items-center justify-center gap-2 py-2.5">
              <MessageCircle size={19} /> Comment
            </span>
            <span className="flex flex-1 items-center justify-center gap-2 py-2.5">
              <Share2 size={19} /> Share
            </span>
          </div>
          {p.firstComment && (
            <div className="flex gap-2 px-3 pt-1 pb-3">
              <AppAvatar account={p.account} size={30} />
              <div className="rounded-[18px] bg-[#f0f2f5] px-3 py-2 text-[14px] leading-tight">
                <div className="text-[13px] font-semibold">{p.account.name}</div>
                {p.firstComment}
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 h-60 bg-white opacity-60" />
      </div>
      <BottomNav
        dark={false}
        items={[
          <Home key="h" size={24} className="text-[#1877f2]" fill="#1877f2" />,
          <Clapperboard key="v" size={24} />,
          <Users key="f" size={24} />,
          <MessageCircle key="n" size={24} />,
          <AppAvatar key="a" account={p.account} size={26} />,
        ]}
      />
    </div>
  )
}
