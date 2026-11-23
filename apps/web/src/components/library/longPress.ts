import { useRef } from 'react'

/**
 * Long press on touch screens (iOS Safari has no contextmenu event): calls `fn` with the touch point after 480 ms
 * unless the finger moves or lifts first.
 */
export function useLongPress(fn: (x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      start.current = { x: t.clientX, y: t.clientY }
      timer.current = setTimeout(() => {
        navigator.vibrate?.(8)
        fn(t.clientX, t.clientY)
      }, 480)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0]
      if (t && start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 8)
        cancel()
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  }
}

/** A stand-in for a mouse event, so a long press can reuse the right-click handler. */
export function pressEvent(x: number, y: number) {
  return { clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent
}
