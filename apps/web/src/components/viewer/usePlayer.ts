import { useEffect, useRef } from 'react'
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
    el.muted = muted
  }, [el, rate, loop, volume, muted])

  useEffect(() => {
    useViewer.getState().set({ fps: fps || 30 })
  }, [fps])
}

/** Step by whole frames (negative = back). */
export function stepFrames(n: number) {
  const s = useViewer.getState()
  s.controls?.pause()
  const f = s.fps || 30
  const frame = Math.round(s.time * f) + n
  s.controls?.seek(Math.max(0, frame / f + 0.0001))
}
