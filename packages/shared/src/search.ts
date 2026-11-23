/**
 * Search grammar shared by every search box, the API and the MCP tools.
 *   word words "exact phrase"   free text (title, description, notes, tags)
 *   #tag  #"two words"          media with exactly this tag
 *   kind:video  status:approved  type filters
 *   project:"Villa Rosa"         limit to a project by name
 *   -word                        exclude
 */
export interface ParsedQuery {
  text: string[]
  exclude: string[]
  tags: string[]
  filters: Record<string, string[]>
}

const TOKEN = /(-?)(?:([a-z]+):)?(?:#"([^"]+)"|#(\S+)|"([^"]+)"|(\S+))/gi

export function parseQuery(input: string): ParsedQuery {
  const out: ParsedQuery = { text: [], exclude: [], tags: [], filters: {} }
  for (const m of input.matchAll(TOKEN)) {
    const [, neg, key, qtag, tag, phrase, word] = m
    if (qtag || tag) {
      out.tags.push((qtag ?? tag)!)
      continue
    }
    const value = phrase ?? word ?? ''
    if (key) {
      const k = key.toLowerCase()
      ;(out.filters[k] ??= []).push(value)
      continue
    }
    if (!value) continue
    if (neg) out.exclude.push(value)
    else out.text.push(value)
  }
  return out
}

export function stringifyQuery(q: ParsedQuery): string {
  const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s)
  return [
    ...q.text.map(quote),
    ...q.exclude.map((s) => `-${quote(s)}`),
    ...q.tags.map((t) => (/\s/.test(t) ? `#"${t}"` : `#${t}`)),
    ...Object.entries(q.filters).flatMap(([k, vs]) => vs.map((v) => `${k}:${quote(v)}`)),
  ].join(' ')
}
