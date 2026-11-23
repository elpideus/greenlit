import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import type { Theme } from '@greenlit/shared'
import { themeToCss } from '@greenlit/shared'
import { useEffect, useSyncExternalStore } from 'react'

/** Fonts that ship with Greenlit, loaded on first use (any other family needs a `url` in the theme). */
const BUNDLED_FONTS: Record<string, () => Promise<unknown>> = {
  'Jost Variable': () => import('@fontsource-variable/jost'),
  'Cinzel Variable': () => import('@fontsource-variable/cinzel'),
  'JetBrains Mono Variable': () => import('@fontsource-variable/jetbrains-mono'),
  'Inter Variable': () => import('@fontsource-variable/inter'),
}

export type ModePreference = 'system' | 'light' | 'dark'
const KEY = 'gl.mode'

const listeners = new Set<() => void>()
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
media?.addEventListener('change', () => {
  for (const l of listeners) l()
})

export function getModePreference(): ModePreference {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'system'
}

export function setModePreference(mode: ModePreference) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {}
  for (const l of listeners) l()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The user's choice (system/light/dark) and the mode actually shown. */
export function useMode(themeDefault: ModePreference = 'system') {
  const pref = useSyncExternalStore(subscribe, getModePreference)
  const systemDark = useSyncExternalStore(subscribe, () => media?.matches ?? true)
  let effective = pref === 'system' ? themeDefault : pref
  if (effective === 'system') effective = systemDark ? 'dark' : 'light'
  return { preference: pref, mode: effective as 'light' | 'dark' }
}

const loadedFonts = new Set<string>()
function ensureFont(family: string, url?: string) {
  if (loadedFonts.has(family)) return
  loadedFonts.add(family)
  const bundled = BUNDLED_FONTS[family]
  if (bundled) {
    void bundled()
    return
  }
  if (url) {
    const face = new FontFace(family, `url(${url})`)
    void face
      .load()
      .then((f) => document.fonts.add(f))
      .catch(() => {})
  }
}

/** Applies a theme pack to the document: palette for the mode, fonts, display style, radius. */
export function applyTheme(theme: Theme, mode: 'light' | 'dark') {
  const root = document.documentElement
  root.dataset.themeMode = mode
  root.dataset.theme = theme.id
  for (const [k, v] of Object.entries(themeToCss(theme, mode))) root.style.setProperty(k, v)
  for (const f of [theme.fonts.ui, theme.fonts.display, theme.fonts.mono]) ensureFont(f.family, f.url)
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', theme[mode].bg)
}

/** Keeps the document painted with `theme` (null = Greenlit's built-in tokens). */
export function useApplyTheme(theme: Theme | null | undefined) {
  const { mode } = useMode(theme?.defaultMode)
  useEffect(() => {
    if (theme) applyTheme(theme, mode)
    else document.documentElement.dataset.themeMode = mode
  }, [theme, mode])
  return mode
}

// ── theme preview (this tab only) ───────────────────────────────────────────────
// `?theme=<id>` (or setThemePreview) shows another theme pack in this tab without changing the instance's theme;
// `?theme=none` ends the preview. Used by Settings → Branding to try a theme before applying it.
const PREVIEW_KEY = 'gl.themePreview'
const previewListeners = new Set<() => void>()
try {
  const fromUrl = new URLSearchParams(location.search).get('theme')
  if (fromUrl === 'none') sessionStorage.removeItem(PREVIEW_KEY)
  else if (fromUrl) sessionStorage.setItem(PREVIEW_KEY, fromUrl)
} catch {}

export function getThemePreview(): string | null {
  try {
    return sessionStorage.getItem(PREVIEW_KEY)
  } catch {
    return null
  }
}

export function setThemePreview(id: string | null) {
  try {
    if (id) sessionStorage.setItem(PREVIEW_KEY, id)
    else sessionStorage.removeItem(PREVIEW_KEY)
  } catch {}
  for (const l of previewListeners) l()
}

export function useThemePreview() {
  return useSyncExternalStore((fn) => {
    previewListeners.add(fn)
    return () => previewListeners.delete(fn)
  }, getThemePreview)
}
