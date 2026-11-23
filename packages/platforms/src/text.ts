import type { Display, PlacementSpec, TextUnit } from './types.ts'

/** Length the way the platform counts it. */
export function textLength(s: string, unit: TextUnit = 'chars'): number {
  if (unit === 'utf16') return s.length
  if (unit === 'bytes') return new TextEncoder().encode(s).length
  let n = 0
  for (const _ of s) n++
  return n
}

/** Cuts a string to `max` units without splitting a character (or a UTF-8 sequence). */
export function cutToLength(s: string, max: number, unit: TextUnit = 'chars'): string {
  if (textLength(s, unit) <= max) return s
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = unit === 'chars' ? 1 : unit === 'utf16' ? ch.length : new TextEncoder().encode(ch).length
    if (used + w > max) break
    out += ch
    used += w
  }
  return out
}

const HASHTAG = /(^|[^\p{L}\p{N}_&#])#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu
const MENTION = /(^|[^\p{L}\p{N}_@.])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/gu

/** Hashtags in a text, without the '#', in order (#2024 alone is not a hashtag on most platforms). */
export function extractHashtags(s: string): string[] {
  return [...s.matchAll(HASHTAG)].map((m) => m[2]!)
}

export function extractMentions(s: string): string[] {
  return [...s.matchAll(MENTION)].map((m) => m[2]!)
}

export const normalizeHashtag = (t: string) => t.trim().replace(/^#+/, '').replace(/\s+/g, '')

/** Every distinct hashtag of a post: the caption's plus the separate list (case-insensitive). */
export function allHashtags(text: string, extra: string[] = []): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...extractHashtags(text), ...extra.map(normalizeHashtag)]) {
    if (!t) continue
    const k = t.toLocaleLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/** The caption as it will be published: text, then the separate hashtags not already in it. */
export function composeCaption(text: string, hashtags: string[] = []): string {
  const present = new Set(extractHashtags(text).map((t) => t.toLocaleLowerCase()))
  const add = hashtags.map(normalizeHashtag).filter((t) => t && !present.has(t.toLocaleLowerCase()))
  if (!add.length) return text
  const tags = add.map((t) => `#${t}`).join(' ')
  return text.trim() ? `${text.trimEnd()}\n\n${tags}` : tags
}

/**
 * YouTube tag length: tags joined with commas, and a tag containing a space counted as if quoted
 * ("Foo Baz" counts 9). The limit is 500.
 */
export function youtubeTagsLength(tags: string[]): number {
  const t = tags.map((x) => x.trim()).filter(Boolean)
  if (!t.length) return 0
  return t.reduce((n, x) => n + textLength(x) + (/\s/.test(x) ? 2 : 0), 0) + (t.length - 1)
}

/**
 * What a viewer sees before tapping "more": the first `lines` lines, at most `chars` characters, cut at a word
 * boundary when one is close. `truncated` tells the preview to append the platform's "more".
 */
export function truncateForDisplay(
  text: string,
  display: Display | undefined,
): { visible: string; truncated: boolean } {
  const clean = text.replace(/\s+$/, '')
  if (!display) return { visible: clean, truncated: false }
  let visible = clean
  let truncated = false
  if (display.lines) {
    const lines = visible.split('\n')
    if (lines.length > display.lines) {
      visible = lines.slice(0, display.lines).join('\n')
      truncated = true
    }
  }
  if (display.chars && textLength(visible) > display.chars) {
    const cut = cutToLength(visible, display.chars)
    const space = cut.search(/\s\S*$/)
    visible = space > display.chars * 0.75 ? cut.slice(0, space) : cut
    truncated = true
  }
  return { visible: visible.replace(/[\s,.;:–-]+$/u, ''), truncated }
}

/** Which text field carries the post text on a placement (caption, or description for YouTube / TikTok photos). */
export function bodyField(spec: PlacementSpec): 'caption' | 'description' | null {
  if (spec.text.caption) return 'caption'
  if (spec.text.description) return 'description'
  return null
}
