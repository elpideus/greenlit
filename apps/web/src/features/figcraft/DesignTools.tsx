import type { Media, MediaFormat } from '@greenlit/shared'
import { Eye, PenTool, Save } from 'lucide-react'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { useCan } from '@/lib/session'
import { Button, Segmented, Tally } from '@/ui'
import { useDesign } from './store'

/**
 * The viewer's top bar for a design: View (the canvas alone) or Edit (FigCraft's panels and tools), and Save while
 * there are changes. Saving stores a new file version; History keeps every earlier one.
 */
export function DesignTools(_: { media: Media; format: MediaFormat }) {
  const t = useT('figcraft')
  const canEdit = useCan('media.upload')
  const mode = useDesign((s) => s.mode)
  const phase = useDesign((s) => s.phase)
  const dirty = useDesign((s) => s.dirty)
  const saving = useDesign((s) => s.saving)
  const set = useDesign((s) => s.set)
  const live = phase === 'ready'
  const save = () => void useDesign.getState().host?.save()
  useHotkey('mod+s', save, { enabled: live && canEdit, allowInInputs: true })
  useHotkey('e', () => set({ mode: mode === 'view' ? 'edit' : 'view' }), { enabled: live && canEdit })

  if (!live) return null
  return (
    <div className="mr-1.5 flex items-center gap-2">
      {(dirty || saving) && canEdit && (
        <Button size="sm" variant="primary" icon={Save} loading={saving} kbd="mod+s" onClick={save}>
          {t('save')}
        </Button>
      )}
      {dirty && !canEdit && (
        <span className="flex items-center gap-1.5 t-caption text-white/55">
          <Tally tone="review" size={7} />
          {t('notSaved')}
        </span>
      )}
      {canEdit && (
        <Segmented
          size="sm"
          value={mode}
          onChange={(m) => set({ mode: m })}
          options={[
            { value: 'view', icon: Eye, label: t('view'), title: t('viewHint') },
            { value: 'edit', icon: PenTool, label: t('edit'), title: t('editHint') },
          ]}
        />
      )}
    </div>
  )
}
