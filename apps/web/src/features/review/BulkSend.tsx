import { Send } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { useCan } from '@/lib/session'
import { Button } from '@/ui'
import { openSendForReview } from './store'

/** "Send for review" in the library's bulk bar. */
export function BulkSend({ ids }: { ids: string[] }) {
  const t = useT('review')
  if (!useCan('reviews.send')) return null
  return (
    <Button size="sm" variant="ghost" icon={Send} onClick={() => openSendForReview(ids)}>
      {t('bulk')}
    </Button>
  )
}
