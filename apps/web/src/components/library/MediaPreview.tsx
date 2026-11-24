import type { Media } from '@greenlit/shared'
import { Check, ExternalLink } from 'lucide-react'
import { MediaThumb } from '@/components/MediaThumb'
import { BROWSER_IMAGES } from '@/components/viewer/Stage'
import { primaryFormat } from '@/data/media'
import { useProjects } from '@/data/projects'
import { formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { Button, Dialog } from '@/ui'

/**
 * A quick look at one media item over a picker: the picture, the video or the sound with its controls, a PDF on its
 * pages; Pick from here, or open it in a new tab. Self-contained on purpose: a picker often sits over the viewer, whose
 * shared playback state this must not touch.
 */
export function MediaPreview({
  media,
  onClose,
  picked,
  pickable,
  onTogglePick,
}: {
  media: Media | null
  onClose: () => void
  picked: boolean
  pickable: boolean
  onTogglePick: () => void
}) {
  const t = useT('browser')
  const tc = useT()
  const { data: projects } = useProjects()
  const f = media ? primaryFormat(media) : undefined
  const project = media?.projectId ? projects?.find((p) => p.id === media.projectId) : undefined
  const meta = media
    ? [
        tc(`kind.${media.kind}`),
        f?.width && f.height ? `${f.width}×${f.height}` : null,
        f?.duration ? formatDuration(f.duration) : null,
        project?.name,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  const stage = () => {
    if (!media || !f) return null
    if (f.kind === 'image')
      return (
        <img
          src={BROWSER_IMAGES.includes(f.mime) ? f.urls.original : (f.urls.poster ?? f.urls.thumbnail ?? '')}
          alt={media.title}
          className="max-h-full max-w-full object-contain"
        />
      )
    if (f.kind === 'video')
      return (
        // biome-ignore lint/a11y/useMediaCaption: footage without captions
        <video
          key={f.id}
          src={f.urls.preview ?? f.urls.original}
          poster={f.urls.poster ?? undefined}
          controls
          autoPlay
          playsInline
          className="max-h-full max-w-full"
        />
      )
    if (f.kind === 'audio')
      return (
        <div className="flex w-full max-w-[640px] flex-col items-center gap-5 px-6">
          <MediaThumb media={media} className="aspect-video w-full max-w-[420px]" showDuration={false} />
          {/* biome-ignore lint/a11y/useMediaCaption: music and sound */}
          <audio key={f.id} src={f.urls.preview ?? f.urls.original} controls autoPlay className="w-full" />
        </div>
      )
    if (f.mime === 'application/pdf')
      return (
        <iframe title={media.title} src={`${f.urls.original}#view=FitH`} className="size-full bg-white" />
      )
    return <MediaThumb media={media} fit="contain" className="aspect-video w-full max-w-[860px]" />
  }

  return (
    <Dialog
      open={!!media}
      onOpenChange={(o) => !o && onClose()}
      title={media?.title || tc('untitled')}
      description={meta}
      width={1280}
      className="h-[calc(100dvh-96px)] max-h-none"
      footer={
        <>
          <Button
            variant="ghost"
            icon={ExternalLink}
            className="mr-auto"
            onClick={() => media && window.open(`/media/${media.id}`, '_blank', 'noopener')}
          >
            {t('picker.newTab')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
          {pickable && (
            <Button
              variant={picked ? 'secondary' : 'primary'}
              icon={picked ? Check : undefined}
              onClick={onTogglePick}
            >
              {picked ? t('picker.picked') : t('picker.pick')}
            </Button>
          )}
        </>
      }
    >
      <div className="force-dark grid h-full min-h-[240px] place-items-center overflow-hidden rounded-panel bg-stage">
        {stage()}
      </div>
    </Dialog>
  )
}
