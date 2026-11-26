import { ArrowLeft, Bookmark, Eye, Layers, MoreHorizontal, Send } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { menuEntries } from '@/app/registry'
import { PlatformIcon } from '@/components/PlatformIcon'
import { useAccounts } from '@/data/accounts'
import { cn } from '@/lib/cn'
import { useIsPhone, useMediaQuery } from '@/lib/dom'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { rise, spring } from '@/lib/motion'
import { can, useSession } from '@/lib/session'
import {
  Button,
  Dialog,
  ErrorState,
  IconButton,
  InlineEdit,
  Input,
  openContextMenu,
  Sheet,
  Signal,
  Skeleton,
  Tally,
  Tooltip,
  toast,
} from '@/ui'
import { usePost, usePostCheck } from '../api'
import { postMenuOwnItems } from '../menus'
import { sortTargets, specOf } from '../model'
import { postTone, targetTone, useWhere } from '../parts'
import { DestinationsSection } from './DestinationsSection'
import { MediaSection } from './MediaSection'
import { PreviewPane } from './PreviewPane'
import { PublishDialog } from './PublishDialog'
import { SharedScheduleSection, TargetScheduleSection } from './ScheduleSection'
import { SoundSection } from './SoundSection'
import { ComposerContext, useComposer, useComposerState } from './state'
import {
  CoverSection,
  ExtrasSection,
  FormatsSection,
  formatFor,
  OptionsSection,
  TargetHeader,
} from './TargetSections'
import { SharedTextSection, TargetTextSection } from './TextSection'
import { TranslationsSection } from './TranslationsSection'

export default function ComposerPage() {
  const { id } = useParams()
  const t = useT('posts')
  const me = useSession()
  const { data: post, error, refetch } = usePost(id)
  const { data: accounts } = useAccounts()
  const { data: checks = [] } = usePostCheck(id, post?.updatedAt ?? '')
  if (error) return <ErrorState error={error} retry={() => void refetch()} />
  if (!post || !accounts)
    return (
      <div className="flex h-dvh flex-col">
        <div className="h-[var(--bar-h)] shadow-[0_1px_0_var(--line)]" />
        <div className="mx-auto w-full max-w-[760px] space-y-4 px-8 pt-10">
          <Skeleton className="h-40 rounded-panel" />
          <Skeleton className="h-56 rounded-panel" />
          <Skeleton className="h-72 rounded-panel" />
        </div>
      </div>
    )
  return (
    <Composer
      key={post.id}
      post={post}
      accounts={accounts}
      checks={checks}
      editable={can(me, 'posts.edit')}
      t={t}
    />
  )
}

function Composer(props: {
  post: NonNullable<ReturnType<typeof usePost>['data']>
  accounts: NonNullable<ReturnType<typeof useAccounts>['data']>
  checks: NonNullable<ReturnType<typeof usePostCheck>['data']>
  editable: boolean
  t: ReturnType<typeof useT>
}) {
  const composer = useComposerState(props.post, props.accounts, props.editable, props.checks)
  return (
    <ComposerContext.Provider value={composer}>
      <ComposerLayout />
    </ComposerContext.Provider>
  )
}

function ComposerLayout() {
  const t = useT('posts')
  const c = useComposer()
  const me = useSession()
  const phone = useIsPhone()
  const wide = useMediaQuery('(min-width: 1100px)')
  const [publishing, setPublishing] = useState(false)
  const [naming, setNaming] = useState(false)
  const [versionName, setVersionName] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const canPublish = can(me, 'posts.publish')
  useHotkey('mod+s', () => void c.save(), { allowInInputs: true })

  const name = c.draft.name
  const status = c.post.status
  const target = c.draft.targets.find((x) => x.key === c.selected)
  const menu = () =>
    menuEntries('post', { post: c.post, me }, [
      ...postMenuOwnItems(c.post, me, t).filter((g) => g.order !== 0),
      {
        order: 10,
        items: [
          c.editable && { label: t('composer.nameVersion'), icon: Bookmark, onSelect: () => setNaming(true) },
        ],
      },
    ])

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {/* top bar */}
      <header className="material-bar relative z-30 flex h-[var(--bar-h)] shrink-0 items-center gap-3 px-3 shadow-[0_1px_0_var(--line)] sm:px-4">
        <Tooltip label={t('composer.back')}>
          <Link
            to="/posts"
            className="press flex h-8 items-center gap-1.5 rounded-control pr-2.5 pl-1.5 t-callout text-ink-2 hover:bg-hover hover:text-ink"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">{t('composer.back')}</span>
          </Link>
        </Tooltip>
        <span className="h-5 w-px bg-line" />
        <Signal tone={postTone(status)} size={22} />
        <div className="min-w-0 flex-1">
          <InlineEdit
            value={name}
            placeholder={t('composer.namePlaceholder')}
            onSave={(v) => c.update((d) => ({ ...d, name: v }))}
            disabled={!c.editable}
            className="block t-headline text-ink"
            tooltip={null}
          />
          <div className="flex items-center gap-2 t-caption text-ink-3">
            <span>{t(`status.${status}`)}</span>
            <span className="text-ink-4">·</span>
            <SaveIndicator />
          </div>
        </div>
        {!wide &&
          (phone ? (
            <IconButton icon={Eye} label={t('preview.tab')} onClick={() => setPreviewOpen(true)} />
          ) : (
            <Button variant="ghost" icon={Eye} onClick={() => setPreviewOpen(true)}>
              {t('preview.tab')}
            </Button>
          ))}
        <IconButton
          icon={MoreHorizontal}
          label={t('common:more')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openContextMenu(r.right - 220, r.bottom + 6, menu())
          }}
        />
        {canPublish && (
          <Button
            variant="primary"
            icon={Send}
            onClick={() => setPublishing(true)}
            disabled={!c.draft.targets.some((x) => x.enabled)}
            className="max-sm:px-2.5"
          >
            <span className="max-sm:hidden">{t('composer.publish')}</span>
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <TargetTabs />
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 pt-5 pb-28 sm:px-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={c.selected} {...rise} className="flex flex-col gap-4">
                {target ? <TargetEditor targetKey={target.key} /> : <SharedEditor />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
        {wide && (
          <aside className="w-[clamp(380px,32vw,470px)] shrink-0 bg-panel shadow-[inset_1px_0_0_var(--line)]">
            <PreviewPane />
          </aside>
        )}
      </div>

      {!wide && (
        <Sheet
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={t('preview.tab')}
          width={phone ? 420 : 480}
        >
          <PreviewPane />
        </Sheet>
      )}
      <PublishDialog open={publishing} onOpenChange={setPublishing} />
      <Dialog
        open={naming}
        onOpenChange={setNaming}
        title={t('composer.nameVersion')}
        width={400}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNaming(false)}>
              {t('common:cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!versionName.trim()}
              onClick={async () => {
                await c.save({ versionName: versionName.trim() })
                toast.done(t('composer.versionNamed', { name: versionName.trim() }))
                setVersionName('')
                setNaming(false)
              }}
            >
              {t('common:save')}
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={versionName}
          placeholder={t('composer.versionName')}
          onChange={(e) => setVersionName(e.target.value)}
        />
      </Dialog>
    </div>
  )
}

function SaveIndicator() {
  const t = useT('posts')
  const { saveState } = useComposer()
  const text =
    saveState === 'saving'
      ? t('composer.saving')
      : saveState === 'error'
        ? t('composer.saveFailed')
        : saveState === 'idle'
          ? ''
          : t('composer.saved')
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={saveState}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        className={cn(saveState === 'error' && 'text-cut')}
      >
        {text || t('composer.saved')}
      </motion.span>
    </AnimatePresence>
  )
}

/** "Everywhere" + one tab per version, sticky over the editor. */
function TargetTabs() {
  const t = useT('posts')
  const where = useWhere()
  const c = useComposer()
  const targets = useMemo(() => sortTargets(c.draft.targets, c.accounts), [c.draft.targets, c.accounts])
  if (!targets.length) return null
  return (
    <div className="material-bar sticky top-0 z-20 shadow-[0_1px_0_var(--line)]">
      <LayoutGroup id="target-tabs">
        <div className="no-scrollbar mx-auto flex max-w-[760px] items-center gap-1 overflow-x-auto px-4 py-2 sm:px-8">
          <Tab on={c.selected === 'all'} onClick={() => c.select('all')}>
            <Layers size={14} className="text-ink-3" />
            {t('composer.everywhere')}
          </Tab>
          <span className="mx-1 h-4 w-px shrink-0 bg-line" />
          {targets.map((x) => {
            const a = c.accounts.find((acc) => acc.id === x.accountId)
            const server = c.post.targets.find((s) => s.id === x.id)
            // a version turned off goes nowhere: what its platform would say waits until it is on again
            const issues = x.enabled ? (c.checks.find((k) => k.targetId === x.id)?.issues ?? []) : []
            const errors = issues.filter((i) => i.level === 'error').length
            const warnings = issues.filter((i) => i.level === 'warning').length
            return (
              <Tab
                key={x.key}
                on={c.selected === x.key}
                onClick={() => c.select(x.key)}
                dim={!x.enabled}
                title={a ? `${a.name} · ${where(a.platform, x.placement)}` : undefined}
              >
                {a && <PlatformIcon platform={a.platform} size={16} tile />}
                <span>{t(`placement.${x.placement}`)}</span>
                {server && server.state !== 'draft' && <Tally tone={targetTone(server)} size={6} />}
                {errors > 0 ? (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-cut px-1 t-micro text-[10px] text-white">
                    {errors}
                  </span>
                ) : warnings > 0 ? (
                  <span className="size-1.5 rounded-full bg-review" />
                ) : null}
              </Tab>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}

function Tab({
  on,
  onClick,
  children,
  dim,
  title,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  dim?: boolean
  title?: string
}) {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'press relative flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2.5 t-callout',
        on ? 'font-[550] text-ink' : 'text-ink-3 hover:text-ink',
        dim && 'opacity-50',
      )}
    >
      {on && (
        <motion.span
          layoutId="target-tab"
          transition={spring.snap}
          className="absolute inset-0 -z-10 rounded-control bg-raised shadow-[inset_0_0_0_1px_var(--line-strong),var(--shadow-lift)]"
        />
      )}
      {children}
    </button>
  )
  return title ? <Tooltip label={title}>{btn}</Tooltip> : btn
}

function SharedEditor() {
  const t = useT('posts')
  const c = useComposer()
  return (
    <>
      <MediaSection />
      <DestinationsSection />
      <SharedTextSection />
      <SharedScheduleSection />
      <TranslationsSection />
      {c.draft.targets.length > 0 && (
        <p className="px-1 t-caption text-ink-4">{t('composer.selectTarget')}</p>
      )}
    </>
  )
}

function TargetEditor({ targetKey }: { targetKey: string }) {
  const c = useComposer()
  const target = c.draft.targets.find((x) => x.key === targetKey)
  if (!target) return null
  const account = c.accounts.find((a) => a.id === target.accountId)
  const spec = account ? specOf(account.platform, target.placement) : undefined
  const first = c.media[0]
  const f = first ? formatFor(first, target, spec) : undefined
  const music = !!spec?.music.library && !!account?.capabilities.music
  return (
    <>
      <TargetHeader target={target} />
      <TargetTextSection target={target} />
      <FormatsSection target={target} />
      <CoverSection target={target} />
      {music && <SoundSection target={target} duration={f?.duration ?? null} />}
      <ExtrasSection target={target} />
      <OptionsSection target={target} />
      <TargetScheduleSection target={target} />
    </>
  )
}
