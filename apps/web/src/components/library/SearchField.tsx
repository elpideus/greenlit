import { Ban, CornerDownRight, FileType, Folder, Hash, Search, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjects } from '@/data/projects'
import { useTags } from '@/data/tags'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import { Tally, toneFor } from '@/ui'
import { KINDS, parseTokens, STATUSES, serialize, type Token, type TokenKey, wordToToken } from './tokens'

interface Suggestion {
  id: string
  icon: ReactNode
  label: ReactNode
  hint?: ReactNode
  /** Applying replaces the word being typed with this token (or with text when `text` is set). */
  token?: Token
  text?: string
  /** Replaces the word with this and keeps typing (a key like `status:`). */
  insert?: string
  group: string
}

/**
 * The library's search: free words plus tokens (status:, kind:, #tag, project:, -word) that turn into chips inside the
 * field. Suggestions follow the word being typed. `value` is the whole query string (it is what the URL carries).
 */
export function SearchField({
  value,
  onChange,
  showProjects = true,
  className,
  autoFocus,
}: {
  value: string
  onChange: (q: string) => void
  showProjects?: boolean
  className?: string
  autoFocus?: boolean
}) {
  const t = useT('browser')
  const tc = useT()
  const initial = useMemo(() => parseTokens(value), [value])
  const [tokens, setTokens] = useState<Token[]>(initial.tokens)
  const [text, setText] = useState(initial.text)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const { data: tags } = useTags()
  const { data: projects } = useProjects()

  // Outside changes (filter menu, "Clear search") re-sync the chips.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only an outside change of `value` re-parses
  useEffect(() => {
    if (serialize(tokens, text) !== value) {
      const p = parseTokens(value)
      setTokens(p.tokens)
      setText(p.text)
    }
  }, [value])

  const emit = (nextTokens: Token[], nextText: string) => {
    setTokens(nextTokens)
    setText(nextText)
    onChange(serialize(nextTokens, nextText))
  }

  const word = text.match(/(\S*)$/)?.[1] ?? ''
  const head = text.slice(0, text.length - word.length)

  const keyLabel = (k: Token['key']) => t(`keys.${k}`)
  const statusLabel = (s: string) => tc(`status.${s}`)
  const kindLabel = (k: string) => tc(`kind.${k}`)

  // biome-ignore lint/correctness/useExhaustiveDependencies: labels come from t/tc, listed instead
  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = []
    const w = word.toLowerCase()
    const kv = w.match(/^([a-z]+):(.*)$/)
    const has = (tk: Token) =>
      tokens.some((x) => x.key === tk.key && x.value.toLowerCase() === tk.value.toLowerCase())
    const statusItems = (filter: string) =>
      STATUSES.filter((s) => !filter || s.includes(filter) || statusLabel(s).toLowerCase().includes(filter))
        .filter((s) => !has({ key: 'status', value: s }))
        .map((s) => ({
          id: `status:${s}`,
          group: t('suggest.status'),
          icon: <Tally tone={toneFor(s)} size={8} />,
          label: statusLabel(s),
          hint: <span className="t-meta">status:{s}</span>,
          token: { key: 'status' as const, value: s },
        }))
    const kindItems = (filter: string) =>
      KINDS.filter((k) => !filter || k.includes(filter) || kindLabel(k).toLowerCase().includes(filter))
        .filter((k) => !has({ key: 'kind', value: k }))
        .map((k) => ({
          id: `kind:${k}`,
          group: t('suggest.kind'),
          icon: <FileType size={14} className="text-ink-3" />,
          label: kindLabel(k),
          hint: <span className="t-meta">kind:{k}</span>,
          token: { key: 'kind' as const, value: k },
        }))
    const tagItems = (filter: string) =>
      (tags ?? [])
        .filter((tg) => tg.name.toLowerCase().includes(filter) && !has({ key: 'tag', value: tg.name }))
        .sort(
          (a, b) =>
            Number(b.name.toLowerCase().startsWith(filter)) -
              Number(a.name.toLowerCase().startsWith(filter)) || b.count - a.count,
        )
        .slice(0, 6)
        .map((tg) => ({
          id: `tag:${tg.name}`,
          group: t('suggest.tags'),
          icon: <Hash size={14} className="text-ink-3" />,
          label: tg.name,
          hint: <span className="t-meta">{tg.count}</span>,
          token: { key: 'tag' as const, value: tg.name },
        }))
    const projectItems = (filter: string) =>
      !showProjects
        ? []
        : (projects ?? [])
            .filter((p) => p.name.toLowerCase().includes(filter) && !has({ key: 'project', value: p.name }))
            .slice(0, 5)
            .map((p) => ({
              id: `project:${p.id}`,
              group: t('suggest.projects'),
              icon: <Folder size={14} className="text-ink-3" />,
              label: p.name,
              hint: <span className="t-meta">{p.mediaCount}</span>,
              token: { key: 'project' as const, value: p.name },
            }))

    if (kv) {
      const [, key, rest = ''] = kv
      if (key === 'status' || key === 'stato') out.push(...statusItems(rest))
      else if (key === 'kind' || key === 'tipo' || key === 'type') out.push(...kindItems(rest))
      else if (key === 'tag') out.push(...tagItems(rest))
      else if (key === 'project' || key === 'progetto') out.push(...projectItems(rest.replace(/^"/, '')))
      return out
    }
    if (w.startsWith('#')) return tagItems(w.slice(1))
    if (w.startsWith('-') && w.length > 1)
      return [
        {
          id: 'exclude',
          group: t('suggest.filters'),
          icon: <Ban size={14} className="text-ink-3" />,
          label: t('suggest.exclude', { word: word.slice(1) }),
          token: { key: 'exclude', value: word.slice(1) },
        },
      ]
    if (!w) {
      // An empty field: the grammar, as starting points.
      return [
        ...statusItems('').slice(0, 4),
        ...kindItems('').slice(0, 3),
        ...tagItems('').slice(0, 4),
        ...projectItems('').slice(0, 3),
      ]
    }
    out.push({
      id: 'text',
      group: '',
      icon: <Search size={14} className="text-ink-3" />,
      label: t('suggest.searchFor', { text: text.trim() }),
      text: text,
    })
    const keyWords: [string, TokenKey][] = [
      ['status', 'status'],
      ['stato', 'status'],
      ['kind', 'kind'],
      ['tipo', 'kind'],
      ['tag', 'tag'],
      ...(showProjects
        ? ([
            ['project', 'project'],
            ['progetto', 'project'],
          ] as [string, TokenKey][])
        : []),
    ]
    const seen = new Set<TokenKey>()
    for (const [kw, key] of keyWords) {
      if (w.length >= 2 && kw.startsWith(w) && kw !== w && !seen.has(key)) {
        seen.add(key)
        out.push({
          id: `key:${key}`,
          group: t('suggest.filters'),
          icon: <CornerDownRight size={14} className="text-ink-3" />,
          label: <span className="t-meta text-ink">{kw}:</span>,
          hint: t(`suggest.${key === 'tag' ? 'tags' : key === 'project' ? 'projects' : key}`),
          insert: `${kw}:`,
        })
      }
    }
    out.push(...tagItems(w), ...projectItems(w), ...statusItems(w), ...kindItems(w))
    return out
  }, [word, text, tags, projects, tokens, showProjects, t, tc])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new word starts at the first suggestion
  useEffect(() => setActive(0), [word])

  const apply = (s: Suggestion) => {
    if (s.token) emit([...tokens, s.token], head.trimEnd() ? `${head.trimEnd()} ` : '')
    else if (s.insert) emit(tokens, head + s.insert)
    else {
      emit(tokens, s.text ?? text)
      input.current?.blur()
    }
    input.current?.focus()
  }

  const onText = (v: string) => {
    // A finished token followed by a space becomes a chip.
    const m = v.match(/(\S+)\s$/)
    if (m?.[1]) {
      const tk = wordToToken(m[1])
      if (tk) {
        emit([...tokens, tk], v.slice(0, v.length - m[0].length))
        return
      }
    }
    emit(tokens, v)
  }

  const open = focused && suggestions.length > 0
  // The dropdown lives in a portal: the sticky toolbar's material would otherwise clip its backdrop.
  const fieldRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = fieldRef.current?.getBoundingClientRect()
      if (r) setRect({ left: r.left, top: r.bottom + 6, width: r.width })
    }
    place()
    window.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
  }, [open])
  const chipLabel = (tk: Token) => {
    if (tk.key === 'tag') return `#${tk.value}`
    if (tk.key === 'status') return statusLabel(tk.value)
    if (tk.key === 'kind') return kindLabel(tk.value)
    if (tk.key === 'exclude') return `${keyLabel('exclude')} ${tk.value}`
    return tk.value
  }
  const groups = suggestions.reduce<{ group: string; items: (Suggestion & { index: number })[] }[]>(
    (acc, s, i) => {
      const last = acc.at(-1)
      if (last && last.group === s.group) last.items.push({ ...s, index: i })
      else acc.push({ group: s.group, items: [{ ...s, index: i }] })
      return acc
    },
    [],
  )

  return (
    <div className={cn('relative min-w-0', className)}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking the field's padding focuses the input */}
      <div
        ref={fieldRef}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault()
            input.current?.focus()
          }
        }}
        className={cn(
          'flex h-9 min-w-0 cursor-text items-center gap-1 rounded-control bg-well pr-1.5 pl-2.5 transition-[box-shadow,background-color] duration-150',
          focused
            ? 'shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]'
            : 'shadow-[inset_0_0_0_1px_var(--line)] hover-device:hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
        )}
      >
        <Search size={15} strokeWidth={1.9} className="mr-1 shrink-0 text-ink-3" />
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <AnimatePresence initial={false}>
            {tokens.map((tk, i) => (
              <motion.span
                key={`${tk.key}:${tk.value}`}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.16, ease }}
                className={cn(
                  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-tag pr-0.5 pl-1.5 t-caption whitespace-nowrap',
                  tk.key === 'exclude'
                    ? 'bg-cut-soft text-cut'
                    : 'bg-raised text-ink shadow-[inset_0_0_0_.5px_var(--line-strong)]',
                )}
              >
                {tk.key === 'status' && <Tally tone={toneFor(tk.value)} size={7} />}
                {tk.key !== 'tag' && tk.key !== 'status' && tk.key !== 'exclude' && (
                  <span className="text-ink-3">{keyLabel(tk.key)}</span>
                )}
                <span className="max-w-[160px] truncate">{chipLabel(tk)}</span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={tc('remove')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    emit(
                      tokens.filter((_, j) => j !== i),
                      text,
                    )
                  }
                  className="press grid size-[18px] place-items-center rounded-[3px] text-ink-3 hover:bg-press hover:text-ink"
                >
                  <X size={11} strokeWidth={2.2} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          <input
            ref={input}
            value={text}
            autoFocus={autoFocus}
            onChange={(e) => onText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={tokens.length ? '' : t('search')}
            spellCheck={false}
            className="h-full min-w-[80px] flex-1 bg-transparent t-callout text-ink outline-none placeholder:text-ink-3"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && open) {
                e.preventDefault()
                setActive((a) => (a + 1) % suggestions.length)
              } else if (e.key === 'ArrowUp' && open) {
                e.preventDefault()
                setActive((a) => (a - 1 + suggestions.length) % suggestions.length)
              } else if (
                (e.key === 'Enter' || e.key === 'Tab') &&
                open &&
                suggestions[active] &&
                (word || e.key === 'Tab')
              ) {
                e.preventDefault()
                apply(suggestions[active]!)
              } else if (e.key === 'Enter') {
                const tk = word ? wordToToken(word) : null
                if (tk) emit([...tokens, tk], head)
                input.current?.blur()
              } else if (e.key === 'Backspace' && !text && tokens.length) {
                e.preventDefault()
                emit(tokens.slice(0, -1), '')
              } else if (e.key === 'Escape') {
                if (text || tokens.length) emit([], '')
                else input.current?.blur()
              }
            }}
          />
        </div>
        {(text || tokens.length > 0) && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => emit([], '')}
            aria-label={t('empty.clear')}
            className="press grid size-6 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -2, scale: 0.99, transition: { duration: 0.1 } }}
              transition={{ duration: 0.16, ease }}
              style={{
                transformOrigin: 'top left',
                left: rect.left,
                top: rect.top,
                width: Math.max(rect.width, 300),
              }}
              className="floating fixed z-[60] max-h-[min(60dvh,420px)] overflow-y-auto p-[5px]"
              onMouseDown={(e) => e.preventDefault()}
            >
              {groups.map((g) => (
                <div key={g.group || 'text'}>
                  {g.group && <div className="px-2 pt-2 pb-1 t-micro text-ink-3">{g.group}</div>}
                  {g.items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseEnter={() => setActive(s.index)}
                      onClick={() => apply(s)}
                      className={cn(
                        'flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2 text-left t-callout text-ink',
                        s.index === active && 'bg-hover',
                      )}
                    >
                      <span className="grid w-4 shrink-0 place-items-center">{s.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      {s.hint && <span className="shrink-0 text-ink-3">{s.hint}</span>}
                    </button>
                  ))}
                </div>
              ))}
              {!word && (
                <div className="mt-1 border-t border-line px-2 pt-2 pb-1.5 t-caption text-ink-3">
                  {t('suggest.hint')}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}
