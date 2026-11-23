import { type DesignFont, formatBytes } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2, Type } from 'lucide-react'
import { SettingsGroup, SettingsSection } from '@/components/SettingsSection'
import { useT } from '@/lib/i18n'
import { confirm, EmptyState, IconButton, Skeleton, toast } from '@/ui'
import { deleteFont, designKeys, useDesignFonts, useFigcraftStatus } from './api'
import { FontUploadButton } from './FontUploadButton'

/** Settings → Design fonts: the font files FigCraft designs use beyond the ones FigCraft has built in. */
export default function FontsSection() {
  const t = useT('figcraft')
  const qc = useQueryClient()
  const fonts = useDesignFonts()
  const status = useFigcraftStatus()
  const families = new Map<string, DesignFont[]>()
  for (const f of fonts.data ?? []) families.set(f.family, [...(families.get(f.family) ?? []), f])

  const remove = async (f: DesignFont) => {
    const ok = await confirm({
      title: t('fonts.removeTitle', { name: `${f.family} ${f.style}` }),
      body: t('fonts.removeBody'),
      confirm: t('fonts.remove'),
      danger: true,
    })
    if (!ok) return
    try {
      await deleteFont(f.id)
      void qc.invalidateQueries({ queryKey: designKeys.fonts })
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <SettingsSection
      title={t('fonts.title')}
      description={t(status.data?.renderer ? 'fonts.descriptionRenderer' : 'fonts.description')}
      actions={<FontUploadButton variant="primary" />}
    >
      {fonts.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : families.size === 0 ? (
        <EmptyState icon={Type} title={t('fonts.emptyTitle')} body={t('fonts.emptyBody')} />
      ) : (
        [...families].map(([family, faces]) => (
          <SettingsGroup key={family} title={family}>
            {faces.map((f) => (
              <div key={f.id} className="flex items-center gap-3 py-2.5">
                <span className="w-40 shrink-0 t-callout text-ink">{f.style}</span>
                <span className="min-w-0 flex-1 truncate t-caption text-ink-3">{f.filename}</span>
                <span className="t-meta text-ink-3">{formatBytes(f.size)}</span>
                {f.source ? (
                  // A brand kit's font: it comes and goes with the kit's files.
                  <span className="w-28 shrink-0 truncate text-right t-caption text-ink-3" title={f.source}>
                    {t('fonts.fromKit', { name: f.source })}
                  </span>
                ) : (
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    label={t('fonts.remove')}
                    onClick={() => void remove(f)}
                  />
                )}
              </div>
            ))}
          </SettingsGroup>
        ))
      )}
    </SettingsSection>
  )
}
