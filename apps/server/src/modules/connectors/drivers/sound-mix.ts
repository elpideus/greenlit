import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioMix, MusicChoice } from '@greenlit/shared/areas/posts'
import { ffmpeg, probe } from '../../../lib/ffmpeg.ts'
import { previewHostOk, type SoundSource } from '../sounds.ts'
import type { DriverRun } from './types.ts'

/**
 * A video with a platform's sound mixed in, as the platforms' own apps make them (YouTube's for a Short,
 * Instagram's for a reel): the app mixes the sound into the file on the phone and uploads that, and the platform
 * links the sound to the post. Greenlit does the same: the sound from `startAt` for the video's length at its
 * volume, the video's own audio at its own (or the sound alone when the video has none). The video stream is
 * copied, not encoded again. The file goes under DATA_DIR/tmp/connectors/<folder> (API Anything reads uploads from
 * the data folder only); the caller removes it.
 */
export async function mixSound(
  run: DriverRun,
  o: {
    video: string
    src: SoundSource
    music: MusicChoice
    audio: AudioMix
    /** The video's length, seconds. */
    length: number
    /** The output's name (an attempt's id). */
    name: string
    folder: string
    /** Whose app this copies, for the step shown ("the YouTube app"). */
    app: string
  },
): Promise<string> {
  const { video, src, music, audio, length } = o
  if (!previewHostOk(src.url))
    throw new Error('The sound’s audio is not on one of the platform’s media hosts')
  const own = (await probe(video)).hasAudio
  const dir = join(run.dataDir, 'tmp', 'connectors', o.folder)
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${o.name}.mp4`)
  const start = Math.max(0, (music.startAt ?? 0) - (src.offset ?? 0))
  const sound = `[1:a]atrim=0:${length},asetpts=PTS-STARTPTS,volume=${audio.music},apad=whole_dur=${length}`
  const filter = own
    ? `${sound}[s];[0:a]volume=${audio.original}[o];[o][s]amix=inputs=2:duration=first:normalize=0[a]`
    : `${sound}[a]`
  run.step(`Mixing ${music.title} into the video, as ${o.app} does`)
  try {
    await ffmpeg([
      '-v',
      'error',
      '-i',
      video,
      '-ss',
      String(start),
      '-t',
      String(length + 1),
      '-protocol_whitelist',
      'https,tls,tcp',
      '-i',
      src.url,
      '-filter_complex',
      filter,
      '-map',
      '0:v:0',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-t',
      String(length),
      '-movflags',
      '+faststart',
      out,
    ])
  } catch (err) {
    await rm(out, { force: true })
    throw new Error(`The sound could not be mixed in (${(err as Error).message.split('\n')[0]})`)
  }
  return out
}

/**
 * The video with its own audio at `volume` (0 silences it), for a platform that takes no volume of its own: the
 * video itself when the volume is 1 or it has no audio. The video stream is copied.
 */
export async function withOwnVolume(
  run: DriverRun,
  o: { video: string; volume: number; name: string; folder: string },
): Promise<string> {
  if (o.volume >= 1 || !(await probe(o.video)).hasAudio) return o.video
  const dir = join(run.dataDir, 'tmp', 'connectors', o.folder)
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${o.name}.mp4`)
  run.step(`Setting the video’s own sound to ${Math.round(o.volume * 100)}%`)
  try {
    await ffmpeg([
      '-v',
      'error',
      '-i',
      o.video,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c:v',
      'copy',
      '-af',
      `volume=${o.volume}`,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      out,
    ])
  } catch (err) {
    await rm(out, { force: true })
    throw new Error(`The video’s sound could not be set (${(err as Error).message.split('\n')[0]})`)
  }
  return out
}
