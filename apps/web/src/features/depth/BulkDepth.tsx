import { Sparkles } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { useCan } from '@/lib/session'
import { Button } from '@/ui'
import { generateDepthMany } from './generate'

/** In the library's bulk bar: make depth maps for the selected pictures and videos. */
export function BulkDepth({ ids }: { ids: string[] }) {
  const t = useT('depth')
  if (!useCan('media.upload')) return null
  return (
    <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => void generateDepthMany(ids, t)}>
      {t('gen.bulk')}
    </Button>
  )
}
