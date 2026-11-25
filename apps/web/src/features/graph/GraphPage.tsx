import { ArrowRight, Focus, Maximize2, Minus, Plus, SlidersHorizontal, Workflow, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { browseState } from '@/components/viewer/browse'
import { useProjects } from '@/data/projects'
import { cn } from '@/lib/cn'
import { useIsPhone, useStoredState } from '@/lib/dom'
import { useHotkey } from '@/lib/hotkeys'
import { useT } from '@/lib/i18n'
import { ease } from '@/lib/motion'
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Popover,
  SearchInput,
  Segmented,
  Select,
  Signal,
  ToggleRow,
} from '@/ui'
import { useGraph } from './api'
import { ForceGraph, type ForceGraphHandle } from './ForceGraph'
import { buildModel, chainOf, type GNode, type GraphModel, STAGES, type Stage } from './model'
import { useProcessStrip } from './store'
import { Thumb } from './Thumb'

const CARD_W = 340

/**
 * The Graph: every item of the projects and how each was made from the others, drawn as a map of dots and lines
 * (photos and videos taken, AI stills, clips, edits, films, posts). Each project gathers in its own cloud; "By
 * process" lines them up left to right instead, one step of the work per column. A click lights an item's whole
 * chain. `?project=<id>` shows one project, `?focus=media:<id>` opens on an item.
 */
export default function GraphPage() {
  const t = useT('graph')
  const phone = useIsPhone()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project')
  const [layout, setLayout] = useStoredState<'free' | 'process'>('graph.layout', 'free')
  // ⌘K "Graph by process" opens on that layout.
  useEffect(() => {
    if (params.get('layout') !== 'process') return
    setLayout('process')
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('layout')
        return next
      },
      { replace: true },
    )
  }, [params, setLayout, setParams])
  const [arrows, setArrows] = useStoredState('graph.arrows', true)
  const [loose, setLoose] = useStoredState('graph.loose', true)
  const [brandKits, setBrandKits] = useStoredState('graph.brandKits', false)
  const { data, isLoading, error, refetch } = useGraph({ projectId, brandKits })
  const { data: projects } = useProjects()
  const graph = useRef<ForceGraphHandle>(null)
  const previous = useRef<GraphModel | null>(null)

  const model = useMemo(() => {
    if (!data) return null
    const m = buildModel(data, { loose, noProjectName: t('noProject') }, previous.current?.byKey)
    previous.current = m
    return m
  }, [data, loose, t])

  const focusParam = params.get('focus')
  const [selected, setSelected] = useState<string | null>(focusParam)
  const select = (key: string | null) => {
    setSelected(key)
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (key) next.set('focus', key)
        else next.delete('focus')
        return next
      },
      { replace: true },
    )
  }
  // Opened on an item: bring it into view once it has a place.
  const focused = useRef(false)
  useEffect(() => {
    if (!model || focused.current || !focusParam || !model.byKey.has(focusParam)) return
    focused.current = true
    const id = setTimeout(() => graph.current?.focus(focusParam), 350)
    return () => clearTimeout(id)
  }, [model, focusParam])

  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !model) return null
    return model.nodes.filter((n) => n.node.title.toLowerCase().includes(q))
  }, [query, model])
  const matchKeys = useMemo(() => (matches ? new Set(matches.map((n) => n.key)) : null), [matches])

  const open = (key: string) => {
    const n = model?.byKey.get(key)
    if (!n || !model) return
    if (n.node.type === 'media') {
      // The viewer steps through the item's chain, in the order of the work.
      const ids = [...chainOf(model, key)]
        .map((k) => model.byKey.get(k))
        .filter((x): x is GNode => !!x && x.node.type === 'media')
        .sort((a, b) => a.rank - b.rank || a.node.title.localeCompare(b.node.title))
        .map((x) => x.node.id)
      navigate(n.node.href, { state: browseState({ ids }) })
    } else navigate(n.node.href)
  }
  useHotkey('escape', () => select(null), { enabled: !!selected })
  useHotkey('f', () => graph.current?.fit())

  const setProject = (id: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (id === 'all') next.delete('project')
        else next.set('project', id)
        next.delete('focus')
        return next
      },
      { replace: true },
    )

  const selectedNode = selected ? (model?.byKey.get(selected) ?? null) : null
  const projectOptions = [
    { value: 'all', label: t('allProjects') },
    ...(projects ?? []).filter((p) => p.kind !== 'brand').map((p) => ({ value: p.id, label: p.name })),
  ]

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden bg-canvas',
        phone
          ? 'h-[calc(100dvh-var(--bar-h)-var(--tabbar-h)-env(safe-area-inset-bottom))]'
          : 'h-[calc(100dvh-var(--bar-h))]',
      )}
    >
      {model && model.nodes.length > 0 && (
        <ForceGraph
          ref={graph}
          model={model}
          selected={selected && model.byKey.has(selected) ? selected : null}
          onSelect={select}
          onOpen={open}
          arrange={layout === 'process'}
          arrows={arrows}
          matches={matchKeys}
          label={t('canvasLabel', { items: model.nodes.length, links: model.links.length })}
          untitled={t('untitled')}
          insetRight={!phone && selected ? CARD_W + 32 : 0}
        />
      )}

      {isLoading && (
        <div className="absolute inset-0 grid place-items-center">
          <Signal tone="review" size={34} className="text-ink-4" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center">
          <ErrorState title={t('error')} error={error} retry={() => void refetch()} />
        </div>
      )}
      {model && model.nodes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center px-6">
          <EmptyState icon={Workflow} title={t('empty.title')} body={t('empty.body')} />
        </div>
      )}

      {/* search */}
      <div className={cn('absolute z-20', phone ? 'inset-x-2 top-2' : 'top-4 left-4 w-[320px]')}>
        <div className="floating rounded-[12px] p-1">
          <SearchInput value={query} onChange={setQuery} placeholder={t('search')} />
        </div>
        {matches && (
          <div className="floating mt-2 max-h-[50vh] overflow-y-auto rounded-[12px] p-1">
            {matches.length === 0 ? (
              <p className="px-3 py-2.5 t-caption text-ink-3">{t('noMatches', { q: query.trim() })}</p>
            ) : (
              matches.slice(0, 40).map((n) => (
                <button
                  key={n.key}
                  type="button"
                  className="press flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-hover"
                  onClick={() => {
                    select(n.key)
                    setQuery('')
                    graph.current?.focus(n.key)
                  }}
                >
                  <Thumb node={n.node} className="h-7 w-12" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate t-callout text-ink">{n.node.title || t('untitled')}</span>
                    <span className="block truncate t-caption text-ink-3">
                      {t(`stage.${n.stage}`)} · {groupName(model!, n.group)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* layout, project, display */}
      <div
        className={cn(
          'absolute z-20 flex items-center gap-2 transition-[right] duration-300 ease-out',
          phone ? 'top-[62px] right-2 left-2' : 'top-4',
        )}
        style={phone ? undefined : { right: selectedNode ? CARD_W + 32 : 16 }}
      >
        <div className="floating flex items-center gap-1 rounded-[11px] p-1">
          <Segmented
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'free', label: t('layout.free') },
              { value: 'process', label: t('layout.process') },
            ]}
          />
        </div>
        <div className="floating flex items-center gap-1 rounded-[11px] p-1">
          <Select
            value={projectId ?? 'all'}
            onChange={setProject}
            options={projectOptions}
            className="max-w-[220px]"
          />
          <Popover
            align="end"
            width={300}
            trigger={<IconButton icon={SlidersHorizontal} label={t('display.title')} />}
          >
            <div className="flex flex-col gap-1 p-2">
              <ToggleRow title={t('display.arrows')} checked={arrows} onChange={setArrows} />
              <ToggleRow
                title={t('display.loose')}
                description={t('display.looseHint')}
                checked={loose}
                onChange={setLoose}
              />
              <ToggleRow
                title={t('display.brandKits')}
                description={t('display.brandKitsHint')}
                checked={brandKits}
                onChange={setBrandKits}
              />
            </div>
          </Popover>
        </div>
      </div>

      {/* legend */}
      {model && model.nodes.length > 0 && !(phone && selectedNode) && (
        <Legend model={model} className={phone ? 'bottom-3 left-2' : 'bottom-5 left-4'} />
      )}

      {/* zoom */}
      {!phone && (
        <div
          className="absolute bottom-5 z-20 flex flex-col gap-2 transition-[right] duration-300 ease-out"
          style={{ right: selectedNode ? CARD_W + 32 : 16 }}
        >
          <div className="floating flex flex-col rounded-[11px] p-1">
            <IconButton
              icon={Plus}
              label={t('zoomIn')}
              tooltip="left"
              onClick={() => graph.current?.zoomBy(1.4)}
            />
            <div className="mx-1.5 h-px bg-line" />
            <IconButton
              icon={Minus}
              label={t('zoomOut')}
              tooltip="left"
              onClick={() => graph.current?.zoomBy(1 / 1.4)}
            />
          </div>
          <div className="floating rounded-[11px] p-1">
            <IconButton
              icon={Maximize2}
              label={t('fit')}
              shortcut="f"
              tooltip="left"
              onClick={() => graph.current?.fit()}
            />
          </div>
        </div>
      )}

      {/* the selected item */}
      <AnimatePresence>
        {selectedNode && model && (
          <motion.aside
            key="card"
            initial={phone ? { y: 24, opacity: 0 } : { x: 24, opacity: 0 }}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={phone ? { y: 24, opacity: 0 } : { x: 24, opacity: 0 }}
            transition={{ duration: 0.26, ease }}
            className={cn(
              'floating absolute z-30 flex flex-col overflow-hidden rounded-[14px]',
              phone ? 'inset-x-2 bottom-2 max-h-[55vh]' : 'top-4 right-4 bottom-4',
            )}
            style={phone ? undefined : { width: CARD_W }}
          >
            <NodeCard
              model={model}
              node={selectedNode}
              onClose={() => select(null)}
              onOpen={() => open(selectedNode.key)}
              onPick={(k) => {
                select(k)
                graph.current?.focus(k)
              }}
              onCenter={() => graph.current?.focus(selectedNode.key)}
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

function groupName(model: GraphModel, id: string) {
  return model.groups.find((g) => g.id === id)?.name ?? ''
}

const STAGE_TONE: Record<Stage, string> = {
  loose: 'bg-ink-4',
  source: 'bg-ink-3',
  made: 'bg-ink-2',
  edit: 'bg-ink-2',
  final: 'bg-signal',
  post: 'bg-cue',
}

function Legend({ model, className }: { model: GraphModel; className?: string }) {
  const t = useT('graph')
  const counts = new Map<Stage, number>()
  for (const n of model.nodes) counts.set(n.stage, (counts.get(n.stage) ?? 0) + 1)
  return (
    <div className={cn('floating absolute z-20 flex flex-col gap-1.5 rounded-[12px] px-3 py-2.5', className)}>
      {STAGES.filter((s) => counts.get(s)).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={cn(
              'size-2.5 shrink-0',
              s === 'edit' ? 'rounded-[3px]' : 'rounded-full',
              STAGE_TONE[s],
            )}
          />
          <span className="t-caption text-ink-2">{t(`stage.${s}`)}</span>
          <span className="ml-auto pl-3 t-meta text-ink-3 tabular-nums">{counts.get(s)}</span>
        </div>
      ))}
      <div className="mt-1 border-line border-t pt-1.5 t-caption text-ink-3">
        {t('summary', { items: model.nodes.length, links: model.links.length })}
      </div>
    </div>
  )
}

function NodeCard({
  model,
  node,
  onClose,
  onOpen,
  onPick,
  onCenter,
}: {
  model: GraphModel
  node: GNode
  onClose: () => void
  onOpen: () => void
  onPick: (key: string) => void
  onCenter: () => void
}) {
  const t = useT('graph')
  const navigate = useNavigate()
  const setStrip = useProcessStrip((s) => s.setOpen)
  const n = node.node
  const chain = chainOf(model, node.key)
  const sides = [
    {
      title: t('card.madeFrom'),
      items: model.steps
        .filter((s) => s.down === node.key)
        .map((s) => ({ key: s.up, relation: s.relation, forward: s.relation === 'uses' })),
    },
    {
      title: t('card.usedIn'),
      items: model.steps
        .filter((s) => s.up === node.key)
        .map((s) => ({ key: s.down, relation: s.relation, forward: s.relation !== 'uses' })),
    },
  ]
  const related = model.links
    .filter((l) => l.relation === 'related' && (l.source.key === node.key || l.target.key === node.key))
    .map((l) => (l.source.key === node.key ? l.target.key : l.source.key))
  const kindLabel = n.type === 'media' ? t(`common:kind.${n.kind ?? 'other'}`) : t(`type.${n.type}`)
  return (
    <>
      <div className="relative aspect-video w-full shrink-0 bg-well">
        <Thumb node={n} className="absolute inset-0 size-full rounded-none" />
        <div className="absolute top-2 right-2 rounded-full bg-black/40 backdrop-blur">
          <IconButton icon={X} label={t('close')} onClick={onClose} className="text-white/85" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <h2 className="t-headline text-ink">{n.title || t('untitled')}</h2>
          <p className="mt-0.5 t-caption text-ink-3">
            {[kindLabel, t(`stage.${node.stage}`), groupName(model, node.group)].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-2 t-caption text-ink-2">{t('card.chain', { count: chain.size - 1 })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={onOpen}>
            {t('card.open')}
          </Button>
          {n.type === 'media' && (
            <Button
              size="sm"
              variant="secondary"
              icon={Workflow}
              onClick={() => {
                setStrip(true)
                navigate(n.href)
              }}
            >
              {t('card.process')}
            </Button>
          )}
          <IconButton icon={Focus} label={t('card.center')} onClick={onCenter} />
        </div>
        {[
          ...sides,
          {
            title: t('card.related'),
            items: related.map((key) => ({ key, relation: 'related' as const, forward: true })),
          },
        ]
          .filter((s) => s.items.length)
          .map((s) => (
            <section key={s.title} className="flex flex-col gap-1">
              <h3 className="t-micro text-ink-3">{s.title}</h3>
              {s.items.map(({ key, relation, forward }) => {
                const other = model.byKey.get(key)
                if (!other) return null
                return (
                  <button
                    key={key}
                    type="button"
                    className="press -mx-1.5 flex items-center gap-2.5 rounded-[8px] px-1.5 py-1 text-left hover:bg-hover"
                    onClick={() => onPick(key)}
                  >
                    <Thumb node={other.node} className="h-8 w-14" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate t-callout text-ink">
                        {other.node.title || t('untitled')}
                      </span>
                      <span className="block truncate t-caption text-ink-3">
                        {t(`relations.${relation}.${forward ? 'forward' : 'inverse'}`)}
                      </span>
                    </span>
                    <ArrowRight size={13} className="shrink-0 text-ink-4" />
                  </button>
                )
              })}
            </section>
          ))}
      </div>
    </>
  )
}
