import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

/** Runs a DOM update inside a view transition when the browser has them (tile → viewer morphs, page fades). */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  doc.startViewTransition(() => flushSync(update))
}

const paths = new WeakMap<File, string>()

/**
 * A file's path inside the folder it was dropped or picked with ("Branding/01 Logos/white.svg"), or '' for a file
 * on its own.
 */
export function filePath(file: File) {
  return paths.get(file) || (file as File & { webkitRelativePath?: string }).webkitRelativePath || ''
}

/**
 * The files of a drop, folders opened (each file remembers its path, see `filePath`). Entries must be taken while
 * the drop event runs; reading them can wait.
 */
export async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null) ?? null)
  if (!entries.some((e) => e?.isDirectory)) return [...dt.files]
  const out: File[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      paths.set(file, prefix + file.name)
      out.push(file)
      return
    }
    if (!entry.isDirectory) return
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const e of batch) await walk(e, `${prefix}${entry.name}/`)
    }
  }
  for (const e of entries) if (e) await walk(e, '').catch(() => {})
  return out
}

/** Files dropped anywhere on an element (or the window when `ref` is omitted). Folders are opened. */
export function useFileDrop(
  onFiles: (files: File[], e: DragEvent) => void,
  opts: {
    enabled?: boolean
    target?: React.RefObject<HTMLElement | null>
    /** Only say when files are dragged over (someone else takes the drop). */
    watchOnly?: boolean
  } = {},
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
      if (!d.dataTransfer || opts.watchOnly) return
      void droppedFiles(d.dataTransfer).then((files) => {
        if (files.length) cb.current(files, d)
      })
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
  }, [enabled, opts.target, opts.watchOnly])
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
