import { Check } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateProject } from '@/data/projects'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Button, Dialog, Field, Input, Textarea, toast } from '@/ui'
import { PROJECT_COLORS } from './colors'

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const t = useT('projects')
  const tc = useT()
  const navigate = useNavigate()
  const create = useCreateProject()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string | null>(null)
  const reset = () => {
    setName('')
    setDescription('')
    setColor(null)
  }
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return
    try {
      const p = await create.mutateAsync({ name: name.trim(), description, color })
      toast.done(t('create.created', { name: p.name }))
      onOpenChange(false)
      reset()
      navigate(`/projects/${p.id}`)
    } catch (err) {
      toast.error(err)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
      title={t('create.title')}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() => void submit()}
            kbd="mod+enter"
          >
            {t('create.create')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={submit}
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
      >
        <Field label={t('create.name')}>
          {(id) => (
            <Input
              id={id}
              size="lg"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.namePlaceholder')}
              maxLength={120}
            />
          )}
        </Field>
        <Field label={t('create.description')}>
          {(id) => (
            <Textarea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('create.descriptionPlaceholder')}
              rows={3}
            />
          )}
        </Field>
        <Field label={t('create.color')}>
          {() => (
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((c) => {
                const on = color === c.value
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => setColor(c.value)}
                    aria-label={t(c.label)}
                    aria-pressed={on}
                    className={cn(
                      'press grid size-7 place-items-center rounded-full transition-shadow duration-150',
                      on
                        ? 'shadow-[0_0_0_2px_var(--raised),0_0_0_4px_var(--ink-2)]'
                        : 'hover:shadow-[0_0_0_2px_var(--raised),0_0_0_4px_var(--line-strong)]',
                    )}
                    style={{
                      background: c.value ?? 'transparent',
                      boxShadow: c.value
                        ? undefined
                        : `${on ? '0 0 0 2px var(--raised), 0 0 0 4px var(--ink-2), ' : ''}inset 0 0 0 1.5px var(--ink-3)`,
                    }}
                  >
                    {on && (
                      <Check size={13} strokeWidth={3} className={c.value ? 'text-black/70' : 'text-ink-2'} />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </Field>
      </form>
    </Dialog>
  )
}
