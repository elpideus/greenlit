import { useEffect, useRef, useState } from 'react'
import { followVideo } from '@/lib/audioTrack'
import { useViewer } from './store'

/**
 * Binds a <video>/<audio> element to the shared viewer store: time (every frame while playing), duration, playing
 * state, rate, loop, volume, and the imperative controls other features call (seek from a note, pause on a pin).
 */
export function usePlayer(el: HTMLMediaElement | null, fps: number) {
  const raf = useRef(0)
  const rate = useViewer((s) => s.rate)
  const loop = useViewer((s) => s.loop)
  const volume = useViewer((s) => s.volume)
  const muted = useViewer((s) => s.muted)
  // Another audio track plays instead of the video's own sound (see useAudioTrack).
  const replaced = useViewer((s) => !!s.audioTrack) && el instanceof HTMLVideoElement

  useEffect(() => {
    if (!el) return
    const set = useViewer.getState().set
    const tick = () => {
      set({ time: el.currentTime })
      if (!el.paused) raf.current = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      set({ playing: true })
      cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(tick)
    }
    const onPause = () => {
      cancelAnimationFrame(raf.current)
      set({ playing: false, time: el.currentTime })
    }
    const onMeta = () => set({ duration: Number.isFinite(el.duration) ? el.duration : 0 })
    const onSeeked = () => set({ time: el.currentTime })
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onPause)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('seeked', onSeeked)
    el.addEventListener('timeupdate', onSeeked)
    set({
      controls: {
        play: () => void el.play().catch(() => {}),
        pause: () => el.pause(),
        seek: (t) => {
          const d = Number.isFinite(el.duration) ? el.duration : t
          el.currentTime = Math.max(0, Math.min(d, t))
          set({ time: el.currentTime })
        },
      },
    })
    if (el.readyState >= 1) onMeta()
    return () => {
      cancelAnimationFrame(raf.current)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onPause)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
      el.removeEventListener('seeked', onSeeked)
      el.removeEventListener('timeupdate', onSeeked)
      useViewer.getState().set({ controls: null, playing: false })
    }
  }, [el])

  useEffect(() => {
    if (!el) return
    el.playbackRate = rate
    el.loop = loop
    el.volume = volume
    el.muted = muted || replaced
  }, [el, rate, loop, volume, muted, replaced])

  useEffect(() => {
    useViewer.getState().set({ fps: fps || 30 })
  }, [fps])
}

/**
 * Plays an audio track in place of the video's sound, locked to the video: play, pause, seek, speed and loop follow
 * it, and a drift over 0.15 s is corrected. A shorter track falls silent at its end, like the published file.
 */
export function useAudioTrack(video: HTMLMediaElement | null, url: string | null) {
  const volume = useViewer((s) => s.volume)
  const muted = useViewer((s) => s.muted)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!video || !url) return
    const a = new Audio()
    a.preload = 'auto'
    a.src = url
    setAudio(a)
    const stop = followVideo(video, a)
    return () => {
      stop()
      setAudio(null)
    }
  }, [video, url])

  useEffect(() => {
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [audio, volume, muted])
}

/** Step by whole frames (negative = back). */
export function stepFrames(n: number) {
  const s = useViewer.getState()
  s.controls?.pause()
  const f = s.fps || 30
  const frame = Math.round(s.time * f) + n
  s.controls?.seek(Math.max(0, frame / f + 0.0001))
}
