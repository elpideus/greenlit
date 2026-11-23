/**
 * Keeps an audio element locked to a video, for an audio track that replaces the video's own sound: play, pause,
 * seek, speed and loop follow the video, a drift over 0.15 s is corrected, and a shorter track falls silent at its
 * end (like the published file). Returns a function that stops following (and pauses the audio); the audio stays
 * loaded, so it can follow another video (the same moment in another version) without a gap. Unload it with
 * releaseAudio.
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
    // A video taken off the page (another version took over) stops without pausing the sound.
    if (!video.isConnected) return
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
  align(false)
  resume()
  return () => {
    for (const [e, f] of on) video.removeEventListener(e, f)
    audio.pause()
  }
}

/** Stops an audio element and frees what it loaded. */
export function releaseAudio(audio: HTMLAudioElement) {
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
}
