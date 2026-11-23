import { aspectLabel, type Media, type MediaFormat, type MediaStatus } from '@greenlit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Slot } from '@/app/Slot'
import { PeoplePicker } from '@/components/PeoplePicker'
import { useUpdateMedia } from '@/data/media'
import { useProjects } from '@/data/projects'
import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { qk } from '@/lib/query'
import { useCan, useIsAdmin } from '@/lib/session'
import { formatDateTime, formatRelative, useTimeZone, zonedParts, zonedToInstant } from '@/lib/time'
import { Avatar, Badge, Button, Input, Select, Tally, Textarea, toast, toneFor } from '@/ui'
import { TagEditor } from './TagEditor'

interface FileVersion {
  id: string
  formatId: string
  blobId: string
  fileRevision: number
  filename: string
  size: number
  note: string | null
  createdBy: { id: string; displayName: string; avatarUrl: string | null } | null
  createdAt: string
  url: string
}

function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <span className="t-label">{children}</span>
      {aside && <span className="t-caption text-ink-3">{aside}</span>}
    </div>
  )
}

/** The Info tab: everything about the item, saved as you go (each change is a version in History). */
export function InfoPanel({ media, format }: { media: Media; format: MediaFormat }) {
  const t = useT('media')
  const tz = useTimeZone()
  const qc = useQueryClient()
  const update = useUpdateMedia(media.id)
  const canEdit = useCan('media.edit')
  const canStatus = useCan('media.status')
  const admin = useIsAdmin()
  const { data: projects } = useProjects()
  const [title, setTitle] = useState(media.title)
  const [description, setDescription] = useState(media.description)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setTitle(media.title), [media.title])
  useEffect(() => {
    if (document.activeElement?.id !== 'media-description') setDescription(media.description)
  }, [media.description])

  const save = (patch: Parameters<typeof update.mutate>[0]) => {
    setSaved('saving')
    update.mutate(patch, {
      onSuccess: () => {
        setSaved('saved')
        setTimeout(() => setSaved('idle'), 1600)
      },
      onError: (e) => {
        setSaved('idle')
        toast.error(e)
      },
    })
  }

  const files = useQuery({
    queryKey: qk.mediaFiles(media.id),
    queryFn: () => api.get<FileVersion[]>(`/media/${media.id}/files`),
  })
  const versions = (files.data ?? [])
    .filter((f) => f.formatId === format.id)
    .sort((a, b) => b.fileRevision - a.fileRevision)

  const taken = media.takenAt ? zonedParts(media.takenAt, tz) : null
  const takenValue = taken
    ? `${taken.year}-${String(taken.month + 1).padStart(2, '0')}-${String(taken.day).padStart(2, '0')}T${String(taken.hour).padStart(2, '0')}:${String(taken.minute).padStart(2, '0')}`
    : ''

  const statuses: MediaStatus[] = ['draft', 'in_review', 'changes_requested', 'approved']

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-10">
      <div className="flex flex-col gap-5">
        <div>
          <Label
            aside={saved === 'saving' ? t('info.saving') : saved === 'saved' ? t('info.saved') : undefined}
          >
            {t('info.title')}
          </Label>
          <Input
            value={title}
            disabled={!canEdit}
            placeholder={t('info.titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() !== media.title && save({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
        <div>
          <Label>{t('info.description')}</Label>
          <Textarea
            id="media-description"
            value={description}
            disabled={!canEdit}
            rows={3}
            placeholder={t('info.descriptionPlaceholder')}
            onChange={(e) => {
              const v = e.target.value
              setDescription(v)
              if (timer.current) clearTimeout(timer.current)
              timer.current = setTimeout(() => save({ description: v }), 900)
            }}
            onBlur={() => {
              if (timer.current) clearTimeout(timer.current)
              if (description !== media.description) save({ description })
            }}
          />
        </div>
        <div>
          <Label>{t('info.tags')}</Label>
          <TagEditor
            value={media.tags}
            disabled={!canEdit}
            placeholder={t('info.addTag')}
            onChange={(tags) => save({ tags })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('info.status')}</Label>
            <Select<MediaStatus>
              value={media.status}
              disabled={!canStatus}
              onChange={(status) => save({ status })}
              options={statuses.map((s) => ({
                value: s,
                label: t(`common:status.${s}`),
                icon: <Tally tone={toneFor(s)} size={7} />,
              }))}
              className="w-full"
            />
          </div>
          <div>
            <Label>{t('info.project')}</Label>
            <Select
              value={media.projectId ?? 'none'}
              disabled={!canEdit}
              onChange={(v) => save({ projectId: v === 'none' ? null : v })}
              options={[
                { value: 'none', label: t('info.noProject') },
                ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
              ]}
              className="w-full"
            />
          </div>
        </div>
        <div>
          <Label>{t('info.taken')}</Label>
          <Input
            type="datetime-local"
            value={takenValue}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              if (!v) return save({ takenAt: null })
              const [d, tm] = v.split('T')
              const [y, mo, da] = d!.split('-').map(Number)
              const [h, mi] = (tm ?? '00:00').split(':').map(Number)
              save({
                takenAt: zonedToInstant(
                  { year: y!, month: mo! - 1, day: da!, hour: h, minute: mi },
                  tz,
                ).toISOString(),
              })
            }}
            className="[color-scheme:inherit]"
          />
        </div>
        {admin && (
          <div>
            <Label aside={t('info.hiddenFromHint')}>{t('info.hiddenFrom')}</Label>
            <PeoplePicker
              value={media.hiddenFrom ?? []}
              only="reviewer"
              placeholder={t('info.nobody')}
              onChange={(hiddenFrom) => save({ hiddenFrom })}
            />
          </div>
        )}

        <Slot name="media.info.sections" props={{ media }} />

        <section>
          <div className="mb-2 t-headline text-ink">
            {t('info.details')} <span className="font-normal text-ink-3">· {format.label}</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 t-callout">
            {format.width && format.height ? (
              <Detail
                k={t('info.dimensions')}
                v={
                  <span className="t-meta text-[12px]">
                    {format.width} × {format.height}
                  </span>
                }
              />
            ) : null}
            {aspectLabel(format.width, format.height) && (
              <Detail k={t('info.aspect')} v={aspectLabel(format.width, format.height)} />
            )}
            {format.duration ? (
              <Detail
                k={t('info.duration')}
                v={<span className="t-meta text-[12px]">{formatDuration(format.duration)}</span>}
              />
            ) : null}
            {format.fps ? (
              <Detail
                k={t('info.fps')}
                v={<span className="t-meta text-[12px]">{Math.round(format.fps * 100) / 100} fps</span>}
              />
            ) : null}
            {format.kind === 'video' && (
              <Detail k={t('info.audio')} v={format.hasAudio ? t('info.hasAudio') : t('info.noAudio')} />
            )}
            <Detail
              k={t('info.fileSize')}
              v={<span className="t-meta text-[12px]">{formatBytes(format.size)}</span>}
            />
            <Detail k={t('info.type')} v={<span className="t-meta text-[12px]">{format.mime}</span>} />
            <Detail k={t('info.filename')} v={<span className="break-all">{format.filename}</span>} />
            <Detail
              k={t('info.storage')}
              v={
                format.storage === 'hot' ? t('info.hot') : <Badge tone="cue">{t('info.archivedState')}</Badge>
              }
            />
            <Detail
              k={t('info.added')}
              v={
                <span>
                  {formatDateTime(media.createdAt, tz)}
                  {media.createdBy && (
                    <span className="text-ink-3">
                      {' '}
                      · {t('info.by', { name: media.createdBy.displayName })}
                    </span>
                  )}
                </span>
              }
            />
          </dl>
        </section>

        {versions.length > 1 && (
          <section>
            <div className="mb-2 t-headline text-ink">{t('info.versions')}</div>
            <div className="flex flex-col">
              {versions.map((v) => {
                const current = v.fileRevision === format.fileRevision
                return (
                  <div
                    key={v.id}
                    className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0"
                  >
                    <span className="t-meta w-7 text-ink-3">v{v.fileRevision}</span>
                    <Avatar user={v.createdBy} size={22} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate t-callout text-ink">{v.filename}</div>
                      <div className="t-caption text-ink-3">
                        {formatBytes(v.size)} · {formatRelative(v.createdAt, tz)}
                        {v.note ? ` · ${v.note}` : ''}
                      </div>
                    </div>
                    {current ? (
                      <Badge tone="signal">{t('info.current')}</Badge>
                    ) : (
                      canEdit && (
                        <Button
                          size="xs"
                          variant="ghost"
                          icon={RotateCcw}
                          onClick={async () => {
                            try {
                              await api.post(`/media/files/${v.id}/restore`)
                              toast.done(t('info.restored', { n: v.fileRevision }))
                              void qc.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
                              void qc.invalidateQueries({ queryKey: qk.mediaFiles(media.id) })
                            } catch (err) {
                              toast.error(err)
                            }
                          }}
                        >
                          {t('info.restore')}
                        </Button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function Detail({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{k}</dt>
      <dd className="min-w-0 text-ink">{v}</dd>
    </>
  )
}
