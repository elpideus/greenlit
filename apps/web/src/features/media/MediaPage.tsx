import { useParams } from 'react-router'
import { Viewer } from '@/components/viewer/Viewer'

/** /media/:id — the full-window viewer; a fresh one per item, so stepping to the next starts it clean. */
export default function MediaPage() {
  const { id } = useParams()
  return (
    <div className="h-dvh max-[720px]:h-auto max-[720px]:min-h-dvh">
      <Viewer key={id} mediaId={id!} />
    </div>
  )
}
