import { MediaKind, MediaStatus, parseQuery } from '@greenlit/shared'
import { registerLocales } from '@/lib/i18n'
import en from './locales/en.json'
import it from './locales/it.json'

// The media browser is shared by the library and project pages, so its strings live with it.
registerLocales('browser', { en, it })

/**
 * The search grammar (packages/shared/search.ts) as chips: finished filters sit in the field as tokens, free words stay
 * text. The whole thing serialises back to one query string, which is what the URL and the API carry.
 */
export type TokenKey = 'status' | 'kind' | 'tag' | 'project' | 'exclude' | 'has' | 'no'
export interface Token {
  key: TokenKey
  value: string
}

export const STATUSES = MediaStatus.options
export const KINDS = MediaKind.options
/** What `has:` / `no:` can ask for (has:depth = with a depth map). */
export const HAS = ['depth'] as const

/** Italian keys typed by hand map to the English grammar. */
const KEY_ALIASES: Record<string, TokenKey> = {
  status: 'status',
  stato: 'status',
  kind: 'kind',
  type: 'kind',
  tipo: 'kind',
  tag: 'tag',
  project: 'project',
  progetto: 'project',
  has: 'has',
  con: 'has',
  no: 'no',
  senza: 'no',
}

const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s)

export function tokenToString(t: Token) {
  switch (t.key) {
    case 'tag':
      return /\s/.test(t.value) ? `#"${t.value}"` : `#${t.value}`
    case 'exclude':
      return `-${quote(t.value)}`
    default:
      return `${t.key}:${quote(t.value)}`
  }
}

export function serialize(tokens: Token[], text: string) {
  return [...tokens.map(tokenToString), text.trim()].filter(Boolean).join(' ')
}

export function parseTokens(q: string): { tokens: Token[]; text: string } {
  const p = parseQuery(q)
  const tokens: Token[] = []
  const extra: string[] = []
  for (const [key, values] of Object.entries(p.filters)) {
    const k = KEY_ALIASES[key]
    for (const v of values) {
      if ((k === 'has' || k === 'no') && !HAS.includes(v.toLowerCase() as never))
        extra.push(`${key}:${quote(v)}`)
      else if (k && k !== 'tag')
        tokens.push({ key: k, value: k === 'has' || k === 'no' ? v.toLowerCase() : v })
      else if (k === 'tag') tokens.push({ key: 'tag', value: v })
      else extra.push(`${key}:${quote(v)}`)
    }
  }
  for (const t of p.tags) tokens.push({ key: 'tag', value: t })
  for (const x of p.exclude) tokens.push({ key: 'exclude', value: x })
  return { tokens, text: [...p.text.map(quote), ...extra].join(' ') }
}

/** A word that is a complete token (`status:approved`, `#villa`, `-drone`), or null. */
export function wordToToken(word: string): Token | null {
  const tag = word.match(/^#(.+)$/)
  if (tag?.[1]) return { key: 'tag', value: tag[1].replace(/^"|"$/g, '') }
  const kv = word.match(/^([a-z]+):(.+)$/i)
  if (kv?.[1] && kv[2]) {
    const key = KEY_ALIASES[kv[1].toLowerCase()]
    if (key) {
      const value = kv[2].replace(/^"|"$/g, '')
      if (key === 'status' && !STATUSES.includes(value as never)) return null
      if (key === 'kind' && !KINDS.includes(value as never)) return null
      if ((key === 'has' || key === 'no') && !HAS.includes(value.toLowerCase() as never)) return null
      return { key, value: key === 'has' || key === 'no' ? value.toLowerCase() : value }
    }
  }
  const ex = word.match(/^-(.+)$/)
  if (ex?.[1]) return { key: 'exclude', value: ex[1].replace(/^"|"$/g, '') }
  return null
}

export function hasToken(q: string, t: Token) {
  return parseTokens(q).tokens.some((x) => x.key === t.key && x.value.toLowerCase() === t.value.toLowerCase())
}

/** Adds the token, or removes it when it is already there. */
export function toggleToken(q: string, t: Token) {
  const { tokens, text } = parseTokens(q)
  const i = tokens.findIndex((x) => x.key === t.key && x.value.toLowerCase() === t.value.toLowerCase())
  if (i >= 0) tokens.splice(i, 1)
  else tokens.push(t)
  return serialize(tokens, text)
}

export function countFilters(q: string) {
  return parseTokens(q).tokens.length
}
