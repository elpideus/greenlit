import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MusicTrack } from '@greenlit/shared/areas/connectors'
import type { BrowserContext, Locator, Page, Response } from 'playwright-core'
import { ffmpeg } from '../../../lib/ffmpeg.ts'
import { NeedsLogin } from './types.ts'

/**
 * Helpers shared by the drivers. Drivers find things the way a person does — by role and visible text, in English
 * and Italian (the owner's accounts may use either) — or by the stable ids/test ids the sites themselves use.
 */

/** Case-insensitive regex that matches any of the labels (whole label when `exact`). */
export function label(alternatives: string[], exact = false): RegExp {
  const body = alternatives.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(exact ? `^\\s*(?:${body})\\s*$` : `(?:${body})`, 'i')
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** How many matches of one candidate firstVisible looks at. */
const FIRST_VISIBLE_SCAN = 10

/**
 * The first visible element of the candidates within `timeout` (in the candidates' order, then the page's), or null.
 * Every match of a candidate counts, not only its first: pages keep hidden copies of their dialogs (TikTok Studio
 * keeps the cover editor's Save, Cancel and Sounds in the page once a cover is uploaded, ahead of the video
 * editor's own), and the first match being hidden must not hide a visible one.
 */
export async function firstVisible(candidates: Locator[], timeout = 8000): Promise<Locator | null> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const c of candidates) {
      const n = Math.min(await c.count().catch(() => 0), FIRST_VISIBLE_SCAN)
      for (let i = 0; i < n; i++) {
        const l = n === 1 ? c.first() : c.nth(i)
        if (await l.isVisible().catch(() => false)) return l
      }
    }
    await sleep(250)
  }
  return null
}

/** Clicks the first visible candidate; throws with `what` when none shows up. */
export async function clickOne(candidates: Locator[], what: string, timeout = 8000) {
  const l = await firstVisible(candidates, timeout)
  if (!l) throw new Error(`Could not find ${what}`)
  await l.click()
  return l
}

/**
 * Checks a radio button or checkbox and makes sure it took. Styled inputs often sit under their own drawn circle
 * (TikTok Studio's Radio: its `Radio__innerCircle` span takes the pointer, so clicking the input itself waits
 * until it times out), so the input's label is clicked first, as a person would, then the `also` locators (its
 * visible text), then the input with a forced click, then the input's own DOM click. Throws when none took.
 */
export async function checkInput(input: Locator, what: string, also: Locator[] = []) {
  const target = input.first()
  // A controlled input's aria-checked is what the page holds (TikTok leaves a stale `checked` on "Now").
  const on = () =>
    target
      .evaluate(
        (el) => {
          const aria = el.getAttribute('aria-checked')
          return aria === null ? (el as HTMLInputElement).checked : aria === 'true'
        },
        null,
        { timeout: 1000 },
      )
      .catch(() => false)
  if (await on()) return
  const id = await target.getAttribute('id', { timeout: 2000 }).catch(() => null)
  const page = target.page()
  const attempts: Locator[] = [
    ...(id ? [page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`)] : []),
    target.locator('xpath=ancestor::label[1]'),
    ...also,
  ]
  const took = async () => {
    for (let i = 0; i < 6; i++) {
      if (await on()) return true
      await sleep(200)
    }
    return false
  }
  for (const l of attempts) {
    const first = l.first()
    if (!(await first.isVisible().catch(() => false))) continue
    await first.click({ timeout: 2500 }).catch(() => {})
    if (await took()) return
  }
  await target.check({ force: true, timeout: 2500 }).catch(() => {})
  if (await took()) return
  await target.evaluate((el) => (el as HTMLInputElement).click()).catch(() => {})
  if (await took()) return
  throw new Error(`Could not choose ${what}`)
}

/** Replaces the text of an input, textarea or rich editor (contenteditable) like a person typing. */
export async function setText(page: Page, field: Locator, text: string) {
  await field.click()
  const editable = await field.evaluate((el) => (el as HTMLElement).isContentEditable).catch(() => false)
  if (editable) {
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    // Paragraph by paragraph: rich editors turn "\n" into Enter presses, which keeps line breaks.
    const lines = text.split('\n')
    for (const [i, line] of lines.entries()) {
      if (line) await page.keyboard.insertText(line)
      if (i < lines.length - 1) await page.keyboard.press('Shift+Enter')
    }
  } else {
    await field.fill(text)
  }
}

/** JSON responses seen while `action` runs, filtered by URL. */
export async function sniffJson<T>(
  page: Page,
  match: (url: string) => boolean,
  action: () => Promise<T>,
  settleMs = 1500,
): Promise<{ result: T; bodies: { url: string; json: unknown }[] }> {
  const bodies: { url: string; json: unknown }[] = []
  const pending = new Set<Promise<void>>()
  const onResponse = (r: Response) => {
    if (!match(r.url())) return
    const ct = r.headers()['content-type'] ?? ''
    if (!/json|javascript|text\/plain/.test(ct)) return
    const p = r
      .text()
      .then((t) => {
        const json = parseLooseJson(t)
        if (json !== undefined) bodies.push({ url: r.url(), json })
      })
      .catch(() => {})
      .finally(() => pending.delete(p))
    pending.add(p)
  }
  page.on('response', onResponse)
  try {
    const result = await action()
    await sleep(settleMs)
    await Promise.all(pending)
    return { result, bodies }
  } finally {
    page.off('response', onResponse)
  }
}

/** JSON, also with Meta's `for (;;);` prefix. */
export function parseLooseJson(text: string): unknown {
  const t = text.replace(/^\s*for\s*\(;;\);\s*/, '').trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined
  try {
    return JSON.parse(t)
  } catch {
    // Meta streams several JSON objects separated by newlines.
    const parts = t.split(/\n(?=\{)/).flatMap((p) => {
      try {
        return [JSON.parse(p)]
      } catch {
        return []
      }
    })
    return parts.length ? parts : undefined
  }
}

/** Every object somewhere inside `value` for which `test` is true (depth-first, bounded). */
export function findObjects(
  value: unknown,
  test: (o: Record<string, unknown>) => boolean,
  limit = 500,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number) => {
    if (out.length >= limit || depth > 40 || !v || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    const o = v as Record<string, unknown>
    if (test(o)) out.push(o)
    for (const x of Object.values(o)) walk(x, depth + 1)
  }
  walk(value, 0)
  return out
}

export const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
export const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
/** First URL in a platform "image" structure ({url_list: []}, {thumbnails: [{url}]}, "https://…"). */
export function firstUrl(v: unknown): string | null {
  if (!v) return null
  if (typeof v === 'string') return /^https?:\/\//.test(v) ? v : null
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = firstUrl(x)
      if (u) return u
    }
    return null
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['url', 'uri', 'src', 'url_list', 'urlList', 'thumbnails', 'sources']) {
      const u = firstUrl(o[k])
      if (u) return u
    }
  }
  return null
}

export async function cookie(context: BrowserContext, url: string, name: string): Promise<string | null> {
  const all = await context.cookies(url)
  const c = all.find((x) => x.name === name && (x.expires === -1 || x.expires * 1000 > Date.now()))
  return c?.value ?? null
}

/** Calendar parts of an instant as seen in a time zone. */
export function zoned(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    /** 2026-11-21 */
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    /** 14:05 */
    hm: `${parts.hour}:${parts.minute}`,
  }
}

/** Seconds of the video files (null when unknown). Uses the page so no extra tools are needed. */
export function isVertical(width: number | null, height: number | null) {
  return !!width && !!height && height > width
}

/** Waits until `fn` returns something truthy (polling), or throws `what` after `timeout`. */
export async function until<T>(
  fn: () => Promise<T | null | undefined | false>,
  what: string,
  timeout = 30_000,
  every = 500,
): Promise<T> {
  const end = Date.now() + timeout
  let last: unknown
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch (err) {
      if (err instanceof NeedsLogin) throw err
      last = err
    }
    await sleep(every)
  }
  throw new Error(`Timed out waiting for ${what}${last ? ` (${(last as Error).message})` : ''}`)
}

/** Public meta tags of a page (og:title, og:image…), fetched with the profile's cookies. */
export async function pageMeta(context: BrowserContext, url: string): Promise<Record<string, string>> {
  const res = await context.request.get(url, { timeout: 20_000, maxRedirects: 5 }).catch(() => null)
  if (!res?.ok()) return {}
  const html = await res.text()
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<meta\s+[^>]*(?:property|name)="([^"]+)"[^>]*content="([^"]*)"[^>]*>/g))
    out[m[1]!] ??= decodeHtml(m[2]!)
  for (const m of html.matchAll(/<meta\s+[^>]*content="([^"]*)"[^>]*(?:property|name)="([^"]+)"[^>]*>/g))
    out[m[2]!] ??= decodeHtml(m[1]!)
  out.__html = html.length > 2_000_000 ? html.slice(0, 2_000_000) : html
  return out
}

export function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

/**
 * Music tracks inside whatever JSON a platform's sound picker loaded. Platforms name the fields differently
 * (TikTok: id_str/title/author/play_url; Meta: audio_asset_id/title/display_artist/progressive_download_url),
 * so the parser looks for "an object with an id, a title and something playable or a cover".
 */
export function parseTracks(bodies: { json: unknown }[]): MusicTrack[] {
  const seen = new Map<string, MusicTrack>()
  for (const b of bodies) {
    const objects = findObjects(b.json, (o) => {
      const title = str(o.title ?? o.song_name ?? o.name)
      const id = str(
        o.id_str ?? o.mid ?? o.music_id ?? o.musicId ?? o.audio_asset_id ?? o.audio_cluster_id ?? o.id,
      )
      const playable =
        o.play_url ??
        o.playUrl ??
        o.progressive_download_url ??
        o.preview_url ??
        o.audio_url ??
        o.dash_manifest
      const artist = o.author ?? o.authorName ?? o.artist ?? o.display_artist ?? o.owner_nickname
      return (
        !!title &&
        !!id &&
        (!!playable ||
          (!!artist &&
            !!(o.cover_thumb ?? o.cover_medium ?? o.coverThumb ?? o.cover_artwork_uri ?? o.cover_large)))
      )
    })
    for (const o of objects) {
      const trackId = str(
        o.id_str ?? o.mid ?? o.music_id ?? o.musicId ?? o.audio_asset_id ?? o.audio_cluster_id ?? o.id,
      )
      if (seen.has(trackId)) continue
      const durationRaw = num(o.duration ?? o.duration_in_ms ?? o.durationMs ?? o.shoot_duration)
      seen.set(trackId, {
        trackId,
        title: str(o.title ?? o.song_name ?? o.name),
        artist: str(o.author ?? o.authorName ?? o.artist ?? o.display_artist ?? o.owner_nickname),
        coverUrl: firstUrl(
          o.cover_medium ??
            o.cover_thumb ??
            o.coverThumb ??
            o.cover_large ??
            o.cover_artwork_uri ??
            o.coverMedium,
        ),
        previewUrl: firstUrl(
          o.play_url ?? o.playUrl ?? o.progressive_download_url ?? o.preview_url ?? o.audio_url,
        ),
        duration:
          durationRaw === null ? null : durationRaw > 1000 ? Math.round(durationRaw / 1000) : durationRaw,
        usage: num(o.user_count ?? o.video_count ?? o.videoCount ?? o.reels_count ?? o.usage_count),
      })
    }
  }
  return [...seen.values()]
}

/**
 * A 3-second silent vertical clip. Some composers only open their sound picker once a video is in them; the
 * drivers load this clip to browse the library and leave without posting.
 */
export async function probeClip(dataDir: string): Promise<string> {
  const dir = join(dataDir, 'connectors')
  const file = join(dir, 'probe-9x16.mp4')
  if (existsSync(file)) return file
  await mkdir(dir, { recursive: true })
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x1d1f1e:s=720x1280:r=30:d=3',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    '3',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-movflags',
    '+faststart',
    file,
  ])
  return file
}
