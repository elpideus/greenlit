import type { MusicTrack, SoundWaveform } from '@greenlit/shared'
import { Music2, Pause, Play, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { compactNumber, formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { IconButton, SearchInput, Skeleton, Slider, Toggle } from '@/ui'
import { soundAudioUrl, useMusicSearch, useSoundWaveform } from '../api'
import type { DraftTarget } from '../model'
import { useWhere } from '../parts'
import { Panel } from './bits'
import { useComposer } from './state'

/** One shared player for sound previews, so only one plays at a time. */
const player = {
  el: null as HTMLAudioElement | null,
  id: null as string | null,
  listeners: new Set<() => void>(),
}
function playSound(id: string, url: string, from = 0) {
  if (player.id === id && player.el && !player.el.paused) {
    player.el.pause()
  } else {
    player.el?.pause()
    player.el = new Audio(url)
    player.el.currentTime = from
    player.id = id
    player.el.onended = () => {
      for (const l of player.listeners) l()
    }
    player.el.onpause = () => {
      for (const l of player.listeners) l()
    }
    void player.el.play().catch(() => {})
  }
  for (const l of player.listeners) l()
}
function usePlaying(id: string) {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    player.listeners.add(l)
    return () => {
      player.listeners.delete(l)
    }
  }, [])
  return player.id === id && !!player.el && !player.el.paused
}

/**
 * A track from the platform's own library: Greenlit never mixes it into the file — the platform attaches its own
 * sound, so it stays linked and tappable there. Plus the volume of the video's sound against it.
 */
export function SoundSection({ target, duration }: { target: DraftTarget; duration: number | null }) {
  const t = useT('posts')
  const where = useWhere()
  const c = useComposer()
  const account = c.accounts.find((a) => a.id === target.accountId)
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q)
  const [searching, setSearching] = useState(false)
  const search = useMusicSearch(account?.id ?? null, deferred, target.placement, searching)
  if (!account) return null
  const name = where(account.platform)
  const mix = account.capabilities.audioMix

  const choose = (tr: MusicTrack) => {
    c.updateTarget(target.key, {
      music: {
        trackId: tr.trackId,
        title: tr.title,
        artist: tr.artist,
        coverUrl: tr.coverUrl,
        previewUrl: tr.previewUrl,
        startAt: 0,
        duration: tr.duration,
      },
    })
    setSearching(false)
    setQ('')
  }

  return (
    <Panel title={t('composer.sound')} hint={t('composer.soundHint', { where: name })}>
      {target.music ? (
        <ChosenSound
          target={target}
          accountId={account.id}
          duration={duration}
          onRemove={() => c.updateTarget(target.key, { music: null })}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v)
              setSearching(true)
            }}
            onFocus={() => setSearching(true)}
            placeholder={t('composer.soundSearch', { where: name })}
            disabled={!c.editable}
          />
          {searching && (
            <div className="max-h-[320px] overflow-y-auto rounded-[10px] shadow-[inset_0_0_0_1px_var(--line)]">
              {search.isLoading ? (
                <div className="space-y-1 p-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-11" />
                  ))}
                </div>
              ) : search.error ? (
                <div className="px-4 py-5 t-caption text-ink-3">{t('composer.soundUnavailable')}</div>
              ) : !search.data?.length ? (
                <div className="px-4 py-5 t-caption text-ink-3">{t('composer.soundNothing')}</div>
              ) : (
                search.data.map((tr) => (
                  <TrackRow key={tr.trackId} track={tr} accountId={account.id} onChoose={() => choose(tr)} />
                ))
              )}
            </div>
          )}
          {!searching && (
            <div className="flex items-center gap-2 t-caption text-ink-4">
              <Music2 size={14} />
              {t('composer.soundNone')}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-3 t-label">{t('composer.mix')}</div>
        {mix ? (
          <div className="grid grid-cols-[110px_1fr_40px] items-center gap-x-3 gap-y-3">
            <span className="t-callout text-ink-2">{t('composer.mixOriginal')}</span>
            <Slider
              value={target.audio.original}
              onChange={(v) => c.updateTarget(target.key, { audio: { ...target.audio, original: v } })}
              disabled={!c.editable}
            />
            <span className="t-meta text-right text-ink-3">{Math.round(target.audio.original * 100)}</span>
            <span className={cn('t-callout', target.music ? 'text-ink-2' : 'text-ink-4')}>
              {t('composer.mixMusic')}
            </span>
            <Slider
              value={target.audio.music}
              onChange={(v) => c.updateTarget(target.key, { audio: { ...target.audio, music: v } })}
              disabled={!c.editable || !target.music}
            />
            <span className="t-meta text-right text-ink-3">{Math.round(target.audio.music * 100)}</span>
          </div>
        ) : (
          <div className="flex flex-col">
            <label className="flex items-center justify-between py-1.5 t-callout text-ink-2">
              {t('composer.muteOriginal')}
              <Toggle
                checked={target.audio.original === 0}
                onChange={(on) =>
                  c.updateTarget(target.key, { audio: { ...target.audio, original: on ? 0 : 1 } })
                }
                disabled={!c.editable}
              />
            </label>
            <label className="flex items-center justify-between py-1.5 t-callout text-ink-2">
              {t('composer.muteMusic')}
              <Toggle
                checked={target.audio.music === 0}
                onChange={(on) =>
                  c.updateTarget(target.key, { audio: { ...target.audio, music: on ? 0 : 1 } })
                }
                disabled={!c.editable || !target.music}
              />
            </label>
          </div>
        )}
      </div>
    </Panel>
  )
}

function Cover({ url, size = 40 }: { url: string | null | undefined; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-[7px] bg-hover text-ink-3"
      style={{ width: size, height: size }}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <Music2 size={size * 0.4} />}
    </span>
  )
}

function TrackRow({
  track,
  accountId,
  onChoose,
}: {
  track: MusicTrack
  accountId: string
  onChoose: () => void
}) {
  const t = useT('posts')
  const playing = usePlaying(track.trackId)
  return (
    <div className="group flex items-center gap-3 px-2 py-1.5 hover:bg-hover">
      <button
        type="button"
        onClick={() => playSound(track.trackId, soundAudioUrl(accountId, track.trackId, track.previewUrl))}
        className="press relative"
        aria-label={playing ? t('composer.stop') : t('composer.listen')}
      >
        <Cover url={track.coverUrl} />
        <span
          className={cn(
            'absolute inset-0 grid place-items-center rounded-[7px] bg-black/45 text-white transition-opacity',
            playing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </span>
      </button>
      <button type="button" onClick={onChoose} className="min-w-0 flex-1 text-left">
        <span className="block truncate t-callout font-[550] text-ink">{track.title}</span>
        <span className="block truncate t-caption text-ink-3">
          {track.artist}
          {track.usage ? ` · ${t('composer.soundUsage', { n: compactNumber(track.usage) })}` : ''}
        </span>
      </button>
      {track.duration ? <span className="t-meta text-ink-4">{formatDuration(track.duration)}</span> : null}
    </div>
  )
}

function ChosenSound({
  target,
  accountId,
  duration,
  onRemove,
}: {
  target: DraftTarget
  accountId: string
  duration: number | null
  onRemove: () => void
}) {
  const t = useT('posts')
  const c = useComposer()
  const m = target.music!
  const wave = useSoundWaveform(accountId, m.trackId, m.previewUrl)
  const playing = usePlaying(m.trackId)
  const url = soundAudioUrl(accountId, m.trackId, m.previewUrl)
  return (
    <div className="rounded-[12px] p-3 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="press relative"
          onClick={() => playSound(m.trackId, url, Math.max(0, m.startAt - (wave.data?.offset ?? 0)))}
        >
          <Cover url={m.coverUrl} size={48} />
          <span className="absolute inset-0 grid place-items-center rounded-[7px] bg-black/40 text-white">
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate t-callout font-[550] text-ink">{m.title}</div>
          <div className="truncate t-caption text-ink-3">{m.artist}</div>
        </div>
        <span className="t-meta text-ink-3">
          {t('composer.soundStart', { time: formatDuration(m.startAt) })}
        </span>
        {c.editable && <IconButton icon={X} size="sm" label={t('composer.soundRemove')} onClick={onRemove} />}
      </div>
      {wave.isLoading ? (
        <Skeleton className="mt-3 h-14" />
      ) : wave.data ? (
        <Waveform
          wave={wave.data}
          window={duration ?? m.duration ?? 15}
          startAt={m.startAt}
          disabled={!c.editable}
          onChange={(startAt) => c.updateTarget(target.key, { music: { ...m, startAt } })}
        />
      ) : null}
    </div>
  )
}

/** The sound's peaks with a window the length of the video: drag it to choose where the song starts. */
function Waveform({
  wave,
  window: win,
  startAt,
  onChange,
  disabled,
}: {
  wave: SoundWaveform
  window: number
  startAt: number
  onChange: (s: number) => void
  disabled?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const frac = Math.min(1, win / wave.duration)
  const pos = Math.max(0, Math.min(1 - frac, (startAt - wave.offset) / wave.duration))
  const bars = 96
  const peaks = Array.from({ length: bars }, (_, i) => {
    const a = Math.floor((i / bars) * wave.peaks.length)
    const b = Math.max(a + 1, Math.floor(((i + 1) / bars) * wave.peaks.length))
    let m = 0
    for (let j = a; j < b; j++) m = Math.max(m, wave.peaks[j] ?? 0)
    return m / 100
  })
  const drag = (e: React.PointerEvent) => {
    if (disabled) return
    const el = box.current!
    const r = el.getBoundingClientRect()
    const grab = (e.clientX - r.left) / r.width - pos
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const p = Math.max(0, Math.min(1 - frac, (ev.clientX - r.left) / r.width - grab))
      onChange(Math.round((wave.offset + p * wave.duration) * 10) / 10)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div
      ref={box}
      onPointerDown={drag}
      className={cn(
        'relative mt-3 h-14 touch-none select-none',
        !disabled && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="absolute inset-0 flex items-center gap-[2px]">
        {peaks.map((p, i) => {
          const x = i / bars
          const inside = x >= pos && x <= pos + frac
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: bars
              key={i}
              className={cn(
                'flex-1 rounded-full transition-colors duration-150',
                inside ? 'bg-signal' : 'bg-ink-4',
              )}
              style={{ height: `${Math.max(6, p * 100)}%` }}
            />
          )
        })}
      </div>
      <motion.div
        className="pointer-events-none absolute inset-y-0 rounded-[8px] shadow-[inset_0_0_0_2px_var(--signal),0_0_0_1px_rgba(0,0,0,.3)]"
        style={{ left: `${pos * 100}%`, width: `${frac * 100}%` }}
        layout
        transition={{ duration: 0 }}
      />
    </div>
  )
}
