import type { Project, ProjectKind } from '@greenlit/shared'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownUp, FolderPlus, FolderSearch, SwatchBook } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useProjects } from '@/data/projects'
import { api } from '@/lib/api'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { stagger } from '@/lib/motion'
import { qk } from '@/lib/query'
import { can, useSession } from '@/lib/session'
import { Button, EmptyState, Menu, Page, PageHeader, SearchInput, Segmented, Skeleton } from '@/ui'
import { useProjectActions } from './actions'
import { NewProjectDialog } from './NewProjectDialog'
import { ProjectCard } from './ProjectCard'

type Sort = 'updated' | 'name' | 'size' | 'media'

export default function ProjectsPage() {
  const t = useT('projects')
  const me = useSession()
  const [params, setParams] = useSearchParams()
  const scope = params.get('show') === 'archived' ? 'archived' : 'active'
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('updated')
  const [creating, setCreating] = useState<ProjectKind | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const active = useProjects()
  const all = useQuery({
    queryKey: [...qk.projects, 'archived'],
    queryFn: () => api.get<Project[]>('/projects', { archived: true }),
    enabled: scope === 'archived',
  })
  const actions = useProjectActions({ onRename: setRenaming })
  const manage = can(me, 'projects.manage') && !me.viaShareLink
  useHotkey('n', () => manage && setCreating('project'))
  // ⌘K "New project" lands here with ?new=1 (?new=brand for a brand kit)
  useEffect(() => {
    const asked = params.get('new')
    if (asked && manage) {
      setCreating(asked === 'brand' ? 'brand' : 'project')
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('new')
          return next
        },
        { replace: true },
      )
    }
  }, [params, manage, setParams])

  const source = scope === 'archived' ? (all.data ?? []).filter((p) => p.archivedAt) : (active.data ?? [])
  const loading = scope === 'archived' ? all.isLoading : active.isLoading
  const list = useMemo(() => {
    const words = q.trim().toLowerCase()
    const out = source.filter(
      (p) => !words || p.name.toLowerCase().includes(words) || p.description.toLowerCase().includes(words),
    )
    const by: Record<Sort, (a: Project, b: Project) => number> = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.sizeBytes - a.sizeBytes,
      media: (a, b) => b.mediaCount - a.mediaCount,
    }
    return out.sort(by[sort])
  }, [source, q, sort])
  // Brand kits sit above the work, in their own group.
  const kits = list.filter((p) => p.kind === 'brand')
  const work = list.filter((p) => p.kind !== 'brand')
  const card = (p: Project, i: number) => (
    <motion.div key={p.id} {...stagger(i)}>
      <ProjectCard
        project={p}
        menu={() => actions.menu(p)}
        renaming={renaming === p.id}
        onStopRename={() => setRenaming(null)}
        onRename={(name) => {
          setRenaming(null)
          if (name !== p.name) void actions.patch(p, { name })
        }}
      />
    </motion.div>
  )

  return (
    <Page>
      <PageHeader
        title={t('title')}
        meta={
          !loading && (
            <span className="tabular">
              {t('count', { count: source.filter((p) => p.kind !== 'brand').length })}
              {source.some((p) => p.kind === 'brand') &&
                ` · ${t('kitCount', { count: source.filter((p) => p.kind === 'brand').length })}`}
            </span>
          )
        }
        actions={
          manage && (
            <>
              <Button variant="secondary" icon={SwatchBook} onClick={() => setCreating('brand')}>
                {t('newKit')}
              </Button>
              <Button variant="primary" icon={FolderPlus} onClick={() => setCreating('project')} kbd="n">
                {t('new')}
              </Button>
            </>
          )
        }
        toolbar={
          <>
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder={t('search')}
              className="w-full max-w-[320px]"
            />
            <Segmented
              value={scope}
              onChange={(v) => setParams(v === 'active' ? {} : { show: v }, { replace: true })}
              options={[
                { value: 'active', label: t('active') },
                { value: 'archived', label: t('archived') },
              ]}
            />
            <span className="flex-1" />
            <Menu
              align="end"
              width={200}
              trigger={
                <Button variant="ghost" icon={ArrowDownUp}>
                  {t(`sort.${sort}`)}
                </Button>
              }
              items={(['updated', 'name', 'media', 'size'] as Sort[]).map((s) => ({
                label: t(`sort.${s}`),
                checked: s === sort,
                onSelect: () => setSort(s),
              }))}
            />
          </>
        }
      />

      {loading ? (
        <Grid>
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <div key={i}>
              <Skeleton className="aspect-[16/10] w-full rounded-tile" />
              <Skeleton className="mt-3 h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          ))}
        </Grid>
      ) : list.length === 0 ? (
        q ? (
          <EmptyState icon={FolderSearch} title={t('empty.noResults', { q })} />
        ) : scope === 'archived' ? (
          <EmptyState title={t('empty.archivedTitle')} body={t('empty.archivedBody')} />
        ) : (
          <EmptyState
            icon={FolderPlus}
            title={t('empty.title')}
            body={manage ? t('empty.body') : t('empty.readonly')}
            action={
              manage && (
                <Button variant="primary" icon={FolderPlus} onClick={() => setCreating('project')}>
                  {t('new')}
                </Button>
              )
            }
          />
        )
      ) : kits.length ? (
        <>
          <GroupTitle>{t('kits')}</GroupTitle>
          <Grid>{kits.map(card)}</Grid>
          {work.length > 0 && (
            <>
              <GroupTitle className="mt-12">{t('title')}</GroupTitle>
              <Grid>{work.map((p, i) => card(p, i + kits.length))}</Grid>
            </>
          )}
        </>
      ) : (
        <Grid>{work.map(card)}</Grid>
      )}
      <NewProjectDialog
        open={creating !== null}
        kind={creating ?? 'project'}
        onOpenChange={(o) => !o && setCreating(null)}
      />
      {actions.dialogs}
    </Page>
  )
}

function GroupTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`mb-4 t-headline text-ink-2 ${className ?? ''}`}>{children}</h2>
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-x-6 gap-y-9">
      {children}
    </div>
  )
}
