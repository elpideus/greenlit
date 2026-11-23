import { useEffect, useRef } from 'react'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Human label for a shortcut: "mod+k" → "⌘K" on a Mac, "Ctrl K" elsewhere. */
export function shortcutLabel(combo: string) {
  return combo
    .split('+')
    .map((k) => {
      const key = k.toLowerCase()
      if (key === 'mod') return isMac ? '⌘' : 'Ctrl'
      if (key === 'shift') return isMac ? '⇧' : 'Shift'
      if (key === 'alt') return isMac ? '⌥' : 'Alt'
      if (key === 'enter') return '↵'
      if (key === 'backspace') return '⌫'
      if (key === 'escape') return 'Esc'
      if (key === 'space') return 'Space'
      if (key === 'arrowleft') return '←'
      if (key === 'arrowright') return '→'
      if (key === 'arrowup') return '↑'
      if (key === 'arrowdown') return '↓'
      return key.length === 1 ? key.toUpperCase() : k
    })
    .join(isMac ? '' : ' ')
}

function matches(e: KeyboardEvent, combo: string) {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop()!
  const mod = parts.includes('mod')
  const want = {
    meta: parts.includes('meta') || (mod && isMac),
    ctrl: parts.includes('ctrl') || (mod && !isMac),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  }
  if (e.metaKey !== want.meta || e.ctrlKey !== want.ctrl || e.altKey !== want.alt) return false
  if (want.shift !== e.shiftKey && key.length > 1) return false
  if (want.shift && !e.shiftKey) return false
  const k = e.key.toLowerCase()
  return k === key || e.code.toLowerCase() === `key${key}` || (key === 'space' && e.code === 'Space')
}

export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el) return false
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    !!el.closest?.('.cm-editor')
  )
}

/**
 * Keyboard shortcut. Ignored while typing unless `allowInInputs`. Several combos may share a handler:
 * `useHotkey(['mod+k', '/'], open)`.
 */
export function useHotkey(
  combo: string | string[],
  handler: (e: KeyboardEvent) => void,
  opts: { enabled?: boolean; allowInInputs?: boolean; preventDefault?: boolean } = {},
) {
  const ref = useRef(handler)
  ref.current = handler
  const combos = Array.isArray(combo) ? combo : [combo]
  const key = combos.join('|')
  const { enabled = true, allowInInputs = false, preventDefault = true } = opts
  useEffect(() => {
    if (!enabled) return
    const list = key.split('|')
    const onKey = (e: KeyboardEvent) => {
      if (!allowInInputs && isTypingTarget(e.target)) return
      if (list.some((c) => matches(e, c))) {
        if (preventDefault) e.preventDefault()
        ref.current(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, enabled, allowInInputs, preventDefault])
}
