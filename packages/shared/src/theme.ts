import { z } from 'zod'

const Color = z.string().regex(/^(#[0-9a-fA-F]{3,8}|oklch\([^)]*\)|rgba?\([^)]*\))$/, 'colour')

/** Semantic colour roles. Components only ever use these roles, never raw colours. */
export const ThemePalette = z.object({
  bg: Color,
  bgSubtle: Color,
  surface: Color,
  surfaceRaised: Color,
  surfaceHover: Color,
  border: Color,
  borderStrong: Color,
  text: Color,
  textMuted: Color,
  textSubtle: Color,
  accent: Color,
  accentHover: Color,
  accentText: Color,
  accentSoft: Color,
  success: Color,
  warning: Color,
  danger: Color,
  info: Color,
  focus: Color,
  overlay: Color,
})
export type ThemePalette = z.infer<typeof ThemePalette>

export const ThemeFont = z.object({
  family: z.string().min(1),
  /** css font-family fallbacks appended after the family */
  fallback: z.string().default('system-ui, sans-serif'),
  /** Font file URL for uploaded fonts; bundled fonts are resolved by family name. */
  url: z.string().optional(),
  weight: z.number().int().min(100).max(900).optional(),
})
export type ThemeFont = z.infer<typeof ThemeFont>

export const Theme = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  builtIn: z.boolean().default(false),
  light: ThemePalette,
  dark: ThemePalette,
  fonts: z.object({
    ui: ThemeFont,
    display: ThemeFont,
    mono: ThemeFont,
  }),
  /** Display face options (e.g. a brand that always sets titles in capitals). */
  display: z
    .object({
      uppercase: z.boolean().default(false),
      letterSpacing: z.number().min(-0.1).max(0.3).default(-0.02),
      weight: z.number().int().min(100).max(900).default(650),
    })
    .default({ uppercase: false, letterSpacing: -0.02, weight: 650 }),
  /** Base corner radius in px; components scale from it. */
  radius: z.number().min(0).max(24).default(12),
  defaultMode: z.enum(['system', 'light', 'dark']).default('system'),
})
export type Theme = z.infer<typeof Theme>

export const Branding = z.object({
  appName: z.string().min(1).max(40).default('Greenlit'),
  tagline: z.string().max(120).default(''),
  /** URLs (usually /api/files/...) of uploaded artwork; null = Greenlit's own artwork. */
  logoLight: z.string().nullable().default(null),
  logoDark: z.string().nullable().default(null),
  mark: z.string().nullable().default(null),
  favicon: z.string().nullable().default(null),
  loginImage: z.string().nullable().default(null),
  themeId: z.string().default('greenlit'),
})
export type Branding = z.infer<typeof Branding>

/** CSS custom-property name for a palette role: accentSoft -> --gl-accent-soft */
export function cssVarFor(role: string): string {
  return `--gl-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

export function themeToCss(theme: Theme, mode: 'light' | 'dark'): Record<string, string> {
  const palette = theme[mode]
  const vars: Record<string, string> = {}
  for (const [role, value] of Object.entries(palette)) vars[cssVarFor(role)] = value
  const font = (f: ThemeFont) => `"${f.family}", ${f.fallback}`
  vars['--gl-font-ui'] = font(theme.fonts.ui)
  vars['--gl-font-display'] = font(theme.fonts.display)
  vars['--gl-font-mono'] = font(theme.fonts.mono)
  vars['--gl-display-transform'] = theme.display.uppercase ? 'uppercase' : 'none'
  vars['--gl-display-tracking'] = `${theme.display.letterSpacing}em`
  vars['--gl-display-weight'] = String(theme.display.weight)
  vars['--gl-radius'] = `${theme.radius}px`
  return vars
}
