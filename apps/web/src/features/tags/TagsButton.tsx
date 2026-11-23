import { Tags } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useT } from '@/lib/i18n'
import { IconButton } from '@/ui'

/** In the library toolbar: opens the list of every tag. */
export function TagsButton() {
  const t = useT('tags')
  const navigate = useNavigate()
  return <IconButton icon={Tags} label={t('browse')} onClick={() => navigate('/library/tags')} />
}
