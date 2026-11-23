import type { Media } from '@greenlit/shared'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { create } from 'zustand'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Button, Dialog, Field, Input, Segmented, toast } from '@/ui'
import { compositionApi, type FormatPreset, PRESETS, useCompositionActions } from './api'
import { mediaClipOps } from './edits'

interface NewEditRequest {
  projectId: string | null
  media: Media[]
  name?: string
}

const useNewEdit = create<{ req: NewEditRequest | null; set: (r: NewEditRequest | null) => void }>((set) => ({
  req: null,
  set: (req) => set({ req }),
}))

/** Opens the "New edit" dialog (from a project, a ⌘K command or media selected in the library). */
export function openNewEdit(req: Partial<NewEditRequest> = {}) {
  useNewEdit.getState().set({ projectId: req.projectId ?? null, media: req.media ?? [], name: req.name })
}

/** Mounted once (feature `globals`). */
export function NewEditHost() {
  const t = useT('editor')
  const navigate = useNavigate()
  const { req, set } = useNewEdit()
  const { create: createEdit } = useCompositionActions()
  const [name, setName] = useState('')
  const [formats, setFormats] = useState<FormatPreset[]>(['landscape'])
  const [fps, setFps] = useState('30')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!req) return
    setName(req.name ?? (req.media.length === 1 ? (req.media[0]!.title ?? '') : ''))
    const first = req.media[0]?.formats.find((f) => f.isPrimary) ?? req.media[0]?.formats[0]
    setFormats(first?.width && first.height && first.height > first.width ? ['vertical'] : ['landscape'])
    setFps(
      first?.fps && [24, 25, 30, 50, 60].includes(Math.round(first.fps))
        ? String(Math.round(first.fps))
        : '30',
    )
  }, [req])

  const toggle = (id: FormatPreset) =>
    setFormats((f) => (f.includes(id) ? (f.length > 1 ? f.filter((x) => x !== id) : f) : [...f, id]))

  const submit = async () => {
    if (!req) return
    setBusy(true)
    try {
      const view = await createEdit.mutateAsync({
        projectId: req.projectId,
        name: name.trim() || t('create.namePlaceholder'),
        formats,
        fps: Number(fps),
      })
      if (req.media.length) {
        const assets = await compositionApi.assets(
          view.id,
          req.media
            .filter((m) => ['video', 'image', 'audio'].includes(m.kind))
            .map((m) => ({ mediaId: m.id })),
        )
        const { ops } = mediaClipOps(view.document, assets, 0)
        const end = ops.reduce(
          (e, o) =>
            o.op === 'add_clip' ? Math.max(e, (o.clip.start as number) + (o.clip.duration as number)) : e,
          0,
        )
        if (end > 0) ops.push({ op: 'set', key: 'duration', value: Math.max(1, end) })
        if (ops.length) await compositionApi.apply(view.id, ops, view.revision, 'new-edit')
      }
      set(null)
      navigate(`/edit/${view.id}`)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && set(null)}
      title={t('create.title')}
      description={t('create.body')}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => set(null)}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} kbd="mod+enter">
            {t('create.create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
      >
        <Field label={t('create.name')}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.namePlaceholder')}
              autoFocus
              size="lg"
            />
          )}
        </Field>
        <div>
          <div className="mb-2 t-label">{t('create.formats')}</div>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => {
              const on = formats.includes(p.id)
              const order = formats.indexOf(p.id)
              const r = p.format.width / p.format.height
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={cn(
                    'press relative flex flex-col items-center gap-2.5 rounded-[12px] px-2 pt-4 pb-3 transition-[background-color,box-shadow] duration-150',
                    on
                      ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--signal)]'
                      : 'bg-well shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]',
                  )}
                >
                  <span className="grid h-12 place-items-center">
                    <span
                      className={cn(
                        'rounded-[4px] transition-colors',
                        on
                          ? 'bg-signal/25 shadow-[inset_0_0_0_1.5px_var(--signal)]'
                          : 'shadow-[inset_0_0_0_1.5px_var(--ink-3)]',
                      )}
                      style={{ width: r >= 1 ? 44 : 44 * r, height: r >= 1 ? 44 / r : 44 }}
                    />
                  </span>
                  <span className={cn('t-caption font-[550]', on ? 'text-ink' : 'text-ink-2')}>
                    {t(`create.${p.id}`)}
                  </span>
                  <span className="t-meta text-ink-4">{p.format.name}</span>
                  {on && (
                    <span className="absolute top-2 right-2 grid size-4 place-items-center rounded-full bg-signal text-signal-ink">
                      {order === 0 && formats.length > 1 ? (
                        <span className="t-micro text-[9px]">1</span>
                      ) : (
                        <Check size={10} strokeWidth={3} />
                      )}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <Field label={t('create.fps')}>
          {() => (
            <Segmented
              value={fps}
              onChange={setFps}
              options={['24', '25', '30', '60'].map((v) => ({ value: v, label: `${v} fps` }))}
            />
          )}
        </Field>
        {req && req.media.length > 0 && (
          <p className="t-caption text-ink-3">{t('create.withMedia', { count: req.media.length })}</p>
        )}
      </form>
    </Dialog>
  )
}
