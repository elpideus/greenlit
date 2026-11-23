import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ffmpeg } from '../../../lib/ffmpeg.ts'
import type { DriverRun } from './types.ts'

/**
 * A video's first frame as a JPEG, the cover a platform's own app or composer uploads with a video (an Instagram
 * carousel's video, a Facebook reel), under DATA_DIR/tmp/connectors/<folder>. The caller removes it.
 */
export async function firstFrame(run: DriverRun, video: string, name: string, folder: string) {
  const dir = join(run.dataDir, 'tmp', 'connectors', folder)
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${name}.jpg`)
  await ffmpeg(['-v', 'error', '-i', video, '-frames:v', '1', '-q:v', '3', out])
  return out
}

/**
 * A picture as a silent video of `seconds` (even sides, H.264), for a platform that makes a picture with a sound
 * into a video itself (Instagram turns a picture with a sound into a reel). Under DATA_DIR/tmp/connectors/<folder>;
 * the caller removes it.
 */
export async function stillVideo(
  run: DriverRun,
  image: string,
  seconds: number,
  name: string,
  folder: string,
) {
  const dir = join(run.dataDir, 'tmp', 'connectors', folder)
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${name}.mp4`)
  await ffmpeg([
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-framerate',
    '30',
    '-i',
    image,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t',
    String(seconds),
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    out,
  ])
  return out
}

/** Where a story sticker sits on the picture, as the app's tap model names it (fractions of the picture). */
export interface StickerBox {
  x: number
  y: number
  width: number
  height: number
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/**
 * A location sticker as the app draws one (a white pill with a pin and the place's name), centred on a canvas of
 * `width` × `height`: the transparent PNG to lay over the picture or video, and where it sits.
 */
export async function placeStickerPng(width: number, height: number, name: string) {
  const { default: sharp } = await import('sharp')
  const text = name.trim().slice(0, 40)
  const font = Math.round(height * 0.03)
  const pad = Math.round(font * 0.7)
  const pin = Math.round(font * 1.1)
  const w = Math.min(width - 2 * pad, Math.round(pad * 2 + pin + font * 0.4 + text.length * font * 0.56))
  const h = Math.round(font * 2)
  const x = Math.round((width - w) / 2)
  const y = Math.round((height - h) / 2)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(h * 0.28)}" fill="#ffffff"/>
  <g transform="translate(${x + pad},${y + (h - pin) / 2}) scale(${pin / 24})">
    <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="#8a3ab9"/>
  </g>
  <text x="${x + pad + pin + font * 0.4}" y="${y + h / 2}" dominant-baseline="central" font-family="Inter, Roboto, Arial, sans-serif" font-weight="600" font-size="${font}" fill="#111111">${escapeXml(text)}</text>
</svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const box: StickerBox = { x: 0.5, y: 0.5, width: w / width, height: h / height }
  return { png, box }
}

/**
 * The story's picture or video with a location sticker drawn on it, as the app burns its stickers in (the sticker's
 * tap area is named in the Share). Under DATA_DIR/tmp/connectors/<folder>; the caller removes it.
 */
export async function withPlaceSticker(
  run: DriverRun,
  o: {
    path: string
    kind: 'image' | 'video'
    width: number
    height: number
    name: string
    file: string
    folder: string
  },
) {
  const { default: sharp } = await import('sharp')
  const dir = join(run.dataDir, 'tmp', 'connectors', o.folder)
  await mkdir(dir, { recursive: true })
  const { png, box } = await placeStickerPng(o.width, o.height, o.name)
  if (o.kind === 'image') {
    const out = join(dir, `${o.file}.jpg`)
    await sharp(o.path)
      .composite([{ input: png }])
      .jpeg({ quality: 92 })
      .toFile(out)
    return { path: out, box, extra: [] as string[] }
  }
  const overlay = join(dir, `${o.file}-sticker.png`)
  await sharp(png).toFile(overlay)
  const out = join(dir, `${o.file}.mp4`)
  await ffmpeg([
    '-v',
    'error',
    '-y',
    '-i',
    o.path,
    '-i',
    overlay,
    '-filter_complex',
    'overlay=0:0',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    out,
  ])
  return { path: out, box, extra: [overlay] }
}
