import { normalizeTag, type TagCount, tagKey } from '@greenlit/shared'
import { Hash, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { currentLanguage, useT } from '@/lib/i18n'
import { Button, Chip, Dialog, Field, Input } from '@/ui'

/**
 * Merge tags into one: type the tag to keep (an existing one or a new name) or pick one of the merged tags.
 * Every item carrying any of them carries that tag instead.
 */
export function MergeDialog({
  from,
  all,
  open,
  onOpenChange,
  onMerge,
}: {
  from: TagCount[]
  all: TagCount[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onMerge: (to: string) => void
}) {
  const t = useT('tags')
  const tc = useT()
  const many = from.length > 1
  const sources = useMemo(() => new Set(from.map((f) => tagKey(f.name))), [from])
  // With several tags the most used one is the natural pick; one tag merges into another, so start empty.
  const [draft, setDraft] = useState(() =>
    many ? from.slice().sort((a, b) => b.count - a.count)[0]!.name : '',
  )
  const name = normalizeTag(draft).toLowerCase()
  const key = tagKey(name)
  const existing = all.find((tg) => tagKey(tg.name) === key)
  const suggestions = useMemo(() => {
    // The merged tags themselves are the chips above (or the tag being merged), so they are not offered again.
    const list = all.filter((tg) => !sources.has(tagKey(tg.name)) && tagKey(tg.name) !== key)
    const q = key
    return list
      .filter((tg) => !q || tagKey(tg.name).includes(q))
      .sort(
        (a, b) =>
          Number(tagKey(b.name).startsWith(q)) - Number(tagKey(a.name).startsWith(q)) || b.count - a.count,
      )
      .slice(0, 6)
  }, [all, sources, key])
  const list = new Intl.ListFormat(currentLanguage(), { type: 'disjunction' }).format(
    from.map((f) => `#${f.name}`),
  )
  const valid = !!name && (many || !sources.has(key))
  const submit = () => valid && onMerge(existing?.name ?? name)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        many ? t('dialog.titleMany', { count: from.length }) : t('dialog.titleOne', { name: from[0]!.name })
      }
      description={t('dialog.description', { tags: list })}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {t('dialog.submit')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t('dialog.keep')}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('dialog.placeholder')}
              leading={<Hash size={13} strokeWidth={2} />}
              maxLength={60}
            />
          )}
        </Field>
        {many && (
          <div>
            <div className="mb-2 t-caption text-ink-3">{t('dialog.pick')}</div>
            <div className="flex flex-wrap gap-1.5">
              {from.map((f) => (
                <Chip key={f.name} active={tagKey(f.name) === key} onClick={() => setDraft(f.name)}>
                  #{f.name} <span className="ml-1 t-meta opacity-70">{f.count}</span>
                </Chip>
              ))}
            </div>
          </div>
        )}
        {name && !existing && (
          <div className="-mt-1 flex items-center gap-2 t-caption text-ink-3">
            <Plus size={12} strokeWidth={2} className="shrink-0" />
            <span className="truncate">{t('dialog.new', { name })}</span>
          </div>
        )}
        {suggestions.length > 0 && (
          <div>
            <div className="mb-1.5 t-caption text-ink-3">{t('dialog.existing')}</div>
            <div className="-mx-2 flex flex-col">
              {suggestions.map((tg) => (
                <button
                  key={tg.name}
                  type="button"
                  onClick={() => setDraft(tg.name)}
                  className={cn(
                    'press flex h-8 items-center gap-2 rounded-control px-2 text-left t-callout text-ink-2',
                    'hover-device:hover:bg-hover hover-device:hover:text-ink',
                  )}
                >
                  <span className="text-ink-4">#</span>
                  <span className="min-w-0 flex-1 truncate">{tg.name}</span>
                  <span className="t-meta text-ink-3 tabular">{tg.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </Dialog>
  )
}
