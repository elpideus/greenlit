import { aspectLabel, FORMAT_PRESETS, type Media, type MediaFormat } from '@greenlit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Pencil, Plus, RefreshCw, Star, Trash2, Upload } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { useId, useRef, useState } from 'react'
import { uploadMedia } from '@/data/media'
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
  IconButton,
  InlineEdit,
  Input,
  Menu,
  type MenuEntry,
  ProgressRing,
  toast,
  useContextMenu,
} from '@/ui'

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'format'
  )
}

/**
 * The formats of one item as a segmented strip: one media, several shapes (16:9 main, 9:16 vertical, 1:1…).
 * Right-click a format to rename it, make it main, replace its file, download or remove it; "+" adds another.
 */
export function FormatSwitcher({
  media,
  format,
  onSelect,
}: {
  media: Media
  format: MediaFormat
  onSelect: (key: string) => void
}) {
  const t = useT('viewer')
  const qc = useQueryClient()
  const id = useId()
  const canEdit = useCan('media.edit')
  const canUpload = useCan('media.upload')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [custom, setCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const pending = useRef<{ key: string; label: string; replace?: boolean } | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
    void qc.invalidateQueries({ queryKey: qk.media() })
  }

  const patch = async (f: MediaFormat, body: Record<string, unknown>) => {
    try {
      await api.patch(`/media/${media.id}/formats/${f.id}`, body)
      refresh()
    } catch (err) {
      toast.error(err)
    }
  }

  const pick = (key: string, label: string, replace = false) => {
    pending.current = { key, label, replace }
    file.current?.click()
  }

  const onFile = async (files: File[]) => {
    const p = pending.current
    if (!p || !files[0]) return
    toast.info(
      p.replace
        ? t('fileReplaced', { format: p.label })
        : t('formatUploading', { name: files[0].name, format: p.label }),
    )
    const ids = await uploadMedia([files[0]], { mediaId: media.id, formatKey: p.key, label: p.label })
    refresh()
    if (ids.length && !p.replace) {
      toast.done(t('formatAdded', { format: p.label }))
      onSelect(p.key)
    }
  }

  const used = new Set(media.formats.map((f) => f.key))
  const presets = FORMAT_PRESETS.filter((p) => !used.has(p.key))

  return (
    <LayoutGroup id={id}>
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-0.5 rounded-control bg-white/6 p-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]">
          {media.formats.map((f) => (
            <FormatChip
              key={f.id}
              media={media}
              format={f}
              active={f.id === format.id}
              renaming={renaming === f.id}
              onRenaming={(r) => setRenaming(r ? f.id : null)}
              onSelect={() => onSelect(f.key)}
              onRename={(label) => patch(f, { label })}
              menu={(): MenuEntry[] => [
                canEdit && { label: t('renameFormat'), icon: Pencil, onSelect: () => setRenaming(f.id) },
                canEdit &&
                  !f.isPrimary && {
                    label: t('makeMain'),
                    icon: Star,
                    onSelect: () => patch(f, { isPrimary: true }),
                  },
                'separator',
                canUpload && {
                  label: t('replaceFile'),
                  icon: RefreshCw,
                  onSelect: () => pick(f.key, f.label, true),
                },
                {
                  label: t('downloadFormat'),
                  icon: Download,
                  onSelect: () => window.open(f.urls.download, '_self'),
                },
                canEdit && media.formats.length > 1 && 'separator',
                canEdit &&
                  media.formats.length > 1 && {
                    label: t('removeFormat'),
                    icon: Trash2,
                    danger: true,
                    onSelect: async () => {
                      if (
                        !(await confirm({
                          title: t('removeFormatConfirm', { format: f.label }),
                          body: t('removeFormatBody'),
                          confirm: t('removeFormat'),
                          danger: true,
                        }))
                      )
                        return
                      try {
                        await api.delete(`/media/${media.id}/formats/${f.id}`)
                        toast.done(t('formatRemoved', { format: f.label }))
                        if (f.id === format.id) onSelect(media.formats.find((x) => x.id !== f.id)!.key)
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
        {canUpload && (
          <Menu
            align="start"
            width={232}
            trigger={<IconButton icon={Plus} label={t('addFormat')} size="sm" />}
            items={[
              { group: t('addFormat') },
              ...presets
                .filter((p) => p.key !== 'main')
                .map((p) => ({ label: p.label, icon: Upload, onSelect: () => pick(p.key, p.label) })),
              'separator',
              { label: t('customFormat'), icon: Plus, onSelect: () => setCustom(true) },
            ]}
          />
        )}
        <input
          ref={file}
          type="file"
          hidden
          accept={media.kind === 'image' ? 'image/*' : media.kind === 'video' ? 'video/*' : undefined}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            void onFile(files)
          }}
        />
      </div>
      <Dialog
        open={custom}
        onOpenChange={setCustom}
        title={t('customFormat')}
        width={380}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCustom(false)}>
              {t('common:cancel')}
            </Button>
            <Button
              variant="primary"
              icon={Upload}
              disabled={!customName.trim()}
              onClick={() => {
                setCustom(false)
                pick(slug(customName), customName.trim())
                setCustomName('')
              }}
            >
              {t('common:upload')}
            </Button>
          </>
        }
      >
        <Field label={t('renameFormat')}>
          {(fid) => (
            <Input
              id={fid}
              autoFocus
              value={customName}
              placeholder="Story 9:16, Banner 3:1…"
              onChange={(e) => setCustomName(e.target.value)}
            />
          )}
        </Field>
      </Dialog>
    </LayoutGroup>
  )
}

function FormatChip({
  media,
  format: f,
  active,
  renaming,
  onRenaming,
  onSelect,
  onRename,
  menu,
}: {
  media: Media
  format: MediaFormat
  active: boolean
  renaming: boolean
  onRenaming: (r: boolean) => void
  onSelect: () => void
  onRename: (label: string) => void
  menu: () => MenuEntry[]
}) {
  const ctx = useContextMenu(menu)
  const aspect = aspectLabel(f.width, f.height)
  const busy = f.processing.state === 'pending' || f.processing.state === 'processing'
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
      title={media.formats.length > 1 ? f.filename : undefined}
    >
      {active && (
        <motion.span
          layoutId="format-pill"
          transition={spring.snap}
          className="absolute inset-0 -z-10 rounded-[calc(var(--r-control)-3px)] bg-white/14 shadow-[inset_0_0_0_.5px_rgba(255,255,255,.14),inset_0_1px_0_rgba(255,255,255,.08)]"
        />
      )}
      {busy && <ProgressRing value={f.processing.progress} size={12} className="text-signal" />}
      <InlineEdit
        value={f.label}
        onSave={onRename}
        editing={renaming}
        onEditingChange={onRenaming}
        tooltip={null}
        className="max-w-[140px]"
      />
      {aspect && <span className="t-meta text-[10.5px] text-white/40">{aspect}</span>}
      {f.isPrimary && media.formats.length > 1 && (
        <span className="size-1 rounded-full bg-signal" role="img" aria-label="Main" />
      )}
    </button>
  )
}
