import type { DesignFont } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useT } from '@/lib/i18n'
import { upload } from '@/lib/uploads'
import { Button, type ButtonProps, toast } from '@/ui'
import { designKeys } from './api'

export const FONT_ACCEPT = '.ttf,.otf,.ttc,.otc,font/ttf,font/otf,font/collection'

/** Picks font files and adds them to Greenlit's design fonts. */
export function FontUploadButton({
  size = 'sm',
  variant,
  onAdded,
}: {
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  onAdded?: (fonts: DesignFont[]) => void
}) {
  const t = useT('figcraft')
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const add = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    const results = await Promise.allSettled(
      files.map(
        (file) => upload(file, { purpose: 'figcraft.font', label: file.name }) as Promise<DesignFont>,
      ),
    )
    setBusy(false)
    const added = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
    void qc.invalidateQueries({ queryKey: designKeys.fonts })
    if (added.length) {
      const families = [...new Set(added.map((f) => f.family))].join(', ')
      toast.done(t('fontsAdded', { count: added.length, families }))
      onAdded?.(added)
    }
    if (failed.length) toast.error(failed[0], t('fontsFailed', { count: failed.length }))
  }
  return (
    <>
      <Button size={size} variant={variant} icon={Plus} loading={busy} onClick={() => input.current?.click()}>
        {t('addFonts')}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={FONT_ACCEPT}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void add(files)
        }}
      />
    </>
  )
}
