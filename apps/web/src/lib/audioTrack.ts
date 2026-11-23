/**
 * Keeps an audio element locked to a video, for an audio track that replaces the video's own sound: play, pause,
 * seek, speed and loop follow the video, a drift over 0.15 s is corrected, and a shorter track falls silent at its
 * end (like the published file). Returns a function that stops following and unloads the audio.
 */
export function followVideo(video: HTMLMediaElement, audio: HTMLAudioElement): () => void {
  const ended = () => Number.isFinite(audio.duration) && video.currentTime >= audio.duration
  const align = (force: boolean) => {
    if (ended()) return audio.pause()
    if (force || Math.abs(audio.currentTime - video.currentTime) > 0.15) audio.currentTime = video.currentTime
  }
  const resume = () => {
    if (!video.paused && audio.paused && !ended()) void audio.play().catch(() => {})
  }
  const play = () => {
    align(true)
    resume()
  }
  const pause = () => {
    audio.pause()
    align(true)
  }
  const seek = () => {
    align(true)
    resume()
  }
  const tick = () => {
    if (video.paused) return
    align(false)
    resume()
  }
  const rate = () => {
    audio.playbackRate = video.playbackRate
  }
  const on: [string, () => void][] = [
    ['play', play],
    ['pause', pause],
    ['ended', pause],
    ['seeked', seek],
    ['timeupdate', tick],
    ['ratechange', rate],
  ]
  for (const [e, f] of on) video.addEventListener(e, f)
  rate()
  if (video.paused) align(true)
  else play()
  return () => {
    for (const [e, f] of on) video.removeEventListener(e, f)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}
