import { z } from 'zod'
import type { Platform } from './posts.ts'

/**
 * Web links: addresses kept on a project or a media item (the listing on the website, the published video, a
 * Drive folder, the agency's page...). Only http and https, so a link can never run script when clicked.
 */

/**
 * The address as Greenlit keeps it, or null when it isn't a web address: trimmed, `https://` added when the scheme is
 * missing ("example.it/immobili" works), other schemes refused (javascript:, file:, ftp:...).
 */
export function normalizeWebUrl(text: string): string | null {
  let s = text.trim()
  if (!s || /\s/.test(s)) return null
  if (!/^https?:\/\//i.test(s)) {
    // Another scheme ("ftp://", "file:///") is refused; anything else is taken as a bare address.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null
    s = `https://${s.replace(/^\/+/, '')}`
  }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  // A user name or password in an address is almost always a mistake ("mailto:a@b.com" read as one).
  if (u.username || u.password) return null
  const host = u.hostname
  if (!host || (!host.includes('.') && !host.startsWith('[') && host !== 'localhost')) return null
  return u.href
}

export const isWebUrl = (text: string) => normalizeWebUrl(text) !== null

export const WebLink = z.object({
  url: z.string().max(2048).refine(isWebUrl, 'Not a web address (it must start with http:// or https://)'),
  /** What the link is; empty = show the address. */
  title: z.string().max(300).default(''),
})
export type WebLink = z.infer<typeof WebLink>

export const WebLinks = z.array(WebLink).max(100)

/** What Greenlit read from a page: its address after redirects and its title (empty when it couldn't tell). */
export const WebLinkPreview = z.object({ url: z.string(), title: z.string() })
export type WebLinkPreview = z.infer<typeof WebLinkPreview>

/**
 * A list as stored: addresses normalised, titles trimmed, empty and repeated addresses dropped (the first one stays),
 * so the same page is never in the list twice.
 */
export function cleanWebLinks(links: readonly { url: string; title?: string }[]): WebLink[] {
  const out: WebLink[] = []
  const seen = new Set<string>()
  for (const l of links) {
    const url = normalizeWebUrl(l.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, title: (l.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 300) })
  }
  return out
}

/** The host without "www.", for showing an address shortly. */
export function webLinkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** "example.it/immobili/villa": host and path, without the scheme, "www." or a trailing slash. */
export function webLinkAddress(url: string): string {
  try {
    const u = new URL(url)
    const path = `${u.pathname}${u.search}`.replace(/\/$/, '')
    return `${u.hostname.replace(/^www\./, '')}${path === '/' ? '' : path}`
  } catch {
    return url
  }
}

/** What a link shows: its title, or its address when it has none. */
export const webLinkLabel = (l: WebLink) => l.title.trim() || webLinkAddress(l.url)

const PLATFORM_HOSTS: [Platform, RegExp][] = [
  ['youtube', /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
  ['instagram', /(^|\.)(instagram\.com|instagr\.am)$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.com|fb\.watch|fb\.me)$/],
  ['tiktok', /(^|\.)tiktok\.com$/],
]

/** The social platform a link points at, for its icon; null for any other site. */
export function webLinkPlatform(url: string): Platform | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  return PLATFORM_HOSTS.find(([, re]) => re.test(host))?.[0] ?? null
}
