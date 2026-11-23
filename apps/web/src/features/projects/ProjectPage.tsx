import type { Project } from '@greenlit/shared'
import { ChevronLeft, MapPin, MoreHorizontal, Upload } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Slot, useSlot } from '@/app/Slot'
import { MediaBrowser } from '@/components/library'
import { PeoplePicker } from '@/components/PeoplePicker'
import { uploadMedia } from '@/data/media'
import { useProject } from '@/data/projects'
import { useFileDrop } from '@/lib/dom'
import { formatBytes } from '@/lib/format'
import { i18next, useT } from '@/lib/i18n'
import { rise } from '@/lib/motion'
import { can, useSession } from '@/lib/session'
import { formatDate, formatRelative, useTimeZone } from '@/lib/time'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  InlineEdit,
  openContextMenu,
  Page,
  Row,
  Section,
  Skeleton,
  Tabs,
  Textarea,
  toast,
} from '@/ui'
import { useProjectActions } from './actions'
import { Meta } from './Meta'

export default function ProjectPage() {
  const { id = '' } = useParams()
  const t = useT('projects')
  const navigate = useNavigate()
  const { data: project, isLoading, error, refetch } = useProject(id)
  if (isLoading)
    return (
      <Page>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-4 h-8 w-80" />
        <Skeleton className="mt-3 h-4 w-[28rem]" />
      </Page>
    )
  if (error || !project)
    return (
      <Page>
        {(error as { status?: number } | null)?.status === 404 || !project ? (
          <EmptyState
            title={t('page.notFound')}
            body={t('page.notFoundBody')}
            action={<Button onClick={() => navigate('/projects')}>{t('page.back')}</Button>}
          />
        ) : (
          <ErrorState error={error} retry={() => void refetch()} />
        )}
      </Page>
    )
  return <ProjectView project={project} />
}

function ProjectView({ project: p }: { project: Project }) {
  const t = useT('projects')
  const me = useSession()
  const tz = useTimeZone()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [renaming, setRenaming] = useState(false)
  const actions = useProjectActions({
    onRename: () => setRenaming(true),
    afterDelete: () => navigate('/projects'),
  })
  const manage = can(me, 'projects.manage') && !me.viaShareLink
  const canUpload = can(me, 'media.upload') && !me.viaShareLink
  const extraTabs = useSlot('project.tabs', { project: p })
  const tab = params.get('tab') ?? 'media'
  const fileInput = useRef<HTMLInputElement>(null)

  const setTab = (v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams()
        if (v !== 'media') next.set('tab', v)
        // keep the media browser's view when coming back
        if (v === 'media') for (const k of ['q', 'sort', 'view']) if (prev.get(k)) next.set(k, prev.get(k)!)
        return next
      },
      { replace: true },
    )

  const upload = async (files: File[]) => {
    if (!files.length) return
    toast.info(files.length === 1 ? files[0]!.name : `${files.length}`)
    const ids = await uploadMedia(files, { projectId: p.id })
    if (ids.length) toast.done(t('done.saved'))
  }
  // On the Media tab the browser takes drops itself; elsewhere the page does.
  useFileDrop((files) => void upload(files), { enabled: canUpload && tab !== 'media' })

  useEffect(() => {
    document.title = p.name
  }, [p.name])

  const tabs = [
    { value: 'media', label: t('page.tabs.media'), count: p.mediaCount },
    ...extraTabs.map((e) => ({
      value: e.id,
      label: i18next.t(`${e.feature}:${e.label ?? e.id}`, { defaultValue: e.label ?? e.id }),
    })),
    { value: 'about', label: t('page.tabs.about') },
  ]
  const ExtraTab = extraTabs.find((e) => e.id === tab)?.component

  return (
    <Page>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void upload(files)
        }}
      />
      <Link
        to="/projects"
        className="press -ml-1 inline-flex h-7 items-center gap-0.5 rounded-control pr-2 pl-0.5 t-callout text-ink-3 hover:bg-hover hover:text-ink"
      >
        <ChevronLeft size={16} />
        {t('page.back')}
      </Link>

      <header className="mt-2 mb-6 flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            {p.color && <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} />}
            <h1 className="t-title-1 min-w-0 text-ink">
              <InlineEdit
                value={p.name}
                editing={renaming}
                onEditingChange={setRenaming}
                disabled={!manage}
                onSave={(name) => void actions.patch(p, { name })}
                className="block"
              />
            </h1>
          </div>
          <Description
            project={p}
            editable={manage}
            onSave={(description) => void actions.patch(p, { description })}
          />
          <Meta className="mt-3 t-callout text-ink-3">
            <span className="tabular">{t('media', { count: p.mediaCount })}</span>
            {p.compositionCount > 0 && (
              <span className="tabular">{t('edits', { count: p.compositionCount })}</span>
            )}
            {p.sizeBytes > 0 && <span className="tabular">{formatBytes(p.sizeBytes)}</span>}
            {p.places.length > 0 && (
              <span className="flex items-center gap-1">
                <MapPin size={12} />
                {p.places.map((pl) => pl.name).join(', ')}
              </span>
            )}
            <span>{t('updated', { when: formatRelative(p.updatedAt, tz) })}</span>
            {p.archivedAt && <span className="text-review">{t('archivedBadge')}</span>}
          </Meta>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {canUpload && (
            <Button variant="primary" icon={Upload} onClick={() => fileInput.current?.click()}>
              {t('page.upload')}
            </Button>
          )}
          <IconButton
            icon={MoreHorizontal}
            label="More"
            variant="secondary"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              openContextMenu(r.right - 220, r.bottom + 6, actions.menu(p))
            }}
          />
        </div>
      </header>

      <div className="mb-5 border-b border-line">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </div>

      {tab === 'media' && <MediaBrowser projectId={p.id} projectName={p.name} allowTrash={false} />}
      {ExtraTab && (
        <motion.div key={tab} {...rise}>
          <ExtraTab project={p} />
        </motion.div>
      )}
      {tab === 'about' && <About project={p} manage={manage} patch={(b) => void actions.patch(p, b)} />}
      {actions.dialogs}
    </Page>
  )
}

/** The description under the title: reads as text, becomes a field on click (for people who can edit it). */
function Description({
  project: p,
  editable,
  onSave,
}: {
  project: Project
  editable: boolean
  onSave: (v: string) => void
}) {
  const t = useT('projects')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.description)
  useEffect(() => setDraft(p.description), [p.description])
  if (editing)
    return (
      <Textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft !== p.description) onSave(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(p.description)
            setEditing(false)
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
        }}
        className="mt-2 max-w-[68ch]"
        rows={2}
      />
    )
  if (!p.description && !editable) return null
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => setEditing(true)}
      className="-mx-1.5 mt-1.5 block max-w-[68ch] rounded-control px-1.5 py-0.5 text-left t-body text-ink-2 enabled:hover:bg-hover"
    >
      {p.description ? (
        <span className="line-clamp-3 whitespace-pre-line">{p.description}</span>
      ) : (
        <span className="text-ink-3">{t('page.describe')}</span>
      )}
    </button>
  )
}

function About({
  project: p,
  manage,
  patch,
}: {
  project: Project
  manage: boolean
  patch: (b: Record<string, unknown>) => void
}) {
  const t = useT('projects')
  const tz = useTimeZone()
  const me = useSession()
  const [desc, setDesc] = useState(p.description)
  useEffect(() => setDesc(p.description), [p.description])
  return (
    <motion.div
      {...rise}
      className="grid max-w-[1100px] grid-cols-1 gap-x-10 lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div>
        <Section title={t('about.description')}>
          {manage ? (
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() => desc !== p.description && patch({ description: desc })}
              placeholder={t('create.descriptionPlaceholder')}
              rows={5}
            />
          ) : (
            <p className="t-body whitespace-pre-line text-ink-2">{p.description || '—'}</p>
          )}
        </Section>
        <Slot name="project.about.sections" props={{ project: p }} />
      </div>
      <div>
        {me.role === 'admin' && (
          <Section title={t('about.visibility')} description={t('about.hiddenFromHint')}>
            <PeoplePicker
              only="reviewer"
              value={p.hiddenFrom ?? []}
              onChange={(ids) => patch({ hiddenFrom: ids })}
              placeholder={t('about.everyone')}
            />
          </Section>
        )}
        <Section title={t('about.details')}>
          <Card>
            <Row label={t('about.media')}>
              <span className="t-meta text-ink-2">{p.mediaCount}</span>
            </Row>
            <Row label={t('about.size')}>
              <span className="t-meta text-ink-2">{formatBytes(p.sizeBytes)}</span>
            </Row>
            <Row label={t('about.created')}>
              <span className="t-callout text-ink-2">{formatDate(p.createdAt, tz)}</span>
            </Row>
            {p.createdBy && (
              <Row label={t('about.by')}>
                <span className="flex items-center gap-2 t-callout text-ink-2">
                  <Avatar user={p.createdBy} size={20} />
                  {p.createdBy.displayName}
                </span>
              </Row>
            )}
          </Card>
        </Section>
      </div>
    </motion.div>
  )
}
