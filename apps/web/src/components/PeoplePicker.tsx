import { Check, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { type DirectoryEntry, useDirectory } from '@/data/people'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { Avatar, AvatarStack, Popover, SearchInput } from '@/ui'

/** Pick one or more people (review recipients, share-link owners, "hidden from"). */
export function PeoplePicker({
  value,
  onChange,
  role,
  multiple = true,
  placeholder = 'Choose people',
  excludeSelf = true,
  className,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  role?: 'admin' | 'reviewer'
  multiple?: boolean
  placeholder?: string
  excludeSelf?: boolean
  className?: string
}) {
  const t = useT()
  const me = useSession()
  const { data } = useDirectory()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const people = (data ?? []).filter((p) => (!role || p.role === role) && (!excludeSelf || p.id !== me.id))
  const shown = people.filter((p) => p.displayName.toLowerCase().includes(q.toLowerCase()))
  const chosen = people.filter((p) => value.includes(p.id))
  const toggle = (p: DirectoryEntry) => {
    if (!multiple) {
      onChange([p.id])
      setOpen(false)
      return
    }
    onChange(value.includes(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      width={300}
      trigger={
        <button
          type="button"
          className={cn(
            'press flex h-9 w-full min-w-0 items-center gap-2 rounded-control bg-well px-2.5 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
            className,
          )}
        >
          {chosen.length ? (
            <>
              <AvatarStack users={chosen} size={20} />
              <span className="min-w-0 flex-1 truncate t-callout text-ink">{chosen.map((c) => c.displayName).join(', ')}</span>
            </>
          ) : (
            <span className="flex-1 t-callout text-ink-3">{placeholder}</span>
          )}
          <ChevronsUpDown size={13} className="shrink-0 text-ink-3" />
        </button>
      }
    >
      <div className="p-2">
        {people.length > 6 && <SearchInput value={q} onChange={setQ} size="sm" autoFocus className="mb-1.5" />}
        <div className="max-h-72 overflow-y-auto">
          {shown.map((p) => {
            const on = value.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p)}
                className="press flex h-10 w-full items-center gap-2.5 rounded-[8px] px-2 text-left hover:bg-hover"
              >
                <Avatar user={p} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate t-callout text-ink">{p.displayName}</span>
                </span>
                <span className="t-caption text-ink-3">{t(`role.${p.role}`)}</span>
                <span className="grid w-4 place-items-center">{on && <Check size={14} strokeWidth={2.4} className="text-signal" />}</span>
              </button>
            )
          })}
          {!shown.length && <div className="px-2 py-6 text-center t-callout text-ink-3">No one matches</div>}
        </div>
      </div>
    </Popover>
  )
}
