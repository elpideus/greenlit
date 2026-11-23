import type { Platform, Post } from '@greenlit/shared'
import { CalendarDays, List, Plus, Send } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { PLATFORM_NAME, PlatformIcon } from '@/components/PlatformIcon'
import { useAccounts } from '@/data/accounts'
import { useProjects } from '@/data/projects'
import { cn } from '@/lib/cn'
import { useIsPhone, useStoredState } from '@/lib/dom'
import { useT } from '@/lib/i18n'
import { stagger } from '@/lib/motion'
import { useCan } from '@/lib/session'
import {
  Button,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  Tooltip,
} from '@/ui'
import { usePosts } from './api'
import { pickAndLaunchPost } from './launcher'
import { PLATFORM_ORDER } from './model'
import { PostRow } from './parts'

type StatusFilter = 'all' | 'draft' | 'scheduled' | 'published' | 'failed'

const groupOf = (p: Post): 'attention' | 'upNext' | 'publishing' | 'drafts' | 'published' => {
  if (p.status === 'failed' || p.status === 'partial') return 'attention'
  if (p.status === 'scheduled') return 'upNext'
  if (p.status === 'publishing') return 'publishing'
  if (p.status === 'published') return 'published'
  return 'drafts'
}

export default function PostsPage() {
  const t = useT('posts')
  const navigate = useNavigate()
  const canEdit = useCan('posts.edit')
  const { data: posts, isLoading, error, refetch } = usePosts()
  const { data: accounts = [] } = useAccounts()
  const { data: projects = [] } = useProjects()
  const [status, setStatus] = useStoredState<StatusFilter>('posts.status', 'all')
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [account, setAccount] = useState('all')
  const [project, setProject] = useState('all')
  const [q, setQ] = useState('')
  const phone = useIsPhone()

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (posts ?? []).filter((p) => {
      if (status === 'draft' && p.status !== 'draft') return false
      if (status === 'scheduled' && p.status !== 'scheduled') return false
      if (status === 'published' && p.status !== 'published') return false
      if (status === 'failed' && !['failed', 'partial'].includes(p.status)) return false
      const live = p.targets.filter((x) => x.state !== 'removed')
      if (platforms.length && !live.some((x) => platforms.includes(x.platform))) return false
      if (account !== 'all' && !live.some((x) => x.accountId === account)) return false
      if (project !== 'all' && p.projectId !== project) return false
      if (
        needle &&
        !`${p.name} ${p.title} ${p.caption} ${p.hashtags.join(' ')}`.toLowerCase().includes(needle)
      )
        return false
      return true
    })
  }, [posts, status, platforms, account, project, q])

  const groups = useMemo(() => {
    const order = ['attention', 'upNext', 'publishing', 'drafts', 'published'] as const
    const by = new Map<string, Post[]>()
    for (const p of filtered) by.set(groupOf(p), [...(by.get(groupOf(p)) ?? []), p])
    const time = (p: Post) => new Date(p.scheduleAt ?? p.updatedAt).getTime()
    by.get('upNext')?.sort((a, b) => time(a) - time(b))
    by.get('published')?.sort((a, b) => time(b) - time(a))
    return order.filter((g) => by.has(g)).map((g) => ({ id: g, posts: by.get(g)! }))
  }, [filtered])

  const counts = useMemo(() => {
    const all = posts ?? []
    return {
      scheduled: all.filter((p) => p.status === 'scheduled').length,
      drafts: all.filter((p) => p.status === 'draft').length,
      attention: all.filter((p) => p.status === 'failed' || p.status === 'partial').length,
    }
  }, [posts])

  const usedAccounts = accounts.filter((a) => !a.mergedInto)
  const anyFilter = status !== 'all' || platforms.length > 0 || account !== 'all' || project !== 'all' || q

  return (
    <Page>
      <PageHeader
        title={t('title')}
        meta={
          posts && (
            <>
              <span className="whitespace-nowrap">{t('meta.scheduled', { count: counts.scheduled })}</span>
              <span className="text-ink-4">·</span>
              <span className="whitespace-nowrap">{t('meta.drafts', { count: counts.drafts })}</span>
              {counts.attention > 0 && (
                <>
                  <span className="text-ink-4">·</span>
                  <span className="text-cut">{t('meta.attention', { count: counts.attention })}</span>
                </>
              )}
            </>
          )
        }
        actions={
          <>
            <Segmented
              value="list"
              onChange={(v) => v === 'calendar' && navigate('/calendar')}
              options={[
                { value: 'list', label: phone ? undefined : t('list'), icon: List, title: t('list') },
                {
                  value: 'calendar',
                  label: phone ? undefined : t('calendar'),
                  icon: CalendarDays,
                  title: t('calendar'),
                },
              ]}
            />
            {canEdit && (
              <Button variant="primary" icon={Plus} onClick={() => pickAndLaunchPost(null)}>
                {t('newPost')}
              </Button>
            )}
          </>
        }
        toolbar={
          <>
            <div className="no-scrollbar -mx-[var(--gutter)] max-w-[100vw] overflow-x-auto px-[var(--gutter)] sm:mx-0 sm:px-0">
              <Segmented
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: t('filter.all') },
                  { value: 'draft', label: t('filter.draft') },
                  { value: 'scheduled', label: t('filter.scheduled') },
                  { value: 'published', label: t('filter.published') },
                  { value: 'failed', label: t('filter.failed') },
                ]}
              />
            </div>
            <div className="flex items-center gap-0.5 rounded-control bg-well p-[3px] shadow-[inset_0_0_0_1px_var(--line)]">
              {PLATFORM_ORDER.map((p) => {
                const on = platforms.includes(p)
                return (
                  <Tooltip key={p} label={PLATFORM_NAME[p]}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPlatforms((xs) => (on ? xs.filter((x) => x !== p) : [...xs, p]))}
                      className={cn(
                        'press grid h-[26px] w-8 place-items-center rounded-[calc(var(--r-control)-3px)] transition-[background-color,opacity] duration-150',
                        on
                          ? 'bg-raised shadow-[0_1px_2px_rgba(0,0,0,.18),inset_0_0_0_.5px_var(--line-strong)]'
                          : platforms.length
                            ? 'opacity-40 hover:opacity-80'
                            : 'opacity-75 hover:opacity-100',
                      )}
                    >
                      <PlatformIcon platform={p} size={15} />
                    </button>
                  </Tooltip>
                )
              })}
            </div>
            {usedAccounts.length > 1 && (
              <Select
                size="md"
                value={account}
                onChange={setAccount}
                className="w-48"
                options={[
                  { value: 'all', label: t('filter.allAccounts') },
                  ...usedAccounts.map((a) => ({
                    value: a.id,
                    label: a.name,
                    icon: <PlatformIcon platform={a.platform} size={14} />,
                  })),
                ]}
              />
            )}
            {projects.length > 0 && (
              <Select
                value={project}
                onChange={setProject}
                className="w-48"
                options={[
                  { value: 'all', label: t('filter.allProjects') },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            )}
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder={t('filter.search')}
              className="w-full sm:ml-auto sm:w-60"
            />
          </>
        }
      />

      {error ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <div key={i} className="flex items-center gap-4 px-2.5 py-2.5">
              <Skeleton className="aspect-[4/3] w-[92px] rounded-tile" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-5 w-40" />
              </div>
            </div>
          ))}
        </div>
      ) : !filtered.length ? (
        anyFilter ? (
          <EmptyState icon={Send} title={t('empty.filtered')} body={t('empty.filteredBody')} />
        ) : (
          <EmptyState
            icon={Send}
            title={t('empty.title')}
            body={t('empty.body')}
            action={
              canEdit && (
                <Button variant="primary" icon={Plus} onClick={() => pickAndLaunchPost(null)}>
                  {t('newPost')}
                </Button>
              )
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.id}>
              <div className="mb-1.5 flex items-baseline gap-2 px-2.5">
                <h2 className={cn('t-headline', g.id === 'attention' ? 'text-cut' : 'text-ink')}>
                  {t(`group.${g.id}`)}
                </h2>
                <span className="t-meta text-ink-3">{g.posts.length}</span>
              </div>
              <div className="-mx-0 flex flex-col">
                {g.posts.map((p, i) => (
                  <motion.div key={p.id} {...stagger(i)}>
                    <PostRow post={p} accounts={accounts} />
                  </motion.div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
