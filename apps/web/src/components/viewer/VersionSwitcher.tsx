import {
  findVersion,
  type Media,
  type MediaFormat,
  type MediaVersion,
  type MediaVersionGroup,
  type NewVersionInput,
  nearestVersion,
  versionName,
} from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Layers, Pencil, Plus, Star, Tag, Trash2, Upload } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { useId, useRef, useState } from 'react'
import { uploadVersion } from '@/data/media'
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
  Menu,
  type MenuEntry,
  ProgressRing,
  Segmented,
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

/** A group's name on screen ('' = unnamed: "Versions"). */
function useGroupName() {
  const t = useT('viewer')
  return (g: MediaVersionGroup) => g.label || t('versions')
}

/**
 * The versions of one item next to its formats: one segmented strip per thing that differs (Language: Italiano |
 * English, Watermark: With | Without). Each version is one choice from every strip, so one click compares the same
 * shot with and without the watermark. A choice whose combination with the others isn't uploaded yet is dashed:
 * click it to upload it (or to see the nearest version that has it). Right-click a choice to rename it, make it the
 * main one (the one lists, thumbnails and new posts use) or remove it. Hidden while the item has a single version.
 */
export function VersionSwitcher({
  media,
  version,
  format,
  onSelect,
  onNew,
}: {
  media: Media
  version: string
  /** The format on screen: a missing version's file is uploaded as this shape. */
  format: MediaFormat
  onSelect: (key: string) => void
  onNew: () => void
}) {
  const t = useT('viewer')
  const refresh = useMediaRefresh(media.id)
  const canUpload = useCan('media.upload')
  const file = useRef<HTMLInputElement>(null)
  const pending = useRef<NewVersionInput & { label: string }>(null)
  const [renamingGroup, setRenamingGroup] = useState<MediaVersionGroup | null>(null)
  if (media.versions.length < 2) return null
  const current = media.versions.find((v) => v.key === version) ?? media.versions[0]!

  const uploadInto = (group: MediaVersionGroup, option: string) => {
    pending.current = {
      from: version || undefined,
      group: group.key,
      option,
      label: versionName(media.versionGroups, { ...current.values, [group.key]: option }),
    }
    file.current?.click()
  }
  const onFile = async (f: File | undefined) => {
    const p = pending.current
    if (!f || !p) return
    const { label, ...newVersion } = p
    toast.info(t('versionUploading', { name: f.name, version: label }))
    const key = await uploadVersion(f, {
      mediaId: media.id,
      formatKey: format.key,
      label: format.label,
      newVersion,
    })
    refresh()
    if (key !== null) {
      toast.done(t('versionAdded', { version: label }))
      onSelect(key)
    }
  }

  return (
    <>
      {/* One strip per group, side by side with the format strip (the parent lays them out and wraps them). */}
      {media.versionGroups.map((g) => (
        <GroupStrip
          key={g.key}
          media={media}
          group={g}
          current={current}
          onSelect={onSelect}
          onNew={onNew}
          onUpload={(option) => uploadInto(g, option)}
          onRenameGroup={() => setRenamingGroup(g)}
        />
      ))}
      {canUpload && (
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
      )}
      <NameDialog
        open={!!renamingGroup}
        onOpenChange={(o) => !o && setRenamingGroup(null)}
        title={t('renameGroup')}
        label={t('groupName')}
        placeholder={t('groupNamePlaceholder')}
        initial={renamingGroup?.label ?? ''}
        confirmLabel={t('common:save')}
        allowEmpty
        onConfirm={async (label) => {
          const g = renamingGroup
          setRenamingGroup(null)
          if (!g) return
          try {
            await api.patch(`/media/${media.id}/version-groups/${g.key}`, { label })
            refresh()
          } catch (err) {
            toast.error(err)
          }
        }}
      />
    </>
  )
}

function GroupStrip({
  media,
  group,
  current,
  onSelect,
  onNew,
  onUpload,
  onRenameGroup,
}: {
  media: Media
  group: MediaVersionGroup
  current: MediaVersion
  onSelect: (key: string) => void
  onNew: () => void
  onUpload: (option: string) => void
  onRenameGroup: () => void
}) {
  const t = useT('viewer')
  const id = useId()
  const groupName = useGroupName()
  const canEdit = useCan('media.edit')
  const canUpload = useCan('media.upload')
  const refresh = useMediaRefresh(media.id)
  const [renaming, setRenaming] = useState<string | null>(null)
  const main = media.versions.find((v) => !v.key) ?? media.versions[0]!
  const labelMenu = useContextMenu(() => [
    canEdit && { label: t('renameGroup'), icon: Tag, onSelect: onRenameGroup },
    canUpload && { label: t('newVersion'), icon: Plus, onSelect: onNew },
  ])

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      refresh()
      return true
    } catch (err) {
      toast.error(err)
      return false
    }
  }

  return (
    <LayoutGroup id={id}>
      <div
        className="flex items-center gap-0.5 rounded-control bg-white/6 p-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]"
        title={groupName(group)}
      >
        {group.label ? (
          <button
            type="button"
            {...labelMenu}
            onDoubleClick={canEdit ? onRenameGroup : undefined}
            className="max-w-[96px] shrink-0 cursor-default truncate pr-1 pl-1.5 t-caption text-white/40"
            title={group.label}
          >
            {group.label}
          </button>
        ) : (
          <span {...labelMenu} className="mx-1.5 shrink-0 text-white/40" title={t('versions')}>
            <Layers size={13} aria-hidden />
          </span>
        )}
        {group.options.map((o, i) => {
          const values = { ...current.values, [group.key]: o.key }
          const exact = findVersion(media.versions, values)
          const active = current.values[group.key] === o.key
          if (!exact) {
            const near = nearestVersion(media.versions, media.versionGroups, current.values, group.key, o.key)
            return (
              <MissingChip
                key={o.key}
                label={o.label}
                missing={versionName(media.versionGroups, values)}
                nearest={near}
                canUpload={canUpload}
                onUpload={() => onUpload(o.key)}
                onShow={() => near && onSelect(near.key)}
              />
            )
          }
          const withOption = media.versions.filter((v) => v.values[group.key] === o.key)
          // Make it main: the main version with this choice in its place.
          const asMain =
            i > 0 ? findVersion(media.versions, { ...main.values, [group.key]: o.key }) : undefined
          return (
            <VersionChip
              key={o.key}
              label={o.label}
              title={versionName(media.versionGroups, values)}
              formats={exact.formats}
              main={i === 0}
              active={active}
              renaming={renaming === o.key}
              onRenaming={(r) => setRenaming(r ? o.key : null)}
              onSelect={() => onSelect(exact.key)}
              onRename={(label) =>
                run(() =>
                  api.patch(`/media/${media.id}/version-groups/${group.key}/options/${o.key}`, { label }),
                )
              }
              menu={(): MenuEntry[] => [
                canEdit && {
                  label: t('renameOption', { option: o.label }),
                  icon: Pencil,
                  onSelect: () => setRenaming(o.key),
                },
                canEdit &&
                  asMain && {
                    label:
                      media.versionGroups.length > 1
                        ? t('makeMainNamed', { version: asMain.label })
                        : t('makeMainVersion'),
                    icon: Star,
                    onSelect: async () => {
                      const ok = await run(() =>
                        api.patch(`/media/${media.id}/versions/${urlKey(asMain.key)}`, { isMain: true }),
                      )
                      if (!ok) return
                      toast.done(t('mainVersionNow', { version: asMain.label }))
                      onSelect('')
                    },
                  },
                (canUpload || canEdit) && 'separator',
                canUpload && { label: t('newVersion'), icon: Plus, onSelect: onNew },
                canEdit && { label: t('renameGroup'), icon: Tag, onSelect: onRenameGroup },
                canEdit && i > 0 && 'separator',
                canEdit &&
                  i > 0 && {
                    label: t('removeOption', { option: o.label }),
                    icon: Trash2,
                    danger: true,
                    onSelect: async () => {
                      if (
                        !(await confirm({
                          title: t('removeOptionConfirm', { option: o.label }),
                          body:
                            withOption.length > 1
                              ? t('removeOptionBodyMany', {
                                  versions: withOption.map((v) => v.label).join(', '),
                                })
                              : t('removeVersionBody'),
                          confirm: t('removeOption', { option: o.label }),
                          danger: true,
                        }))
                      )
                        return
                      const ok = await run(() =>
                        api.delete(`/media/${media.id}/version-groups/${group.key}/options/${o.key}`),
                      )
                      if (!ok) return
                      toast.done(t('versionRemoved', { version: o.label }))
                      if (current.values[group.key] === o.key) onSelect('')
                    },
                  },
                canEdit &&
                  media.versionGroups.length > 1 &&
                  exact.key !== '' &&
                  withOption.length > 1 && {
                    label: t('removeOnly', { version: exact.label }),
                    icon: Trash2,
                    danger: true,
                    onSelect: async () => {
                      if (
                        !(await confirm({
                          title: t('removeVersionConfirm', { version: exact.label }),
                          body: t('removeVersionBody'),
                          confirm: t('removeVersion'),
                          danger: true,
                        }))
                      )
                        return
                      const ok = await run(() => api.delete(`/media/${media.id}/versions/${exact.key}`))
                      if (!ok) return
                      toast.done(t('versionRemoved', { version: exact.label }))
                      if (exact.key === current.key) onSelect('')
                    },
                  },
              ]}
            />
          )
        })}
      </div>
    </LayoutGroup>
  )
}

const chipBase =
  'press relative z-0 flex h-7 items-center gap-1.5 rounded-[calc(var(--r-control)-3px)] px-2.5 t-callout whitespace-nowrap'

function VersionChip({
  label,
  title,
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
  title: string
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
      title={title}
      className={cn(chipBase, active ? 'font-[550] text-white' : 'text-white/55 hover:text-white/85')}
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

/** A choice whose combination with the others on screen has no file yet. */
function MissingChip({
  label,
  missing,
  nearest,
  canUpload,
  onUpload,
  onShow,
}: {
  label: string
  /** The missing version's name ("English · Without watermark"). */
  missing: string
  nearest: MediaVersion | undefined
  canUpload: boolean
  onUpload: () => void
  onShow: () => void
}) {
  const t = useT('viewer')
  const chip = (
    <button
      type="button"
      title={t('notUploaded', { version: missing })}
      {...(canUpload ? {} : { onClick: onShow })}
      className={cn(
        chipBase,
        'border border-dashed border-white/20 text-white/40 hover:border-white/40 hover:text-white/80',
      )}
    >
      {canUpload && <Upload size={12} />}
      {label}
    </button>
  )
  if (!canUpload) return chip
  return (
    <Menu
      align="start"
      width={280}
      trigger={chip}
      items={[
        { group: t('notUploaded', { version: missing }) },
        { label: t('uploadVersion', { version: missing }), icon: Upload, onSelect: onUpload },
        nearest && {
          label: t('showVersion', { version: nearest.label }),
          icon: ArrowRight,
          onSelect: onShow,
        },
      ]}
    />
  )
}

type Preset = { group: string; current: string; next: string }

/**
 * Adds a version: something else that differs (a new group: "Watermark", what the current ones are, "With", and the
 * new one, "Without"), or another choice in a group the item has ("Deutsch" next to Italiano | English). Its first
 * file becomes the new version's `format` (the shape on screen); its other shapes are added from the format strip.
 */
export function NewVersionDialog({
  media,
  format,
  version,
  open,
  onOpenChange,
  onCreated,
}: {
  media: Media
  format: MediaFormat
  /** The version on screen: the new one is like it, with one difference. */
  version: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (key: string) => void
}) {
  const t = useT('viewer')
  const groupName = useGroupName()
  const refresh = useMediaRefresh(media.id)
  const groups = media.versionGroups
  const [mode, setMode] = useState<string>('')
  const [name, setName] = useState('')
  const [groupLabel, setGroupLabel] = useState('')
  const [current, setCurrent] = useState('')
  const [shownFor, setShownFor] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  // Start fresh each time it opens: another choice in the first group, or a new group when there is none.
  if (open !== shownFor) {
    setShownFor(open)
    if (open) {
      setMode(groups[0]?.key ?? '__new')
      setName('')
      setGroupLabel('')
      setCurrent('')
    }
  }
  const from = media.versions.find((v) => v.key === version) ?? media.versions[0]
  const group = groups.find((g) => g.key === mode)
  const creatingGroup = !group
  const label = name.trim()
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  // A name the version on screen already has in that group: nothing would differ.
  const existing = group?.options.find((o) => same(o.label, label))
  const taken =
    !!label &&
    (creatingGroup
      ? same(label, current || t('originalVersion'))
      : !!existing && !!findVersion(media.versions, { ...from?.values, [group.key]: existing.key }))
  // What the new version will be called: the one on screen with the new name in place of its choice.
  const result =
    group && label
      ? groups
          .map((g) =>
            g.key === group.key ? label : g.options.find((o) => o.key === from?.values[g.key])?.label,
          )
          .filter(Boolean)
          .join(' · ')
      : null
  const ready = !!label && !taken

  const presets: (Preset & { key: string; label: string })[] = [
    {
      key: 'language',
      label: t('presetLanguage'),
      group: t('presetLanguage'),
      current: t('presetLanguageCurrent'),
      next: t('presetLanguageNew'),
    },
    {
      key: 'watermark',
      label: t('presetWatermark'),
      group: t('presetWatermark'),
      current: t('presetWatermarkCurrent'),
      next: t('presetWatermarkNew'),
    },
  ].filter((p) => !groups.some((g) => g.label.trim().toLowerCase() === p.group.toLowerCase()))

  const onFile = async (f: File | undefined) => {
    if (!f) return
    const newVersion: NewVersionInput = group
      ? { from: version || undefined, group: group.key, optionLabel: label }
      : {
          from: version || undefined,
          groupLabel: groupLabel.trim() || undefined,
          optionLabel: label,
          currentLabel: current.trim() || t('originalVersion'),
        }
    onOpenChange(false)
    const shown = result ?? label
    toast.info(t('versionUploading', { name: f.name, version: shown }))
    const key = await uploadVersion(f, {
      mediaId: media.id,
      formatKey: format.key,
      label: format.label,
      newVersion,
    })
    refresh()
    if (key !== null) {
      toast.done(t('versionAdded', { version: shown }))
      onCreated(key)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('newVersionTitle')}
      description={t('newVersionBody', { format: format.label })}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" icon={Upload} disabled={!ready} onClick={() => file.current?.click()}>
            {t('chooseFile')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {groups.length > 0 && (
          <Field label={t('whatDiffers')}>
            {() => (
              <Segmented
                stretch
                value={mode}
                onChange={setMode}
                options={[
                  ...groups.map((g) => ({ value: g.key, label: groupName(g) })),
                  { value: '__new', label: t('somethingElse') },
                ]}
              />
            )}
          </Field>
        )}
        {creatingGroup && presets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="t-caption text-ink-3">{t('presets')}</span>
            {presets.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGroupLabel(p.group)
                  setCurrent(p.current)
                  setName(p.next)
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        )}
        {creatingGroup && (
          <Field label={t('groupName')} hint={t('groupNameHint')}>
            {(fid) => (
              <Input
                id={fid}
                value={groupLabel}
                placeholder={t('groupNamePlaceholder')}
                onChange={(e) => setGroupLabel(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field
          label={t('versionName')}
          error={taken ? t('optionTaken', { option: label }) : undefined}
          hint={result ? t('newVersionResult', { version: result }) : undefined}
        >
          {(fid) => (
            <Input
              id={fid}
              autoFocus
              value={name}
              placeholder={creatingGroup ? t('versionNamePlaceholderNew') : t('versionNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ready && file.current?.click()}
            />
          )}
        </Field>
        {creatingGroup && (
          <Field
            label={groups.length ? t('currentVersionsName') : t('currentVersionName')}
            hint={groups.length ? t('currentVersionsHint') : t('currentVersionHint')}
          >
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

/** Asks for a name (renaming a track or a group, naming a new track). */
export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  initial = '',
  confirmLabel,
  confirmIcon,
  allowEmpty,
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
  /** An empty name is a choice too (an unnamed group). */
  allowEmpty?: boolean
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
  const ok = allowEmpty || !!value.trim()
  const done = () => {
    if (!ok) return
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
          <Button variant="primary" icon={confirmIcon} disabled={!ok} onClick={done}>
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
