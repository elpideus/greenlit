import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { webLinkPlatform } from '@greenlit/shared'

/**
 * Reads a web page's title for a link someone pastes. Best effort: any failure (no answer, a refusal, not HTML) gives
 * an empty title, never an error. Only public addresses are fetched: every host is resolved and checked before
 * connecting (also after each redirect, and on the connection itself, so a name can't switch to a private address in
 * between), so the server can't be pointed at the home network or itself.
 */

const UA = 'Mozilla/5.0 (compatible; Greenlit link preview)'
const TIMEOUT_MS = 8000
const MAX_BYTES = 1_000_000
const MAX_REDIRECTS = 5

// Two lists: Node matches IPv4 addresses against IPv4-mapped IPv6 rules, so one list would block every IPv4.
const PRIVATE_V4 = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PRIVATE_V4.addSubnet(net, bits, 'ipv4')
const PRIVATE_V6 = new BlockList()
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  PRIVATE_V6.addSubnet(net, bits, 'ipv6')

/** True for loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return PRIVATE_V4.check(address, 'ipv4')
  if (family !== 6) return true
  // An IPv4 address written as IPv6 (::ffff:127.0.0.1) is judged as that IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1]
  if (mapped) return isPrivateAddress(mapped)
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(address)) {
    const [hi, lo] = address
      .slice(7)
      .split(':')
      .map((h) => Number.parseInt(h, 16)) as [number, number]
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  return PRIVATE_V6.check(address, 'ipv6')
}

/** A DNS lookup for http(s).request that refuses names resolving to any private address. */
function publicLookup(
  hostname: string,
  options: { all?: boolean; family?: number | string },
  callback: (...args: unknown[]) => void,
) {
  dnsLookup(hostname, { all: true, family: Number(options.family) || 0 }, (err, addresses) => {
    if (err) return callback(err)
    const list = addresses as LookupAddress[]
    if (!list.length || list.some((a) => isPrivateAddress(a.address)))
      return callback(Object.assign(new Error(`${hostname} is not a public address`), { code: 'EPRIVATE' }))
    if (options.all) return callback(null, list)
    callback(null, list[0]!.address, list[0]!.family)
  })
}

interface Page {
  status: number
  contentType: string
  body: string
}

function request(url: URL, accept: string): Promise<{ status: number; location?: string; page?: Page }> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    // Literal addresses skip the lookup, so they are checked here.
    if (isIP(host) && isPrivateAddress(host)) return reject(new Error('Not a public address'))
    const mod = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null
    if (!mod) return reject(new Error('Not a web address'))
    const req = mod.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Accept: accept,
          'Accept-Language': 'it,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        lookup: publicLookup as never,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return resolve({ status, location: res.headers.location })
        }
        const contentType = String(res.headers['content-type'] ?? '')
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
        const stream =
          enc === 'gzip' || enc === 'x-gzip'
            ? res.pipe(createGunzip())
            : enc === 'br'
              ? res.pipe(createBrotliDecompress())
              : enc === 'deflate'
                ? res.pipe(createInflate())
                : res
        const chunks: Buffer[] = []
        let size = 0
        let done = false
        const finish = () => {
          if (done) return
          done = true
          req.destroy()
          resolve({ status, page: { status, contentType, body: decode(Buffer.concat(chunks), contentType) } })
        }
        stream.on('data', (c: Buffer) => {
          chunks.push(c)
          size += c.length
          // The title is in the head: stop once it's read (or at the size cap).
          if (size >= MAX_BYTES || (accept.includes('html') && c.includes('</head>'))) finish()
        })
        stream.on('end', finish)
        stream.on('error', (e) => (done ? undefined : chunks.length ? finish() : reject(e)))
      },
    )
    // The socket timeout only catches silence; this caps a page that trickles in.
    const deadline = setTimeout(() => req.destroy(new Error('Timed out')), TIMEOUT_MS)
    req.on('close', () => clearTimeout(deadline))
    req.on('timeout', () => req.destroy(new Error('Timed out')))
    req.on('error', reject)
    req.end()
  })
}

/** GET with redirects followed by hand (each hop goes through the same checks). */
async function get(start: URL, accept: string): Promise<Page | null> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await request(url, accept)
    if (r.page) return r.page
    if (!r.location) return null
    url = new URL(r.location, url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  }
  return null
}

function decode(buf: Buffer, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'))?.[1]
  const charset = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase()
  try {
    return new TextDecoder(charset).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  agrave: 'à',
  aacute: 'á',
  egrave: 'è',
  eacute: 'é',
  igrave: 'ì',
  iacute: 'í',
  ograve: 'ò',
  oacute: 'ó',
  ugrave: 'ù',
  uacute: 'ú',
  Agrave: 'À',
  Aacute: 'Á',
  Egrave: 'È',
  Eacute: 'É',
  Igrave: 'Ì',
  Iacute: 'Í',
  Ograve: 'Ò',
  Oacute: 'Ó',
  Ugrave: 'Ù',
  Uacute: 'Ú',
  ccedil: 'ç',
  ntilde: 'ñ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  szlig: 'ß',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED[e] ?? m
  })
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, 300)

function metaContent(html: string, names: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    if (!key || !names.includes(key)) continue
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag)
    const v = content?.[1] ?? content?.[2]
    if (v?.trim()) return v
  }
  return null
}

/** Titles that only name the site, or a sign-in / consent / bot wall: they say nothing about the link. */
const SITE_ONLY = /^(instagram|facebook|tiktok( - make your day)?|youtube|x|twitter|google drive)$/i
const WALL =
  /^(log ?in(to)?|sign ?in(to)?|accedi|before you continue|prima di continuare|just a moment|attention required|access denied|403 forbidden|404 not found|page not found|pagina non trovata)\b/i

/** The page's own title: og:title / twitter:title, else <title>. Empty when there is none worth showing. */
export function titleFromHtml(html: string): string {
  const head = html.slice(0, MAX_BYTES)
  const og = metaContent(head, ['og:title', 'twitter:title'])
  const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  const title = clean(og ?? tag ?? '')
  return SITE_ONLY.test(title) || WALL.test(title) ? '' : title
}

/** Platforms with a public oEmbed endpoint give the real title without the consent or sign-in walls. */
const OEMBED: Partial<Record<string, (u: string) => string>> = {
  youtube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  tiktok: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
}

export async function pageTitle(url: string): Promise<string> {
  try {
    const platform = webLinkPlatform(url)
    const oembed = platform ? OEMBED[platform] : undefined
    if (oembed) {
      const page = await get(new URL(oembed(url)), 'application/json')
      if (page && page.status < 400) {
        const t = clean(String((JSON.parse(page.body) as { title?: unknown }).title ?? ''))
        if (t) return t
      }
    }
    const page = await get(new URL(url), 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5')
    if (!page || page.status >= 400 || !/html/i.test(page.contentType)) return ''
    return titleFromHtml(page.body)
  } catch {
    return ''
  }
}
