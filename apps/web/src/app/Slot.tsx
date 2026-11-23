import { Fragment, type ReactNode, Suspense } from 'react'
import { can, useMe } from '@/lib/session'
import type { SlotEntry } from './feature'
import { slotEntries } from './registry'

/**
 * A named extension point. A page renders `<Slot name="media.info.sections" props={{ media }} />` without knowing
 * what will appear; features add entries from their own folder. See docs/ARCHITECTURE.md for the slot list.
 */
export function Slot<P extends object>({
  name,
  props,
  wrap,
  fallback = null,
}: {
  name: string
  props: P
  wrap?: (child: ReactNode, entry: SlotEntry<P>) => ReactNode
  fallback?: ReactNode
}) {
  const entries = useSlot<P>(name, props)
  if (!entries.length) return <>{fallback}</>
  return (
    <>
      {entries.map((e) => {
        const C = e.component
        // Entries may be lazy components (heavy panels load with their first use).
        const child = (
          <Suspense fallback={null}>
            <C {...props} />
          </Suspense>
        )
        return <Fragment key={`${e.feature}:${e.id}`}>{wrap ? wrap(child, e) : child}</Fragment>
      })}
    </>
  )
}

/** The entries of a slot that apply (permission + `when`), for slots rendered as tabs or menus. */
export function useSlot<P extends object>(name: string, props: P) {
  const { data: me } = useMe()
  return slotEntries(name).filter(
    (e) => (!e.permission || can(me, e.permission)) && (!e.when || e.when(props as never)),
  ) as (SlotEntry<P> & { feature: string })[]
}
