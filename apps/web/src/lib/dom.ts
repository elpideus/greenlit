import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

/** Runs a DOM update inside a view transition when the browser has them (tile → viewer morphs, page fades). */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  doc.startViewTransition(() => flushSync(update))
}

/** Files dropped anywhere on an element (or the window when `ref` is omitted). */
export function useFileDrop(
  onFiles: (files: File[], e: DragEvent) => void,
  opts: { enabled?: boolean; target?: React.RefObject<HTMLElement | null> } = {},
) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const cb = useRef(onFiles)
  cb.current = onFiles
  const enabled = opts.enabled ?? true
  useEffect(() => {
    if (!enabled) return
    const el: HTMLElement | Window = opts.target?.current ?? window
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: Event) => {
      const d = e as DragEvent
      if (!hasFiles(d)) return
      d.preventDefault()
      depth.current++
      setOver(true)
    }
    const overFn = (e: Event) => {
      const d = e as DragEvent
      if (!hasFiles(d)) return
      d.preventDefault()
      if (d.dataTransfer) d.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: Event) => {
      if (!hasFiles(e as DragEvent)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    }
    const drop = (e: Event) => {
      const d = e as DragEvent
      if (!hasFiles(d)) return
      d.preventDefault()
      depth.current = 0
      setOver(false)
      const files = [...(d.dataTransfer?.files ?? [])]
      if (files.length) cb.current(files, d)
    }
    el.addEventListener('dragenter', enter)
    el.addEventListener('dragover', overFn)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    return () => {
      el.removeEventListener('dragenter', enter)
      el.removeEventListener('dragover', overFn)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', drop)
    }
  }, [enabled, opts.target])
  return over
}

/** A value kept in localStorage (per browser conveniences: tile size, last view, panel widths). */
export function useStoredState<T>(key: string, initial: T) {
  const read = useCallback(() => {
    try {
      const v = localStorage.getItem(`gl.${key}`)
      return v === null ? initial : (JSON.parse(v) as T)
    } catch {
      return initial
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const [value, setValue] = useState<T>(read)
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          localStorage.setItem(`gl.${key}`, JSON.stringify(v))
        } catch {}
        return v
      })
    },
    [key],
  )
  return [value, set] as const
}

const mq = (q: string) => (typeof matchMedia === 'function' ? matchMedia(q) : null)
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const m = mq(query)
      m?.addEventListener('change', fn)
      return () => m?.removeEventListener('change', fn)
    },
    () => mq(query)?.matches ?? false,
  )
}
export const useIsPhone = () => useMediaQuery('(max-width: 720px)')

/** Size of an element, updated as it resizes. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ width: e.contentRect.width, height: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}
