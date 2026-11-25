import {
  normalizeWebUrl,
  type WebLink,
  type WebLinkPreview,
  webLinkAddress,
  webLinkLabel,
  webLinkPlatform,
} from '@greenlit/shared'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  ExternalLink,
  Globe,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { PlatformIcon } from '@/components/PlatformIcon'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  type MenuEntry,
  openContextMenu,
  Spinner,
  toast,
  useContextMenu,
} from '@/ui'
import './locales'

/**
 * Web links of a project or a media item: addresses kept with it (the listing on the website, where it's published,
 * a Drive folder...). `list` = rows with the address under the title (the media Info panel); `chips` = one line of
 * small links (a project's header). Every link opens in a new tab; right-click or ⋯ = open, copy, edit, move, remove.
 * `onChange` gets the whole new list (the server keeps it in that order).
 */
export function WebLinks({
  links,
  onChange,
  editable,
  variant = 'list',
  className,
}: {
  links: WebLink[]
  onChange: (links: WebLink[]) => void
  editable: boolean
  variant?: 'list' | 'chips'
  className?: string
}) {
  const t = useT('webLinks')
  // null = closed; -1 = adding; else the index being edited.
  const [editing, setEditing] = useState<number | null>(null)

  const menu = (i: number): MenuEntry[] => {
    const l = links[i]!
    const move = (to: number) => {
      const next = [...links]
      const [x] = next.splice(i, 1)
      next.splice(to, 0, x!)
      onChange(next)
    }
    const across = variant === 'chips'
    return [
      {
        label: t('open'),
        icon: ExternalLink,
        onSelect: () => window.open(l.url, '_blank', 'noopener,noreferrer'),
      },
      {
        label: t('copy'),
        icon: Copy,
        onSelect: () =>
          void navigator.clipboard.writeText(l.url).then(
            () => toast.done(t('copied')),
            (e) => toast.error(e),
          ),
      },
      editable && 'separator',
      editable && { label: t('edit'), icon: Pencil, onSelect: () => setEditing(i) },
      editable &&
        i > 0 && {
          label: t(across ? 'moveLeft' : 'moveUp'),
          icon: across ? ArrowLeft : ArrowUp,
          onSelect: () => move(i - 1),
        },
      editable &&
        i < links.length - 1 && {
          label: t(across ? 'moveRight' : 'moveDown'),
          icon: across ? ArrowRight : ArrowDown,
          onSelect: () => move(i + 1),
        },
      editable && 'separator',
      editable && {
        label: t('remove'),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          onChange(links.filter((_, j) => j !== i))
          toast.done(t('removed', { name: webLinkLabel(l) }), {
            action: { label: t('undo'), onClick: () => onChange(links) },
          })
        },
      },
    ]
  }

  const save = (link: WebLink) => {
    if (editing === null) return
    onChange(editing === -1 ? [...links, link] : links.map((l, j) => (j === editing ? link : l)))
    setEditing(null)
  }

  const dialog = (
    <WebLinkDialog
      open={editing !== null}
      onOpenChange={(o) => !o && setEditing(null)}
      initial={editing !== null && editing >= 0 ? links[editing] : undefined}
      taken={links.filter((_, j) => j !== editing).map((l) => l.url)}
      onSave={save}
    />
  )

  if (variant === 'chips') {
    if (!links.length && !editable) return null
    return (
      <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
        {links.map((l, i) => (
          <LinkChip key={l.url} link={l} menu={() => menu(i)} />
        ))}
        {editable && (
          <button
            type="button"
            onClick={() => setEditing(-1)}
            className="press inline-flex h-7 items-center gap-1 rounded-control px-2 t-callout text-ink-3 hover-device:hover:bg-hover hover-device:hover:text-ink"
          >
            <Plus size={14} strokeWidth={1.9} />
            {links.length ? t('add') : t('addFirst')}
          </button>
        )}
        {dialog}
      </div>
    )
  }

  return (
    <div className={className}>
      {links.length > 0 && (
        <div className="-mx-1.5 flex flex-col">
          {links.map((l, i) => (
            <LinkRow key={l.url} link={l} menu={() => menu(i)} />
          ))}
        </div>
      )}
      {editable ? (
        <Button size="sm" variant="ghost" icon={Plus} className="-ml-2.5" onClick={() => setEditing(-1)}>
          {links.length ? t('add') : t('addFirst')}
        </Button>
      ) : (
        !links.length && <div className="t-callout text-ink-4">—</div>
      )}
      {dialog}
    </div>
  )
}

/** The site's mark: the platform's glyph for YouTube, Instagram, Facebook and TikTok, a globe for anything else. */
export function WebLinkIcon({
  url,
  size = 14,
  className,
}: {
  url: string
  size?: number
  className?: string
}) {
  const platform = webLinkPlatform(url)
  return platform ? (
    <PlatformIcon platform={platform} size={size} className={cn('shrink-0', className)} />
  ) : (
    <Globe size={size} strokeWidth={1.8} className={cn('shrink-0 text-ink-3', className)} />
  )
}

function LinkRow({ link, menu }: { link: WebLink; menu: () => MenuEntry[] }) {
  const t = useT('webLinks')
  const ctx = useContextMenu(menu)
  const label = webLinkLabel(link)
  const address = webLinkAddress(link.url)
  return (
    <div className="group relative flex items-center rounded-control hover-device:hover:bg-hover" {...ctx}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={link.url}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-signal rounded-control"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-control bg-well shadow-[inset_0_0_0_1px_var(--line)]">
          <WebLinkIcon url={link.url} size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate t-callout text-ink">{label}</span>
          {label !== address && <span className="block truncate t-caption text-ink-3">{address}</span>}
        </span>
      </a>
      <IconButton
        icon={MoreHorizontal}
        label={t('more')}
        size="sm"
        tooltip={false}
        className="mr-0.5 hover-device:opacity-0 hover-device:group-hover:opacity-100 hover-device:group-focus-within:opacity-100"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          openContextMenu(r.right - 200, r.bottom + 4, menu())
        }}
      />
    </div>
  )
}

function LinkChip({ link, menu }: { link: WebLink; menu: () => MenuEntry[] }) {
  const ctx = useContextMenu(menu)
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.url}
      {...ctx}
      className="press inline-flex h-7 max-w-[300px] items-center gap-1.5 rounded-control bg-hover px-2 t-callout text-ink-2 shadow-[inset_0_0_0_.5px_var(--line)] outline-none hover-device:hover:text-ink focus-visible:ring-2 focus-visible:ring-signal"
    >
      <WebLinkIcon url={link.url} size={13} />
      <span className="truncate">{webLinkLabel(link)}</span>
    </a>
  )
}

/**
 * Add or change a link. Pasting an address reads the page's title into the Title field (unless one was typed), so
 * most links need only the paste.
 */
export function WebLinkDialog({
  open,
  onOpenChange,
  initial,
  taken,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial?: WebLink
  /** Addresses already in the list (a link can't be added twice). */
  taken: string[]
  onSave: (link: WebLink) => void
}) {
  const t = useT('webLinks')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A title someone typed is theirs; one read from the page is replaced when the address changes.
  const typed = useRef(false)
  const asked = useRef('')

  useEffect(() => {
    if (!open) return
    setUrl(initial?.url ?? '')
    setTitle(initial?.title ?? '')
    setReading(false)
    setError(null)
    typed.current = !!initial?.title
    asked.current = initial?.url ?? ''
  }, [open, initial])

  // Read the page's title once the address looks right and settles.
  const normalized = normalizeWebUrl(url)
  useEffect(() => {
    if (!open || !normalized || normalized === asked.current) return
    const timer = setTimeout(() => {
      if (typed.current) return
      asked.current = normalized
      setReading(true)
      api
        .post<WebLinkPreview>('/web-links/preview', { url: normalized })
        .then((r) => {
          if (asked.current === normalized && !typed.current) setTitle(r.title)
        })
        .catch(() => {})
        .finally(() => asked.current === normalized && setReading(false))
    }, 450)
    return () => clearTimeout(timer)
  }, [open, normalized])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!normalized) return setError(t('invalid'))
    if (taken.includes(normalized)) return setError(t('duplicate'))
    onSave({ url: normalized, title: title.trim() })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? t('editTitle') : t('addTitle')}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" disabled={!url.trim()} onClick={() => submit()}>
            {initial ? t('save') : t('addButton')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label={t('address')} error={error}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="example.it/…"
              value={url}
              invalid={!!error}
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
        <Field
          label={t('name')}
          aside={reading ? t('reading') : undefined}
          hint={!reading && !title && normalized ? t('nameHint') : undefined}
        >
          {(id) => (
            <Input
              id={id}
              placeholder={normalized ? webLinkAddress(normalized) : t('namePlaceholder')}
              value={title}
              trailing={reading ? <Spinner size={14} /> : undefined}
              onChange={(e) => {
                setTitle(e.target.value)
                typed.current = e.target.value.trim() !== ''
              }}
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
