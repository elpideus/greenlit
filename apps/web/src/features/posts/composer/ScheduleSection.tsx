import { platformKeepsSchedule } from '@greenlit/shared'
import { CloudOff, ServerCog } from 'lucide-react'
import { DateTimeField } from '@/components/DateTimeField'
import { PlatformIcon } from '@/components/PlatformIcon'
import { useT } from '@/lib/i18n'
import { type DraftTarget, onPlatform } from '../model'
import { useWhere } from '../parts'
import { Choice, Panel } from './bits'
import { useComposer } from './state'

/** The time most versions share (the one "everywhere" edits). */
export function sharedTime(targets: DraftTarget[]) {
  const counts = new Map<string, number>()
  for (const t of targets)
    if (t.enabled) counts.set(t.scheduleAt ?? '', (counts.get(t.scheduleAt ?? '') ?? 0) + 1)
  let best = ''
  let n = -1
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v]
  return best || null
}

function useMovable() {
  const c = useComposer()
  return (t: DraftTarget) => {
    const s = c.post.targets.find((x) => x.id && x.id === t.id)
    return !s || !onPlatform(s)
  }
}

/** When: as soon as Publish is pressed, or at a time in the platform time zone (for every version). */
export function SharedScheduleSection() {
  const t = useT('posts')
  const c = useComposer()
  const movable = useMovable()
  const shared = sharedTime(c.draft.targets)
  const setAll = (iso: string | null) =>
    c.update((d) => ({
      ...d,
      targets: d.targets.map((x) => (x.enabled && movable(x) ? { ...x, scheduleAt: iso } : x)),
    }))
  const tomorrow9 = () => {
    const d = new Date(Date.now() + 86_400_000)
    d.setMinutes(0, 0, 0)
    return d.toISOString()
  }
  return (
    <Panel title={t('composer.schedule')}>
      <div role="radiogroup" className="flex flex-col gap-2">
        <Choice
          checked={!shared}
          onSelect={() => setAll(null)}
          title={t('composer.now')}
          disabled={!c.editable}
        />
        <Choice
          checked={!!shared}
          onSelect={() => !shared && setAll(tomorrow9())}
          title={t('composer.at')}
          disabled={!c.editable}
        >
          <DateTimeField value={shared} onChange={setAll} min={new Date()} className="w-full max-w-[420px]" />
          {shared && new Date(shared).getTime() < Date.now() && (
            <div className="mt-2 t-caption text-review">{t('composer.inPast')}</div>
          )}
        </Choice>
      </div>
      <ScheduleNotes />
    </Panel>
  )
}

/** Per version: does the platform keep the schedule, or does Greenlit hold it? */
function ScheduleNotes() {
  const t = useT('posts')
  const where = useWhere()
  const c = useComposer()
  const timed = c.draft.targets.filter((x) => x.enabled && x.scheduleAt)
  if (!timed.length) return null
  return (
    <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      {timed.map((x) => {
        const a = c.accounts.find((acc) => acc.id === x.accountId)
        if (!a) return null
        const keeps = platformKeepsSchedule(a.capabilities, x.placement, new Date(x.scheduleAt!))
        const label = where(a.platform, x.placement)
        return (
          <li key={x.key} className="flex items-start gap-2.5 t-caption">
            <PlatformIcon platform={a.platform} size={16} tile className="mt-px" />
            <span className="min-w-0 flex-1 text-ink-2">
              <span className="font-[550] text-ink">{label}</span> ·{' '}
              {keeps ? t('composer.keepsSchedule', { where: label }) : t('composer.greenlitHolds')}
            </span>
            {keeps ? (
              <CloudOff size={14} className="mt-px shrink-0 text-cue" />
            ) : (
              <ServerCog size={14} className="mt-px shrink-0 text-review" />
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A version's time: the shared one, or its own. */
export function TargetScheduleSection({ target }: { target: DraftTarget }) {
  const t = useT('posts')
  const where = useWhere()
  const c = useComposer()
  const movable = useMovable()(target)
  const shared = sharedTime(c.draft.targets)
  const own = (target.scheduleAt ?? '') !== (shared ?? '')
  const a = c.accounts.find((acc) => acc.id === target.accountId)
  const keeps =
    a && target.scheduleAt
      ? platformKeepsSchedule(a.capabilities, target.placement, new Date(target.scheduleAt))
      : null
  const label = a ? where(a.platform, target.placement) : ''
  return (
    <Panel title={t('composer.schedule')}>
      <div role="radiogroup" className="flex flex-col gap-2">
        <Choice
          checked={!own}
          onSelect={() => c.updateTarget(target.key, { scheduleAt: shared })}
          title={t('composer.sameTime')}
          disabled={!c.editable || !movable}
        />
        <Choice
          checked={own}
          onSelect={() =>
            !own &&
            c.updateTarget(target.key, {
              scheduleAt: target.scheduleAt ?? new Date(Date.now() + 2 * 3_600_000).toISOString(),
            })
          }
          title={t('composer.ownTime')}
          disabled={!c.editable || !movable}
        >
          <DateTimeField
            value={target.scheduleAt}
            onChange={(iso) => c.updateTarget(target.key, { scheduleAt: iso })}
            min={new Date()}
            className="w-full max-w-[420px]"
          />
        </Choice>
      </div>
      {keeps !== null && (
        <p className="mt-3 flex items-center gap-2 t-caption text-ink-3">
          {keeps ? (
            <CloudOff size={14} className="text-cue" />
          ) : (
            <ServerCog size={14} className="text-review" />
          )}
          {keeps ? t('composer.keepsSchedule', { where: label }) : t('composer.greenlitHolds')}
        </p>
      )}
    </Panel>
  )
}
