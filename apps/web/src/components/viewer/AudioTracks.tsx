import type { Media } from '@greenlit/shared'
import { AudioLines, Download, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { keyFor, uploadMedia } from '@/data/media'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useCan } from '@/lib/session'
import { confirm, IconButton, Menu, type MenuEntry, toast } from '@/ui'
import { useViewer } from './store'
import { NameDialog, useMediaRefresh } from './VersionSwitcher'

/** The chosen audio track lives in the URL (`?audio=<key>`), so a link opens with the same sound. */
export function useAudioParam() {
  const [params, setParams] = useSearchParams()
  const value = params.get('audio')
  const set = (key: string | null) => {
    const next = new URLSearchParams(params)
    if (key) next.set('audio', key)
    else next.delete('audio')
    setParams(next, { replace: true })
  }
  return [value, set] as const
}

/**
 * The sound a video plays with: its own, or one of the item's audio tracks (a voice-over in another language, a mix
 * without music...). Tracks are added here and posts can use them in place of the video's sound.
 */
export function AudioTrackMenu({ media }: { media: Media }) {
  const t = useT('viewer')
  const canEdit = useCan('media.edit')
  const canUpload = useCan('media.upload')
  const refresh = useMediaRefresh(media.id)
  const [param, setParam] = useAudioParam()
  const chosen = useViewer((s) => s.audioTrack)
  const track = media.audioTracks.find((a) => a.key === (chosen ?? param))
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const pending = useRef<{ key: string; label: string; replace?: boolean } | null>(null)
  if (!media.audioTracks.length && !canUpload) return null

  const pick = (key: string, label: string, replace = false) => {
    pending.current = { key, label, replace }
    file.current?.click()
  }
  const onFile = async (f: File | undefined) => {
    const p = pending.current
    if (!p || !f) return
    toast.info(t('trackUploading', { name: f.name, track: p.label }))
    const ids = await uploadMedia([f], { mediaId: media.id, formatKey: p.key, label: p.label, audio: true })
    refresh()
    if (ids.length && !p.replace) {
      toast.done(t('trackAdded', { track: p.label }))
      setParam(p.key)
    }
  }

  const items: MenuEntry[] = [
    { group: t('sound') },
    { label: t('ownSound'), checked: !track, onSelect: () => setParam(null) },
    ...media.audioTracks.map((a) => ({
      label: (
        <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
          <span className="truncate">{a.label}</span>
          {a.duration ? <span className="t-meta text-ink-4">{formatDuration(a.duration)}</span> : null}
        </span>
      ),
      checked: a.key === track?.key,
      onSelect: () => setParam(a.key),
    })),
    canUpload && 'separator',
    canUpload && { label: t('addTrack'), icon: Plus, onSelect: () => setNaming('new') },
    track && 'separator',
    track && canEdit && { label: t('renameTrack'), icon: Pencil, onSelect: () => setNaming('rename') },
    track &&
      canUpload && {
        label: t('replaceFile'),
        icon: RefreshCw,
        onSelect: () => pick(track.key, track.label, true),
      },
    track && {
      label: t('downloadTrack'),
      icon: Download,
      onSelect: () => window.open(track.urls.download, '_self'),
    },
    track &&
      canEdit && {
        label: t('removeTrack'),
        icon: Trash2,
        danger: true,
        onSelect: async () => {
          if (
            !(await confirm({
              title: t('removeTrackConfirm', { track: track.label }),
              body: t('removeTrackBody'),
              confirm: t('removeTrack'),
              danger: true,
            }))
          )
            return
          try {
            await api.delete(`/media/${media.id}/formats/${track.id}`)
            toast.done(t('trackRemoved', { track: track.label }))
            setParam(null)
            refresh()
          } catch (err) {
            toast.error(err)
          }
        },
      },
  ]

  return (
    <>
      <Menu
        side="top"
        align="end"
        width={260}
        trigger={
          <IconButton
            icon={AudioLines}
            label={track ? t('playingTrack', { track: track.label }) : t('sound')}
            tooltip="top"
            size="sm"
            active={!!track || undefined}
          />
        }
        items={items}
      />
      {track && (
        <span className="hidden max-w-[140px] truncate t-caption text-signal sm:inline">{track.label}</span>
      )}
      <NameDialog
        open={naming !== null}
        onOpenChange={(o) => !o && setNaming(null)}
        title={naming === 'rename' ? t('renameTrack') : t('addTrackTitle')}
        label={t('trackName')}
        placeholder={t('trackNamePlaceholder')}
        initial={naming === 'rename' ? (track?.label ?? '') : ''}
        confirmLabel={naming === 'rename' ? t('common:save') : t('chooseFile')}
        confirmIcon={naming === 'rename' ? undefined : Upload}
        onConfirm={async (name) => {
          const mode = naming
          setNaming(null)
          if (mode === 'rename' && track) {
            try {
              await api.patch(`/media/${media.id}/formats/${track.id}`, { label: name })
              refresh()
            } catch (err) {
              toast.error(err)
            }
          } else
            pick(
              keyFor(
                name,
                media.audioTracks.map((a) => a.key),
                'track',
              ),
              name,
            )
        }}
      />
      <input
        ref={file}
        type="file"
        hidden
        accept="audio/*,video/*"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          void onFile(f)
        }}
      />
    </>
  )
}
