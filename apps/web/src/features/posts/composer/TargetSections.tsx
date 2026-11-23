import { pickBestFormat } from '@greenlit/platforms'
import type { PostTarget } from '@greenlit/shared'
import { CalendarClock, ExternalLink, Image as ImageIcon, MapPin, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DateTimePanel } from '@/components/DateTimeField'
import { MediaPicker } from '@/components/MediaPicker'
import { PlatformIcon } from '@/components/PlatformIcon'
import { useMediaItem } from '@/data/media'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useCan } from '@/lib/session'
import { formatDateTime, useTimeZone } from '@/lib/time'
import {
  Avatar,
  Button,
  confirm,
  Field,
  Input,
  Popover,
  Segmented,
  Select,
  Slider,
  StatusLabel,
  Textarea,
  Toggle,
  toast,
} from '@/ui'
import { removeTarget, rescheduleTarget } from '../api'
import { type DraftTarget, onPlatform, optionsFor, specOf } from '../model'
import { useWhere } from '../parts'
import { Panel } from './bits'
import { type PostMediaItem, useComposer } from './state'

export function useTargetContext(target: DraftTarget) {
  const c = useComposer()
  const account = c.accounts.find((a) => a.id === target.accountId)
  const platform =
    account?.platform ?? c.post.targets.find((x) => x.id === target.id)?.platform ?? 'instagram'
  const spec = specOf(platform, target.placement)
  const server: PostTarget | undefined = target.id
    ? c.post.targets.find((x) => x.id === target.id)
    : undefined
  return { c, account, platform, spec, server }
}

/** The formats of the item's version this target uses (the main version's when none is chosen or it is gone). */
export function formatsFor(item: PostMediaItem, target: DraftTarget) {
  const version = target.versions[item.mediaId]
  return (version && item.versions.find((v) => v.key === version)?.formats) || item.formats
}

/** The format of each item this version uses: chosen, or the best fit for the placement. */
export function formatFor(item: PostMediaItem, target: DraftTarget, spec: ReturnType<typeof specOf>) {
  const formats = formatsFor(item, target)
  const chosen = target.formats[item.mediaId]
  const byKey = chosen ? formats.find((f) => f.key === chosen) : undefined
  if (byKey) return byKey
  const i = spec ? pickBestFormat(spec, formats) : 0
  return formats[Math.max(0, i)] ?? formats[0]
}

/** The audio track that replaces the item's sound on this target, if any. */
export function trackFor(item: PostMediaItem, target: DraftTarget) {
  const key = target.audioTracks[item.mediaId]
  return key && item.kind === 'video' ? item.audioTracks.find((a) => a.key === key) : undefined
}

export function TargetHeader({ target }: { target: DraftTarget }) {
  const t = useT('posts')
  const where = useWhere()
  const tz = useTimeZone()
  const canPublish = useCan('posts.publish')
  const { c, account, platform, server } = useTargetContext(target)
  const label = where(platform, target.placement)
  const live = server && onPlatform(server)
  return (
    <div className="flex items-center gap-3.5 rounded-panel bg-panel px-5 py-4 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-lift)]">
      <span className="relative shrink-0">
        <Avatar
          user={account ? { id: account.id, displayName: account.name, avatarUrl: account.avatarUrl } : null}
          size={40}
        />
        <PlatformIcon
          platform={platform}
          size={18}
          tile
          className="absolute -right-1 -bottom-1 shadow-[0_0_0_2px_var(--panel)]"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate t-headline text-ink">{label}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 t-caption text-ink-3">
          <span className="truncate">{account?.name}</span>
          {server && <StatusLabel status={server.state} label={t(`state.${server.state}`)} />}
          {server?.publishedAt && <span className="t-meta">{formatDateTime(server.publishedAt, tz)}</span>}
        </div>
        {server?.error && (
          <div className="mt-1.5 t-caption text-cut">
            {t('composer.error', { where: label, message: server.error })}
          </div>
        )}
        {live && (
          <div className="mt-1 t-caption text-ink-3">{t('composer.pushedEdits', { where: label })}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {server?.remoteUrl && (
          <a href={server.remoteUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" icon={ExternalLink}>
              {t('composer.openOnPlatform', { where: where(platform) })}
            </Button>
          </a>
        )}
        {live && canPublish && server?.state === 'scheduled' && (
          <MoveButton postId={c.post.id} targetId={server.id} at={server.scheduleAt} where={label} />
        )}
        {live && canPublish && (
          <Button
            size="sm"
            variant="danger-ghost"
            icon={Trash2}
            onClick={async () => {
              const ok = await confirm({
                title: t('composer.removeConfirm', { where: label }),
                body: t('composer.removeBody'),
                confirm: t('composer.removeFromPlatform', { where: where(platform) }),
                danger: true,
              })
              if (!ok || !server) return
              try {
                await removeTarget(c.post.id, server.id)
                toast.info(t('composer.removing', { where: label }))
              } catch (e) {
                toast.error(e, errorMessage(e))
              }
            }}
          >
            {t('composer.removeFromPlatform', { where: where(platform) })}
          </Button>
        )}
        {!live && (
          <Toggle
            checked={target.enabled}
            onChange={(enabled) => c.updateTarget(target.key, { enabled })}
            disabled={!c.editable}
            label={label}
          />
        )}
      </div>
    </div>
  )
}

/** Moves a version already scheduled on its platform (the platform's schedule moves too, after a confirmation). */
function MoveButton({
  postId,
  targetId,
  at,
  where,
}: {
  postId: string
  targetId: string
  at: string | null
  where: string
}) {
  const t = useT('posts')
  const tz = useTimeZone()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(at)
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setValue(at)
      }}
      align="end"
      width={320}
      trigger={
        <Button size="sm" icon={CalendarClock}>
          {t('composer.reschedule')}
        </Button>
      }
    >
      <DateTimePanel value={value} min={new Date()} onChange={(iso) => setValue(iso)} />
      <div className="flex justify-end gap-2 border-t border-line p-3">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('common:cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!value || value === at}
          onClick={async () => {
            if (!value) return
            const when = formatDateTime(value, tz)
            const ok = await confirm({
              title: t('composer.rescheduleConfirm', { where }),
              body: t('composer.rescheduleBody', { when }),
              confirm: t('composer.reschedule').replace('…', ''),
            })
            if (!ok) return
            try {
              await rescheduleTarget(postId, targetId, value)
              toast.done(t('composer.rescheduled', { when }))
              setOpen(false)
            } catch (e) {
              toast.error(e, errorMessage(e))
            }
          }}
        >
          {t('composer.reschedule').replace('…', '')}
        </Button>
      </div>
    </Popover>
  )
}

/** Which version, shape and sound of each item goes out here (only what an item offers a choice of). */
export function FormatsSection({ target }: { target: DraftTarget }) {
  const t = useT('posts')
  const { c, spec } = useTargetContext(target)
  const choices = c.media.filter(
    (m) =>
      m.versions.length > 1 ||
      formatsFor(m, target).length > 1 ||
      (m.kind === 'video' && m.audioTracks.length > 0),
  )
  if (!choices.length) return null
  const without = (record: Record<string, string>, id: string) => {
    const { [id]: _, ...rest } = record
    return rest
  }
  return (
    <Panel title={t('composer.formats')} hint={t('composer.formatsHint')}>
      <div className="flex flex-col gap-3.5">
        {choices.map((m) => {
          const formats = formatsFor(m, target)
          const best = spec ? item(formats, pickBestFormat(spec, formats)) : undefined
          const version = target.versions[m.mediaId]
          const versionValue = version && m.versions.some((v) => v.key === version) ? version : '__main'
          const track = trackFor(m, target)
          return (
            <div key={m.mediaId} className="flex items-start gap-3">
              <span className="size-9 shrink-0 overflow-hidden rounded-[7px] bg-stage">
                {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="size-full object-cover" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="truncate pt-2 t-callout text-ink">{m.title}</span>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                  {m.versions.length > 1 && (
                    <>
                      <span className="t-caption text-ink-3">{t('composer.version')}</span>
                      <Select
                        value={versionValue}
                        disabled={!c.editable}
                        onChange={(v) =>
                          c.updateTarget(target.key, {
                            versions:
                              v === '__main'
                                ? without(target.versions, m.mediaId)
                                : { ...target.versions, [m.mediaId]: v },
                          })
                        }
                        options={m.versions.map((v) => ({
                          value: v.key || '__main',
                          label: v.label,
                          hint: v.key ? undefined : t('composer.mainVersion'),
                        }))}
                      />
                    </>
                  )}
                  {formats.length > 1 && (
                    <>
                      <span className="t-caption text-ink-3">{t('composer.shape')}</span>
                      <Select
                        value={
                          target.formats[m.mediaId] &&
                          formats.some((f) => f.key === target.formats[m.mediaId])
                            ? target.formats[m.mediaId]!
                            : '__best'
                        }
                        disabled={!c.editable}
                        onChange={(v) =>
                          c.updateTarget(target.key, {
                            formats:
                              v === '__best'
                                ? without(target.formats, m.mediaId)
                                : { ...target.formats, [m.mediaId]: v },
                          })
                        }
                        options={[
                          { value: '__best', label: t('composer.best'), hint: best ? best.label : undefined },
                          ...formats.map((f) => ({
                            value: f.key,
                            label: f.label,
                            hint: f.width && f.height ? `${f.width}×${f.height}` : undefined,
                          })),
                        ]}
                      />
                    </>
                  )}
                  {m.kind === 'video' && m.audioTracks.length > 0 && (
                    <>
                      <span className="t-caption text-ink-3">{t('composer.sound')}</span>
                      <Select
                        value={track?.key ?? '__own'}
                        disabled={!c.editable}
                        onChange={(v) =>
                          c.updateTarget(target.key, {
                            audioTracks:
                              v === '__own'
                                ? without(target.audioTracks, m.mediaId)
                                : { ...target.audioTracks, [m.mediaId]: v },
                          })
                        }
                        options={[
                          { value: '__own', label: t('composer.ownSound') },
                          ...m.audioTracks.map((a) => ({
                            value: a.key,
                            label: a.label,
                            hint: a.duration ? formatDuration(a.duration) : undefined,
                          })),
                        ]}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
const item = <T,>(formats: T[], i: number) => formats[Math.max(0, i)]

/** The cover: the platform's choice, a frame of the video, or a picture from the library. */
export function CoverSection({ target }: { target: DraftTarget }) {
  const t = useT('posts')
  const { c, spec } = useTargetContext(target)
  const [picking, setPicking] = useState(false)
  const first = c.media[0]
  if (!spec || !first) return null
  const modes = spec.thumbnail.modes
  const canFrame = modes.includes('frame') && first.kind === 'video'
  const canImage = modes.includes('image')
  if (!canFrame && !canImage) return null
  const f = formatFor(first, target, spec)
  const mode = target.thumbnail.mode
  const opts = [
    { value: 'auto' as const, label: t('composer.coverAuto') },
    ...(canFrame ? [{ value: 'frame' as const, label: t('composer.coverFrame') }] : []),
    ...(canImage ? [{ value: 'media' as const, label: t('composer.coverPicture') }] : []),
  ]
  return (
    <Panel title={t('composer.cover')} hint={t('composer.coverHint')}>
      <Segmented
        value={mode}
        onChange={(v) => {
          if (v === 'auto') c.updateTarget(target.key, { thumbnail: { mode: 'auto' } })
          if (v === 'frame') c.updateTarget(target.key, { thumbnail: { mode: 'frame', time: 0 } })
          if (v === 'media') setPicking(true)
        }}
        options={opts}
      />
      {mode === 'frame' && target.thumbnail.mode === 'frame' && f?.previewUrl && (
        <FrameScrubber
          src={f.previewUrl}
          poster={f.posterUrl}
          duration={f.duration ?? 0}
          aspect={f.width && f.height ? f.width / f.height : 16 / 9}
          time={target.thumbnail.time}
          onChange={(time) => c.updateTarget(target.key, { thumbnail: { mode: 'frame', time } })}
          disabled={!c.editable}
        />
      )}
      {mode === 'media' && target.thumbnail.mode === 'media' && (
        <CoverPicture mediaId={target.thumbnail.mediaId} onChange={() => setPicking(true)} />
      )}
      <MediaPicker
        open={picking}
        onOpenChange={setPicking}
        multiple={false}
        kinds={['image']}
        projectId={c.draft.projectId ?? undefined}
        title={t('composer.coverPick')}
        onPick={([m]) => m && c.updateTarget(target.key, { thumbnail: { mode: 'media', mediaId: m.id } })}
      />
    </Panel>
  )
}

function CoverPicture({ mediaId, onChange }: { mediaId: string; onChange: () => void }) {
  const t = useT('posts')
  const { data } = useMediaThumb(mediaId)
  return (
    <div className="mt-4 flex items-center gap-4">
      <span className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-tile bg-stage text-[#5c605d]">
        {data ? <img src={data} alt="" className="size-full object-cover" /> : <ImageIcon size={20} />}
      </span>
      <Button size="sm" onClick={onChange}>
        {t('composer.coverChange')}
      </Button>
    </div>
  )
}

function useMediaThumb(id: string) {
  const { data } = useMediaItem(id)
  return { data: data?.thumbnailUrl ?? null }
}

/** A frame of the video, chosen by scrubbing. */
function FrameScrubber({
  src,
  poster,
  duration,
  aspect,
  time,
  onChange,
  disabled,
}: {
  src: string
  poster: string | null
  duration: number
  aspect: number
  time: number
  onChange: (t: number) => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [local, setLocal] = useState(time)
  useEffect(() => setLocal(time), [time])
  useEffect(() => {
    const v = ref.current
    if (v && Math.abs(v.currentTime - local) > 0.02) v.currentTime = local
  }, [local])
  const h = 220
  return (
    <div className="mt-4">
      <div
        className="relative mx-auto overflow-hidden rounded-tile bg-stage"
        style={{ height: h, width: Math.min(560, h * aspect) }}
      >
        <video
          ref={ref}
          src={src}
          poster={poster ?? undefined}
          muted
          playsInline
          preload="auto"
          className="size-full object-contain"
        />
        <span className="force-dark absolute right-2 bottom-2 rounded-[5px] bg-black/60 px-1.5 py-0.5 t-meta text-white backdrop-blur-md">
          {formatDuration(local)}
        </span>
      </div>
      <div className="mx-auto mt-3 flex max-w-[560px] items-center gap-3">
        <span className="t-meta text-ink-3">0:00</span>
        <Slider
          value={local}
          min={0}
          max={Math.max(0.1, duration)}
          step={1 / 30}
          onChange={setLocal}
          onCommit={(v) => onChange(Math.round(v * 100) / 100)}
          disabled={disabled}
        />
        <span className="t-meta text-ink-3">{formatDuration(duration)}</span>
      </div>
    </div>
  )
}

/** First comment and place, where the account can set them. */
export function ExtrasSection({ target }: { target: DraftTarget }) {
  const t = useT('posts')
  const { c, account, spec } = useTargetContext(target)
  const showComment = account?.capabilities.firstComment && target.placement !== 'story'
  const showPlace = account?.capabilities.location && (spec?.features.location ?? false)
  if (!showComment && !showPlace) return null
  return (
    <Panel
      title={[showComment && t('composer.firstComment'), showPlace && t('composer.location')]
        .filter(Boolean)
        .join(' · ')}
    >
      <div className="flex flex-col gap-4">
        {showComment && (
          <Field label={t('composer.firstComment')}>
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={target.firstComment}
                disabled={!c.editable}
                placeholder={t('composer.firstCommentPlaceholder')}
                onChange={(e) => c.updateTarget(target.key, { firstComment: e.target.value })}
              />
            )}
          </Field>
        )}
        {showPlace && (
          <Field label={t('composer.location')}>
            {(id) => (
              <Input
                id={id}
                leading={<MapPin size={14} />}
                value={target.location?.name ?? ''}
                disabled={!c.editable}
                placeholder={t('composer.locationPlaceholder')}
                onChange={(e) =>
                  c.updateTarget(target.key, {
                    location: e.target.value
                      ? {
                          name: e.target.value,
                          lat: target.location?.lat ?? null,
                          lng: target.location?.lng ?? null,
                          platformId: null,
                        }
                      : null,
                  })
                }
              />
            )}
          </Field>
        )}
      </div>
    </Panel>
  )
}

/** The platform's switches for this placement (privacy, comments, Duet/Stitch, AI label…). */
export function OptionsSection({ target }: { target: DraftTarget }) {
  const t = useT('posts')
  const { c, account, platform } = useTargetContext(target)
  const defs = optionsFor(platform, target.placement, { account, target })
  if (!defs.length) return null
  const set = (key: string, value: unknown) =>
    c.updateTarget(target.key, { options: { ...target.options, [key]: value } })
  return (
    <Panel title={t('composer.options')}>
      <div className="flex flex-col divide-y divide-line">
        {defs.map((o) => {
          const value = target.options[o.key] ?? o.fallback
          const hint = t(`options.${o.key}.hint`, { defaultValue: '' })
          return (
            <div
              key={`${o.key}`}
              className={cn('flex items-center justify-between gap-6 py-2.5 first:pt-0 last:pb-0')}
            >
              <div className="min-w-0">
                <div className="t-callout font-[550] text-ink">{t(`options.${o.key}.label`)}</div>
                {hint && <div className="mt-0.5 t-caption text-ink-3">{hint}</div>}
              </div>
              {o.kind === 'toggle' ? (
                <Toggle checked={value === true} onChange={(v) => set(o.key, v)} disabled={!c.editable} />
              ) : (
                <Select
                  className="w-52"
                  value={String(value)}
                  disabled={!c.editable}
                  onChange={(v) => set(o.key, v)}
                  options={(o.values ?? []).map((v) => ({
                    value: v,
                    label:
                      o.key === 'category'
                        ? v || t('options.category.none')
                        : t(`options.${o.key}.${v}`, { defaultValue: v }),
                  }))}
                />
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
