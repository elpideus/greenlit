/**
 * Keeps `follower` (a silent video: a depth map) on the same frame as `main`. Play, pause, seeks and speed follow
 * it; while playing, a drift of more than a frame is pulled in by nudging the follower's speed (no visible jump),
 * more than half a second by seeking. Paused, it sits exactly on the main video's moment. Returns a function that
 * stops following (and pauses the follower).
 */
export function followFrames(main: HTMLMediaElement, follower: HTMLVideoElement, fps = 30): () => void {
  const frame = 1 / (fps || 30)
  let raf = 0
  const align = (exact: boolean) => {
    const t = main.currentTime
    const drift = follower.currentTime - t
    if (exact || Math.abs(drift) > 0.5) {
      if (Math.abs(drift) > 0.001) follower.currentTime = t
      follower.playbackRate = main.playbackRate
      return
    }
    // Up to ±8% faster or slower closes a few frames' gap within half a second without a jump.
    const nudge = Math.abs(drift) > frame ? Math.max(-0.08, Math.min(0.08, -drift * 1.5)) : 0
    follower.playbackRate = main.playbackRate * (1 + nudge)
  }
  const loop = () => {
    if (main.paused) return
    align(false)
    if (follower.paused && !follower.ended) void follower.play().catch(() => {})
    raf = requestAnimationFrame(loop)
  }
  const play = () => {
    align(true)
    void follower.play().catch(() => {})
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(loop)
  }
  const pause = () => {
    // A video taken off the page (another version took over) stops on its own; the new one takes the follower.
    if (!main.isConnected) return
    cancelAnimationFrame(raf)
    follower.pause()
    align(true)
  }
  const seek = () => align(true)
  const rate = () => {
    follower.playbackRate = main.playbackRate
  }
  const on: [string, () => void][] = [
    ['play', play],
    ['pause', pause],
    ['ended', pause],
    ['seeking', seek],
    ['seeked', seek],
    ['ratechange', rate],
  ]
  follower.muted = true
  for (const [e, f] of on) main.addEventListener(e, f)
  const start = () => (main.paused ? align(true) : play())
  if (follower.readyState >= 1) start()
  else follower.addEventListener('loadedmetadata', start, { once: true })
  return () => {
    for (const [e, f] of on) main.removeEventListener(e, f)
    follower.removeEventListener('loadedmetadata', start)
    cancelAnimationFrame(raf)
    follower.pause()
  }
}
