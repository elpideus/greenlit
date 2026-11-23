// biome-ignore-all lint/suspicious/noArrayIndexKey: a README's blocks never move; their place is their key
import { createElement, Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The Markdown kits write their READMEs in: headings, paragraphs, lists, tables, quotes, code, rules, bold, italic,
 * inline code and links. Rendered as React elements (never as HTML), so a kit's file can't inject anything.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={cn('gl-md', className)}>{blocks(source)}</div>
}

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }
  | { t: 'hr' }
  | { t: 'table'; head: string[]; rows: string[][] }

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      out.push({ t: 'h', level: h[1]!.length, text: h[2]!.replace(/\s+#+\s*$/, '') })
      i++
      continue
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (line.trim().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) body.push(lines[i++]!)
      i++
      out.push({ t: 'code', text: body.join('\n') })
      continue
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!))
      out.push({ t: 'table', head, rows })
      continue
    }
    const list = line.match(/^\s*([-*+]|\d+[.)])\s+/)
    if (list) {
      const ordered = /\d/.test(list[1]!)
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i]!.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
        if (m) items.push(m[2]!)
        else if (lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length)
          items[items.length - 1] += ` ${lines[i]!.trim()}`
        else break
        i++
      }
      out.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }
    if (line.startsWith('>')) {
      const body: string[] = []
      while (i < lines.length && lines[i]!.startsWith('>')) body.push(lines[i++]!.replace(/^>\s?/, ''))
      out.push({ t: 'quote', text: body.join(' ') })
      continue
    }
    const body: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s|>|\s*\|)/.test(lines[i]!)
    )
      body.push(lines[i++]!.trim())
    if (!body.length) body.push(lines[i++]!.trim())
    out.push({ t: 'p', text: body.join(' ') })
  }
  return out
}

function blocks(src: string): ReactNode {
  return parse(src).map((b, k) => {
    switch (b.t) {
      case 'h': {
        const cls = ['t-title-2 mt-8 mb-3', 't-headline mt-7 mb-2', 't-headline mt-5 mb-1.5'][
          Math.min(b.level, 3) - 1
        ]
        // The kit page's sections are h2: the guide's own headings sit below them.
        return createElement(
          `h${Math.min(6, b.level + 2)}`,
          { key: k, className: cn(cls, 'text-ink first:mt-0') },
          inline(b.text),
        )
      }
      case 'p':
        return (
          <p key={k} className="my-3 t-body text-ink-2">
            {inline(b.text)}
          </p>
        )
      case 'ul':
      case 'ol': {
        const L = b.t === 'ul' ? 'ul' : 'ol'
        return (
          <L
            key={k}
            className={cn(
              'my-3 flex flex-col gap-1.5 pl-5 t-body text-ink-2',
              L === 'ul' ? 'list-disc' : 'list-decimal',
            )}
          >
            {b.items.map((it, j) => (
              <li key={j} className="pl-1 marker:text-ink-4">
                {inline(it)}
              </li>
            ))}
          </L>
        )
      }
      case 'quote':
        return (
          <blockquote key={k} className="my-4 border-line-strong border-l-2 pl-4 t-body text-ink-2 italic">
            {inline(b.text)}
          </blockquote>
        )
      case 'code':
        return (
          <pre key={k} className="my-4 overflow-x-auto rounded-control bg-well p-3 t-meta text-ink-2">
            {b.text}
          </pre>
        )
      case 'hr':
        return <hr key={k} className="my-6 border-line" />
      case 'table':
        return (
          <div key={k} className="my-4 overflow-x-auto rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
            <table className="w-full border-collapse t-callout">
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} className="border-line border-b px-3 py-2 text-left font-[550] text-ink">
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr
                    key={j}
                    className="align-top [&:not(:last-child)>td]:border-line [&:not(:last-child)>td]:border-b"
                  >
                    {r.map((c, n) => (
                      <td key={n} className="px-3 py-2 text-ink-2">
                        {inline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
    return null
  })
}

// Underscores only emphasise whole words, so file names (GEM_Luce.cube) stay as written.
const INLINE =
  /(\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|(?<!\w)_[^_\s][^_]*_(?!\w))/g

function inline(text: string): ReactNode {
  const parts = text.split(INLINE)
  return parts.map((p, k) => {
    if (!p) return null
    const key = `${k}`
    if ((p.startsWith('**') && p.endsWith('**')) || (p.startsWith('__') && p.endsWith('__')))
      return (
        <strong key={key} className="font-[600] text-ink">
          {inline(p.slice(2, -2))}
        </strong>
      )
    if (p.startsWith('`') && p.endsWith('`'))
      return (
        <code key={key} className="rounded-tag bg-well px-1 py-px font-mono text-[0.92em] text-ink">
          {p.slice(1, -1)}
        </code>
      )
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
    if (link) {
      const href = link[2]!
      if (!/^(https?:|mailto:)/i.test(href)) return <Fragment key={key}>{link[1]}</Fragment>
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-ink underline underline-offset-2"
        >
          {link[1]}
        </a>
      )
    }
    if ((p.startsWith('*') && p.endsWith('*')) || (p.startsWith('_') && p.endsWith('_') && p.length > 2))
      return <em key={key}>{inline(p.slice(1, -1))}</em>
    return <Fragment key={key}>{p}</Fragment>
  })
}
