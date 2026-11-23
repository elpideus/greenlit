/**
 * Cookie import: a fallback when a platform refuses the remote sign-in. Accepts what browser extensions export —
 * a Netscape `cookies.txt` (Get cookies.txt, yt-dlp) or JSON (Cookie-Editor, EditThisCookie, Playwright's
 * storageState) — and turns it into Playwright cookies for the platform's own domains only.
 */

export interface ImportedCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

export function parseCookies(text: string, allowedDomains: string[]): ImportedCookie[] {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Paste the exported cookies first')
  const raw = trimmed.startsWith('[') || trimmed.startsWith('{') ? fromJson(trimmed) : fromNetscape(trimmed)
  const allowed = (domain: string) => {
    const d = domain.replace(/^\./, '').toLowerCase()
    return allowedDomains.some((a) => d === a || d.endsWith(`.${a}`))
  }
  const out = raw.filter((c) => c.name && allowed(c.domain))
  if (!out.length) throw new Error(`No cookies for ${allowedDomains.join(', ')} in what was pasted`)
  // Later duplicates win (exports sometimes repeat a cookie).
  const byKey = new Map(out.map((c) => [`${c.domain}|${c.path}|${c.name}`, c]))
  return [...byKey.values()]
}

function fromNetscape(text: string): ImportedCookie[] {
  const out: ImportedCookie[] = []
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true
      line = line.slice('#HttpOnly_'.length)
    }
    if (!line.trim() || line.startsWith('#')) continue
    const parts = line.split('\t')
    if (parts.length < 7) continue
    const [domain, , path, secure, expires, name, ...rest] = parts
    out.push({
      domain: domain!,
      path: path || '/',
      secure: /^true$/i.test(secure ?? ''),
      expires: Number(expires) > 0 ? Number(expires) : -1,
      name: name!,
      value: rest.join('\t'),
      httpOnly,
      sameSite: 'Lax',
    })
  }
  return out
}

function fromJson(text: string): ImportedCookie[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That is not valid JSON or cookies.txt')
  }
  const list = Array.isArray(data) ? data : ((data as { cookies?: unknown[] })?.cookies ?? [])
  const out: ImportedCookie[] = []
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue
    const name = String(item.name ?? '')
    const domain = String(item.domain ?? item.host ?? '')
    if (!name || !domain) continue
    const exp = Number(item.expirationDate ?? item.expires ?? item.expiry ?? -1)
    const ss = String(item.sameSite ?? '').toLowerCase()
    out.push({
      name,
      value: String(item.value ?? ''),
      domain,
      path: String(item.path ?? '/'),
      expires: exp > 0 ? Math.floor(exp) : -1,
      httpOnly: !!(item.httpOnly ?? item.httponly),
      secure: !!item.secure,
      sameSite: ss === 'strict' ? 'Strict' : ss === 'none' || ss === 'no_restriction' ? 'None' : 'Lax',
    })
  }
  return out.map((c) => (c.sameSite === 'None' ? { ...c, secure: true } : c))
}
