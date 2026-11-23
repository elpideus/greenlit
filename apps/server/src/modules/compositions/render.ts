import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Composition, frameCount, type OutputFormat } from '@greenlit/composition'
import { type Browser, chromium, type Page } from 'playwright-core'
import sharp from 'sharp'
import type { Actor } from '../../core/actor.ts'
import type { JobContext } from '../../core/jobs.ts'
import type { ModuleContext } from '../../core/module.ts'
import { ffmpeg } from '../../lib/ffmpeg.ts'

/**
 * Rendering = the same React stage the editor shows, opened in headless Chromium and captured frame by
 * frame. Video layers read exact frames pre-extracted with ffmpeg (any codec, frame accurate); audio is
 * mixed by ffmpeg from the same document. Stills (for Claude and posters) use the same path with one frame.
 */

export interface RenderSession {
  id: string
  token: string
  compositionId: string
  doc: Composition
  format: OutputFormat
  dir: string
  /** clipId → folder of frames (000001.jpg = clip frame 0) */
  frames: Map<string, string>
  /** assetId → URLs for the page (images and audio) */
  assets: Record<string, { src: string | null; poster: string | null }>
  createdAt: number
}

export class Renderer {
  private ctx: ModuleContext
  private browser: Promise<Browser> | null = null
  private sessions = new Map<string, RenderSession>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** Pages currently open: the browser is never closed while one is in use. */
  private active = 0

  constructor(ctx: ModuleContext) {
    this.ctx = ctx
  }

  get(id: string, token: string) {
    const s = this.sessions.get(id)
    return s && s.token === token ? s : null
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.active === 0) void this.close()
      else this.armIdle()
    }, 5 * 60_000)
  }

  private async getBrowser() {
    this.armIdle()
    if (!this.browser) {
      this.browser = chromium
        .launch({
          executablePath: this.ctx.config.chromium,
          headless: true,
          args: [
            '--autoplay-policy=no-user-gesture-required',
            '--hide-scrollbars',
            '--mute-audio',
            '--force-color-profile=srgb',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            // Several pages render at once: none of them may be throttled as a background tab.
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
          ],
        })
        .catch((err) => {
          this.browser = null
          throw new Error(
            `Could not start Chromium at ${this.ctx.config.chromium}: ${(err as Error).message}`,
          )
        })
    }
    return this.browser
  }

  async close() {
    const b = this.browser
    this.browser = null
    if (b) await (await b).close().catch(() => {})
  }

  private pageBase() {
    const dist = join(this.ctx.config.webDist, 'index.html')
    return existsSync(dist) && !process.env.GREENLIT_WEB_URL
      ? this.ctx.config.internalUrl
      : this.ctx.config.webUrl
  }

  /** Creates a session: extracts the frames every video clip needs (for `times`, or the whole timeline). */
  async createSession(
    compositionId: string,
    doc: Composition,
    format: OutputFormat,
    actor: Actor,
    times?: number[],
    signal?: AbortSignal,
    onProgress?: (p: number) => void,
  ) {
    const id = crypto.randomUUID()
    const dir = join(this.ctx.config.dataDir, 'tmp', 'render', id)
    await mkdir(dir, { recursive: true })
    const files = this.ctx.services.files
    const media = this.ctx.services.media
    const session: RenderSession = {
      id,
      token: randomBytes(18).toString('base64url'),
      compositionId,
      doc,
      format,
      dir,
      frames: new Map(),
      assets: {},
      createdAt: Date.now(),
    }
    // Resolve every asset to its file.
    const paths = new Map<string, string>()
    for (const asset of Object.values(doc.assets)) {
      const formats = await media.formatsOf(asset.mediaId)
      const f =
        formats.find((x) => x.key === asset.formatKey) ?? formats.find((x) => x.isPrimary) ?? formats[0]
      if (!f) continue
      const blob = await files.get(f.blobId)
      paths.set(asset.id, await files.readablePath(blob))
      const poster = f.derived.includes('poster.webp')
        ? files.sign(`/api/files/${f.blobId}/d/poster.webp`)
        : null
      const src =
        asset.kind === 'image'
          ? (poster ?? files.sign(`/api/files/${f.blobId}`))
          : asset.kind === 'audio'
            ? files.sign(`/api/files/${f.blobId}`)
            : null
      session.assets[asset.id] = { src, poster }
    }
    // Pre-extract video frames, clip by clip.
    const clips = doc.tracks.flatMap((t) =>
      t.kind === 'visual' && !t.hidden
        ? t.clips.filter((c) => c.type === 'video' && c.assetId && !c.hidden)
        : [],
    )
    let done = 0
    for (const c of clips) {
      const src = paths.get(c.assetId!)
      if (!src) continue
      const out = join(dir, 'clips', c.id)
      await mkdir(out, { recursive: true })
      const speed = c.speed ?? 1
      const scale = `scale='min(${Math.max(format.width, format.height) * 2},iw)':-2:flags=lanczos`
      if (times) {
        // Stills: only the frames needed.
        for (const t of times) {
          if (t < c.start || t >= c.start + c.duration) continue
          const k = Math.round((t - c.start) * doc.fps)
          const mt = (c.in ?? 0) + (k / doc.fps) * speed
          await ffmpeg(
            [
              '-ss',
              mt.toFixed(4),
              '-i',
              src,
              '-frames:v',
              '1',
              '-vf',
              scale,
              '-q:v',
              '2',
              join(out, `${String(k + 1).padStart(6, '0')}.jpg`),
            ],
            { signal },
          )
        }
      } else {
        const frames = Math.ceil(c.duration * doc.fps) + 1
        await ffmpeg(
          [
            '-ss',
            (c.in ?? 0).toFixed(4),
            '-i',
            src,
            '-t',
            (c.duration * speed + 1 / doc.fps).toFixed(4),
            '-vf',
            `fps=${(doc.fps / speed).toFixed(6)},${scale}`,
            '-frames:v',
            String(frames),
            '-q:v',
            '2',
            '-start_number',
            '1',
            join(out, '%06d.jpg'),
          ],
          {
            signal,
            durationSec: c.duration * speed,
            onProgress: (p) => onProgress?.((done + p) / Math.max(1, clips.length)),
          },
        )
      }
      session.frames.set(c.id, out)
      done++
      onProgress?.(done / Math.max(1, clips.length))
    }
    this.sessions.set(id, session)
    return session
  }

  async dropSession(s: RenderSession) {
    this.sessions.delete(s.id)
    await rm(s.dir, { recursive: true, force: true })
  }

  /** Path of the extracted frame for a clip (nearest existing one). */
  framePath(s: RenderSession, clipId: string, index: number) {
    const dir = s.frames.get(clipId)
    if (!dir) return null
    const exact = join(dir, `${String(index + 1).padStart(6, '0')}.jpg`)
    if (existsSync(exact)) return exact
    for (let d = 1; d < 4; d++) {
      for (const k of [index + 1 - d, index + 1 + d]) {
        const p = join(dir, `${String(Math.max(1, k)).padStart(6, '0')}.jpg`)
        if (existsSync(p)) return p
      }
    }
    return null
  }

  private async openPage(s: RenderSession): Promise<Page> {
    const browser = await this.getBrowser()
    this.active++
    const page = await browser.newPage({
      viewport: { width: s.format.width, height: s.format.height },
      deviceScaleFactor: 1,
    })
    page.once('close', () => {
      this.active = Math.max(0, this.active - 1)
      this.armIdle()
    })
    page.on('pageerror', (e) => this.ctx.log.warn({ err: e.message }, 'render page error'))
    page.on(
      'console',
      (m) =>
        (m.type() === 'error' || m.type() === 'warning') &&
        this.ctx.log.warn({ text: m.text().slice(0, 500) }, 'render page console'),
    )
    page.on('requestfailed', (r) =>
      this.ctx.log.warn(
        { url: r.url().slice(0, 200), err: r.failure()?.errorText },
        'render page request failed',
      ),
    )
    const url = `${this.pageBase()}/render/${s.id}?token=${s.token}`
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
    await page
      .waitForFunction('window.__glRender && window.__glRender.ready', null, { timeout: 60_000 })
      .catch(async (err) => {
        this.ctx.log.warn(
          { url: page.url(), html: (await page.content().catch(() => '')).slice(0, 600) },
          'render page never became ready',
        )
        throw err
      })
    return page
  }

  private async capture(
    page: Page,
    s: RenderSession,
    t: number,
    type: 'jpeg' | 'png' = 'jpeg',
  ): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      try {
        await page.evaluate(`window.__glRender.seek(${t})`)
        break
      } catch (err) {
        // In development Vite may reload the page (hot reload); wait for it and try again.
        if (attempt >= 3 || !/context was destroyed|navigation/i.test((err as Error).message)) throw err
        await page.waitForFunction('window.__glRender && window.__glRender.ready', null, { timeout: 60_000 })
      }
    }
    return page.screenshot({
      type,
      quality: type === 'jpeg' ? 92 : undefined,
      clip: { x: 0, y: 0, width: s.format.width, height: s.format.height },
      animations: 'allow',
      caret: 'initial',
      scale: 'css',
    })
  }

  /** Frames as JPEG buffers, exactly as an export would draw them. */
  async stills(compositionId: string, doc: Composition, format: OutputFormat, times: number[], actor: Actor) {
    const s = await this.createSession(compositionId, doc, format, actor, times)
    try {
      const page = await this.openPage(s)
      try {
        const out: Buffer[] = []
        for (const t of times)
          out.push(await this.capture(page, s, Math.max(0, Math.min(t, doc.duration - 1 / doc.fps))))
        return out
      } finally {
        await page.close()
      }
    } finally {
      await this.dropSession(s)
    }
  }

  /** A contact sheet: frames in a grid with their times. */
  async contactSheet(
    compositionId: string,
    doc: Composition,
    format: OutputFormat,
    times: number[],
    actor: Actor,
  ) {
    const frames = await this.stills(compositionId, doc, format, times, actor)
    const cols = Math.min(4, frames.length)
    const w = 480
    const h = Math.round((w * format.height) / format.width)
    const rows = Math.ceil(frames.length / cols)
    const label = 28
    const tiles = await Promise.all(
      frames.map(async (f, i) => ({
        input: await sharp(f).resize(w, h).toBuffer(),
        left: (i % cols) * (w + 8),
        top: Math.floor(i / cols) * (h + label + 8) + label,
      })),
    )
    const labels = times.map(
      (t, i) =>
        `<text x="${(i % cols) * (w + 8) + 4}" y="${Math.floor(i / cols) * (h + label + 8) + 20}" font-family="sans-serif" font-size="18" fill="#fff">${t.toFixed(2)}s</text>`,
    )
    const W = cols * (w + 8)
    const H = rows * (h + label + 8)
    return sharp({ create: { width: W, height: H, channels: 3, background: '#111' } })
      .composite([
        ...tiles,
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels.join('')}</svg>`,
          ),
          left: 0,
          top: 0,
        },
      ])
      .jpeg({ quality: 82 })
      .toBuffer()
  }

  /** Full export of one format to an MP4 file. Returns the path of the finished file. */
  async render(compositionId: string, doc: Composition, format: OutputFormat, actor: Actor, job: JobContext) {
    const s = await this.createSession(
      compositionId,
      doc,
      format,
      actor,
      undefined,
      job.signal,
      (p) => void job.progress(p * 0.15, 'Preparing video frames'),
    )
    try {
      const total = frameCount(doc)
      const outDir = join(s.dir, 'out')
      await mkdir(outDir, { recursive: true })
      const workers = Math.max(1, Math.min(4, Math.floor(this.ctx.config.workers)))
      const chunk = Math.ceil(total / workers)
      let captured = 0
      await Promise.all(
        Array.from({ length: workers }, async (_, w) => {
          const from = w * chunk
          const to = Math.min(total, from + chunk)
          if (from >= to) return
          const page = await this.openPage(s)
          try {
            for (let n = from; n < to; n++) {
              if (job.signal.aborted) throw new Error('Render cancelled')
              const buf = await this.capture(page, s, n / doc.fps)
              await writeFile(join(outDir, `${String(n + 1).padStart(6, '0')}.jpg`), buf)
              captured++
              if (captured % 5 === 0)
                void job.progress(0.15 + (captured / total) * 0.7, `Drawing frame ${captured} of ${total}`)
            }
          } finally {
            await page.close()
          }
        }),
      )
      const count = (await readdir(outDir)).length
      if (count < total) throw new Error(`Only ${count} of ${total} frames were drawn`)
      await job.progress(0.86, 'Encoding')
      const file = join(s.dir, `${format.id}.mp4`)
      const audio = await this.audioArgs(doc)
      await ffmpeg(
        [
          '-framerate',
          String(doc.fps),
          '-i',
          join(outDir, '%06d.jpg'),
          ...audio.inputs,
          ...(audio.filter
            ? ['-filter_complex', audio.filter, '-map', '0:v', '-map', '[aout]']
            : ['-map', '0:v', '-map', `${audio.silentIndex}:a`]),
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-crf',
          '16',
          '-pix_fmt',
          'yuv420p',
          '-profile:v',
          'high',
          '-color_primaries',
          'bt709',
          '-color_trc',
          'bt709',
          '-colorspace',
          'bt709',
          '-c:a',
          'aac',
          '-b:a',
          '320k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-t',
          doc.duration.toFixed(3),
          '-movflags',
          '+faststart',
          file,
        ],
        {
          durationSec: doc.duration,
          onProgress: (p) => void job.progress(0.86 + p * 0.12, 'Encoding'),
          signal: job.signal,
        },
      )
      // Move the result out of the session folder before it is deleted.
      const final = await this.ctx.services.files.tmpPath('.mp4')
      await import('node:fs/promises').then((fs) => fs.rename(file, final))
      return final
    } finally {
      await this.dropSession(s)
    }
  }

  /** ffmpeg inputs + filter graph mixing every audible clip (volume, fades, speed, track volume). */
  private async audioArgs(doc: Composition) {
    const inputs: string[] = []
    const chains: string[] = []
    let idx = 1
    for (const track of doc.tracks) {
      if (track.muted) continue
      for (const c of track.clips) {
        if (c.hidden || (c.type !== 'audio' && c.type !== 'video') || !c.assetId) continue
        const asset = doc.assets[c.assetId]
        if (!asset || (c.type === 'video' && !asset.hasAudio) || c.audio?.muted) continue
        const formats = await this.ctx.services.media.formatsOf(asset.mediaId)
        const f =
          formats.find((x) => x.key === asset.formatKey) ?? formats.find((x) => x.isPrimary) ?? formats[0]
        if (!f) continue
        const path = await this.ctx.services.files.readablePath(await this.ctx.services.files.get(f.blobId))
        const speed = c.speed ?? 1
        inputs.push('-i', path)
        const parts = [
          `atrim=start=${(c.in ?? 0).toFixed(4)}:duration=${(c.duration * speed).toFixed(4)}`,
          'asetpts=PTS-STARTPTS',
        ]
        let sp = speed
        while (sp > 2) {
          parts.push('atempo=2')
          sp /= 2
        }
        while (sp < 0.5) {
          parts.push('atempo=0.5')
          sp /= 0.5
        }
        if (Math.abs(sp - 1) > 1e-3) parts.push(`atempo=${sp.toFixed(4)}`)
        const base = (c.audio?.volume ?? 1) * (track.volume ?? 1)
        const keys = c.keyframes?.['audio.volume']
        if (keys?.length) {
          const sorted = [...keys].sort((a, b) => a.t - b.t)
          let expr = String(Number(sorted[sorted.length - 1]!.value) * (track.volume ?? 1))
          for (let i = sorted.length - 2; i >= 0; i--) {
            const a = sorted[i]!
            const b = sorted[i + 1]!
            const va = Number(a.value) * (track.volume ?? 1)
            const vb = Number(b.value) * (track.volume ?? 1)
            expr = `if(lt(t,${b.t}),${va}+(${vb - va})*(t-${a.t})/${Math.max(1e-3, b.t - a.t)},${expr})`
          }
          expr = `if(lt(t,${sorted[0]!.t}),${Number(sorted[0]!.value) * (track.volume ?? 1)},${expr})`
          parts.push(`volume='${expr}':eval=frame`)
        } else if (Math.abs(base - 1) > 1e-3) parts.push(`volume=${base.toFixed(4)}`)
        if (c.audio?.fadeIn) parts.push(`afade=t=in:st=0:d=${c.audio.fadeIn}`)
        if (c.audio?.fadeOut)
          parts.push(
            `afade=t=out:st=${Math.max(0, c.duration - c.audio.fadeOut).toFixed(3)}:d=${c.audio.fadeOut}`,
          )
        const delay = Math.round(c.start * 1000)
        parts.push('aformat=sample_rates=48000:channel_layouts=stereo', `adelay=${delay}|${delay}`)
        chains.push(`[${idx}:a]${parts.join(',')}[a${idx}]`)
        idx++
      }
    }
    const silentIndex = idx
    inputs.push('-f', 'lavfi', '-t', doc.duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo')
    if (!chains.length) return { inputs, filter: null, silentIndex }
    const mixInputs = chains.map((_, i) => `[a${i + 1}]`).join('')
    const filter = `${chains.join(';')};${mixInputs}[${silentIndex}:a]amix=inputs=${chains.length + 1}:duration=longest:normalize=0,atrim=0:${doc.duration.toFixed(3)}[aout]`
    return { inputs, filter, silentIndex }
  }

  /** Drop stale sessions (crashed renders). */
  async sweep() {
    for (const s of this.sessions.values())
      if (Date.now() - s.createdAt > 6 * 3600_000) await this.dropSession(s)
  }
}
