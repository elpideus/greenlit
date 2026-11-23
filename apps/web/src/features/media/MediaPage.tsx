import { useParams } from 'react-router'
import { Viewer } from '@/components/viewer/Viewer'

/** /media/:id — the full-window viewer. */
export default function MediaPage() {
  const { id } = useParams()
  return (
    <div className="h-dvh max-[720px]:h-auto max-[720px]:min-h-dvh">
      <Viewer mediaId={id!} />
    </div>
  )
}
