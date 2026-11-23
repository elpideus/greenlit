import type { Media, MediaFormat } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Languages, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { useId, useRef, useState } from 'react'
import { keyFor, uploadMedia } from '@/data/media'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { spring } from '@/lib/motion'
import { qk } from '@/lib/query'
import { useCan } from '@/lib/session'
import {
  Button,
  confirm,
  Dialog,
  Field,
  InlineEdit,
  Input,
  type MenuEntry,
  ProgressRing,
  toast,
  useContextMenu,
} from '@/ui'

/** The key of a version in URLs (`main` = the main version). */
const urlKey = (key: string) => key || 'main'

export function useMediaRefresh(mediaId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: qk.mediaItem(mediaId) })
    void qc.invalidateQueries({ queryKey: qk.media() })
  }
}

/**
 * The versions of one item as a segmented strip next to its formats: the same video with Italian or English text,
 * a cut without the logo... One click compares them. Right-click a version to rename it, make it the main one
 * (the one lists, thumbnails and new posts use) or remove it. Hidden while the item has a single version.
 */
export function VersionSwitcher({
  media,
  version,
  onSelect,
  onNew,
}: {
  media: Media
  version: string
  onSelect: (key: string) => void
  onNew: () => void
}) {
  const t = useT('viewer')
  const id = useId()
  const canEdit = useCan('media.edit')
  const canUpload = useCan('media.upload')
  const refresh = useMediaRefresh(media.id)
  const [renaming, setRenaming] = useState<string | null>(null)
  if (media.versions.length < 2) return null

  const patch = async (key: string, body: Record<string, unknown>) => {
    try {
      await api.patch(`/media/${media.id}/versions/${urlKey(key)}`, body)
      refresh()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <LayoutGroup id={id}>
      <div
        className="flex items-center gap-0.5 rounded-control bg-white/6 p-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]"
        title={t('versions')}
      >
        <Languages size={13} className="mx-1.5 shrink-0 text-white/40" aria-hidden />
        {media.versions.map((v) => (
          <VersionChip
            key={v.key}
            label={v.label}
            formats={v.formats}
            main={!v.key}
            active={v.key === version}
            renaming={renaming === v.key}
            onRenaming={(r) => setRenaming(r ? v.key : null)}
            onSelect={() => onSelect(v.key)}
            onRename={(label) => patch(v.key, { label })}
            menu={(): MenuEntry[] => [
              canEdit && { label: t('renameVersion'), icon: Pencil, onSelect: () => setRenaming(v.key) },
              canEdit &&
                !!v.key && {
                  label: t('makeMainVersion'),
                  icon: Star,
                  onSelect: async () => {
                    await patch(v.key, { isMain: true })
                    toast.done(t('mainVersionNow', { version: v.label }))
                    onSelect('')
                  },
                },
              canUpload && 'separator',
              canUpload && { label: t('newVersion'), icon: Plus, onSelect: onNew },
              canEdit && !!v.key && 'separator',
              canEdit &&
                !!v.key && {
                  label: t('removeVersion'),
                  icon: Trash2,
                  danger: true,
                  onSelect: async () => {
                    if (
                      !(await confirm({
                        title: t('removeVersionConfirm', { version: v.label }),
                        body: t('removeVersionBody'),
                        confirm: t('removeVersion'),
                        danger: true,
                      }))
                    )
                      return
                    try {
                      await api.delete(`/media/${media.id}/versions/${v.key}`)
                      toast.done(t('versionRemoved', { version: v.label }))
                      if (v.key === version) onSelect('')
                      refresh()
                    } catch (err) {
                      toast.error(err)
                    }
                  },
                },
            ]}
          />
        ))}
      </div>
    </LayoutGroup>
  )
}

function VersionChip({
  label,
  formats,
  main,
  active,
  renaming,
  onRenaming,
  onSelect,
  onRename,
  menu,
}: {
  label: string
  formats: MediaFormat[]
  main: boolean
  active: boolean
  renaming: boolean
  onRenaming: (r: boolean) => void
  onSelect: () => void
  onRename: (label: string) => void
  menu: () => MenuEntry[]
}) {
  const ctx = useContextMenu(menu)
  const busy = formats.find((f) => f.processing.state === 'pending' || f.processing.state === 'processing')
  return (
    <button
      type="button"
      {...ctx}
      onClick={onSelect}
      onDoubleClick={() => onRenaming(true)}
      aria-pressed={active}
      className={cn(
        'press relative z-0 flex h-7 items-center gap-1.5 rounded-[calc(var(--r-control)-3px)] px-2.5 t-callout whitespace-nowrap',
        active ? 'font-[550] text-white' : 'text-white/55 hover:text-white/85',
      )}
    >
      {active && (
        <motion.span
          layoutId="version-pill"
          transition={spring.snap}
          className="absolute inset-0 -z-10 rounded-[calc(var(--r-control)-3px)] bg-white/14 shadow-[inset_0_0_0_.5px_rgba(255,255,255,.14),inset_0_1px_0_rgba(255,255,255,.08)]"
        />
      )}
      {busy && <ProgressRing value={busy.processing.progress} size={12} className="text-signal" />}
      <InlineEdit
        value={label}
        onSave={onRename}
        editing={renaming}
        onEditingChange={onRenaming}
        tooltip={null}
        className="max-w-[140px]"
      />
      {main && <span className="size-1 rounded-full bg-signal" role="img" aria-label="Main" />}
    </button>
  )
}

/**
 * Adds a version: its name (and, for the first one, the name of the current one), then its first file, which
 * becomes the new version's `format` (the shape on screen). Its other shapes are added from the format strip.
 */
export function NewVersionDialog({
  media,
  format,
  open,
  onOpenChange,
  onCreated,
}: {
  media: Media
  format: MediaFormat
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (key: string) => void
}) {
  const t = useT('viewer')
  const refresh = useMediaRefresh(media.id)
  const [name, setName] = useState('')
  const [current, setCurrent] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const first = media.versions.length < 2

  const onFile = async (f: File | undefined) => {
    if (!f) return
    const label = name.trim()
    const key = keyFor(
      label,
      media.versions.map((v) => v.key),
      'version',
    )
    onOpenChange(false)
    setName('')
    setCurrent('')
    toast.info(t('versionUploading', { name: f.name, version: label }))
    const ids = await uploadMedia([f], {
      mediaId: media.id,
      formatKey: format.key,
      label: format.label,
      version: key,
      versionLabel: label,
      ...(first ? { mainVersionLabel: current.trim() || t('originalVersion') } : {}),
    })
    refresh()
    if (ids.length) {
      toast.done(t('versionAdded', { version: label }))
      onCreated(key)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('newVersionTitle')}
      description={t('newVersionBody', { format: format.label })}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="primary"
            icon={Upload}
            disabled={!name.trim()}
            onClick={() => file.current?.click()}
          >
            {t('chooseFile')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('versionName')}>
          {(fid) => (
            <Input
              id={fid}
              autoFocus
              value={name}
              placeholder={t('versionNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && file.current?.click()}
            />
          )}
        </Field>
        {first && (
          <Field label={t('currentVersionName')} hint={t('currentVersionHint')}>
            {(fid) => (
              <Input
                id={fid}
                value={current}
                placeholder={t('currentVersionPlaceholder')}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
      <input
        ref={file}
        type="file"
        hidden
        accept={media.kind === 'image' ? 'image/*' : media.kind === 'video' ? 'video/*' : undefined}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          void onFile(f)
        }}
      />
    </Dialog>
  )
}

/** Asks for a name (renaming a track, naming a new one). */
export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  initial = '',
  confirmLabel,
  confirmIcon,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  placeholder?: string
  initial?: string
  confirmLabel: string
  confirmIcon?: typeof Upload
  onConfirm: (name: string) => void
}) {
  const t = useT('viewer')
  const [value, setValue] = useState(initial)
  const [shownFor, setShownFor] = useState(false)
  // Start from `initial` each time it opens.
  if (open !== shownFor) {
    setShownFor(open)
    if (open) setValue(initial)
  }
  const done = () => {
    if (!value.trim()) return
    onConfirm(value.trim())
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={380}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" icon={confirmIcon} disabled={!value.trim()} onClick={done}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label}>
        {(fid) => (
          <Input
            id={fid}
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && done()}
          />
        )}
      </Field>
    </Dialog>
  )
}
