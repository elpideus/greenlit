import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Finder-style selection over an ordered list of ids: click selects one, mod-click toggles, shift-click extends from
 * the anchor, a marquee adds a set. `order` must be the visible order.
 */
export function useSelection(order: string[], initial?: Iterable<string>) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial))
  const anchor = useRef<string | null>(null)
  const orderRef = useRef(order)
  orderRef.current = order
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const click = useCallback((id: string, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const list = orderRef.current
    setSelected((prev) => {
      if (e.shiftKey && anchor.current) {
        const a = list.indexOf(anchor.current)
        const b = list.indexOf(id)
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a]
          const next = new Set(e.metaKey || e.ctrlKey ? prev : [])
          for (const x of list.slice(from, to + 1)) next.add(x)
          return next
        }
      }
      if (e.metaKey || e.ctrlKey) {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        anchor.current = id
        return next
      }
      anchor.current = id
      return new Set([id])
    })
  }, [])

  /** The checkbox on a tile: toggles without clearing the rest. */
  const toggle = useCallback(
    (id: string, e?: { shiftKey?: boolean }) => {
      if (e?.shiftKey && anchor.current) return click(id, { shiftKey: true, metaKey: true })
      anchor.current = id
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [click],
  )

  const replace = useCallback((ids: Iterable<string>) => setSelected(new Set(ids)), [])
  const clear = useCallback(() => {
    anchor.current = null
    setSelected((s) => (s.size ? new Set() : s))
  }, [])
  const all = useCallback(() => setSelected(new Set(orderRef.current)), [])
  /** Make sure `id` is part of the selection (right-click on an unselected tile selects it alone). */
  const ensure = useCallback((id: string) => {
    const current = selectedRef.current
    if (current.has(id)) return [...current]
    anchor.current = id
    setSelected(new Set([id]))
    return [id]
  }, [])

  return useMemo(
    () => ({ selected, click, toggle, replace, clear, all, ensure, anchor }),
    [selected, click, toggle, replace, clear, all, ensure],
  )
}
export type Selection = ReturnType<typeof useSelection>
