import { normalizeTag, tagKey } from '@greenlit/shared'
import { Hash } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTags } from '@/data/tags'
import { cn } from '@/lib/cn'
import { Chip } from '@/ui'

/**
 * Tags as chips with an input that suggests tags already in use (most used first). Enter, comma or Tab adds;
 * Backspace on an empty input removes the last one. Tags stay lower-case English, one concept each.
 */
export function TagEditor({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [focus, setFocus] = useState(false)
  const [hi, setHi] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const { data: all } = useTags()
  const have = new Set(value.map(tagKey))
  const suggestions = useMemo(() => {
    const q = tagKey(draft)
    return (all ?? [])
      .filter((t) => !have.has(tagKey(t.name)) && (!q || tagKey(t.name).includes(q)))
      .sort(
        (a, b) =>
          (tagKey(a.name).startsWith(q) ? -1 : 0) - (tagKey(b.name).startsWith(q) ? -1 : 0) ||
          b.count - a.count,
      )
      .slice(0, 6)
  }, [all, draft, value])

  const add = (raw: string) => {
    const tag = normalizeTag(raw).toLowerCase()
    if (!tag || have.has(tagKey(tag))) return setDraft('')
    onChange([...value, tag])
    setDraft('')
    setHi(0)
  }

  return (
    <div className="relative">
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-control bg-well px-1.5 py-1.5 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow duration-150',
          focus && 'shadow-[inset_0_0_0_1px_var(--signal),0_0_0_3px_var(--signal-soft)]',
        )}
        onClick={() => input.current?.focus()}
        onKeyDown={undefined}
        role="presentation"
      >
        {value.map((t) => (
          <Chip
            key={t}
            icon={Hash}
            onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== t))}
          >
            {t}
          </Chip>
        ))}
        {!disabled && (
          <input
            ref={input}
            value={draft}
            onChange={(e) => {
              const v = e.target.value
              if (v.endsWith(',')) add(v.slice(0, -1))
              else setDraft(v)
            }}
            onFocus={() => setFocus(true)}
            onBlur={() => {
              setFocus(false)
              if (draft.trim()) add(draft)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || (e.key === 'Tab' && draft)) {
                e.preventDefault()
                add(suggestions[hi] && draft ? suggestions[hi]!.name : draft)
              } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
              else if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, suggestions.length - 1))
              else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0))
            }}
            placeholder={value.length ? '' : placeholder}
            className="h-6 min-w-[80px] flex-1 bg-transparent px-1 t-callout text-ink outline-none placeholder:text-ink-3"
          />
        )}
      </div>
      {focus && draft && suggestions.length > 0 && (
        <div className="floating absolute inset-x-0 top-full z-20 mt-1.5 p-1">
          {suggestions.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                add(s.name)
              }}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left t-callout text-ink',
                i === hi && 'bg-hover',
              )}
            >
              <Hash size={13} className="text-ink-3" />
              <span className="flex-1">{s.name}</span>
              <span className="t-meta text-ink-3">{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
