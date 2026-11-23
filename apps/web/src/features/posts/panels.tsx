import type { Media, Project } from '@greenlit/shared'
import { Plus, Send } from 'lucide-react'
import { useAccounts } from '@/data/accounts'
import { useT } from '@/lib/i18n'
import { useCan } from '@/lib/session'
import { Button, EmptyState, Skeleton } from '@/ui'
import { usePosts } from './api'
import { launchPost, pickAndLaunchPost } from './launcher'
import { PostRow } from './parts'

/** Viewer side panel: the posts that use this media item. */
export function MediaPostsPanel({ media }: { media: Media }) {
  const t = useT('posts')
  const canEdit = useCan('posts.edit')
  const { data: posts, isLoading } = usePosts({ mediaId: media.id })
  const { data: accounts = [] } = useAccounts()
  if (isLoading)
    return (
      <div className="space-y-2 p-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    )
  return (
    <div className="flex flex-col gap-1 p-1">
      {posts?.length ? (
        <>
          {posts.map((p) => (
            <PostRow key={p.id} post={p} accounts={accounts} className="[&>div:first-child]:w-[64px]" />
          ))}
          {canEdit && (
            <Button
              variant="ghost"
              icon={Plus}
              className="mt-2 self-start"
              onClick={() => launchPost([media.id], media.projectId)}
            >
              {t('newPost')}
            </Button>
          )}
        </>
      ) : (
        <EmptyState
          compact
          icon={Send}
          title={t('panel.none')}
          body={t('panel.noneBody')}
          action={
            canEdit && (
              <Button variant="primary" icon={Plus} onClick={() => launchPost([media.id], media.projectId)}>
                {t('createPost')}
              </Button>
            )
          }
        />
      )}
    </div>
  )
}

/** Project page tab: the project's posts. */
export function ProjectPostsTab({ project }: { project: Project }) {
  const t = useT('posts')
  const canEdit = useCan('posts.edit')
  const { data: posts, isLoading } = usePosts({ projectId: project.id })
  const { data: accounts = [] } = useAccounts()
  return (
    <div>
      {canEdit && posts && posts.length > 0 && (
        <div className="mb-3 flex justify-end">
          <Button icon={Plus} onClick={() => pickAndLaunchPost(project.id)}>
            {t('newPost')}
          </Button>
        </div>
      )}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[88px] rounded-panel" />
          ))}
        </div>
      ) : posts?.length ? (
        <div className="-mx-2.5 flex flex-col">
          {posts.map((p) => (
            <PostRow key={p.id} post={p} accounts={accounts} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Send}
          title={t('panel.noneProject')}
          body={t('empty.body')}
          action={
            canEdit && (
              <Button variant="primary" icon={Plus} onClick={() => pickAndLaunchPost(project.id)}>
                {t('newPost')}
              </Button>
            )
          }
        />
      )}
    </div>
  )
}
