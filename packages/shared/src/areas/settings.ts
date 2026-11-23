import { z } from 'zod'
import { Branding, Theme } from '../theme.ts'

/** Platform-wide settings. The time zone drives every schedule, including the ones sent to the social platforms. */
export const PlatformSettings = z.object({
  timeZone: z.string().min(1),
  defaultLocale: z.enum(['en', 'it']).default('en'),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  publicUrl: z.string().default(''),
})
export type PlatformSettings = z.infer<typeof PlatformSettings>

/** What anyone (even signed out) may know: enough to paint the login page in the right colours. */
export const PublicConfig = z.object({
  branding: Branding,
  theme: Theme,
  themes: z.array(Theme),
  platform: PlatformSettings.pick({ timeZone: true, defaultLocale: true, weekStartsOn: true }),
  version: z.string(),
  setupRequired: z.boolean(),
  /** Production first run: the setup code printed in the server log must be entered (there is no local port). */
  setupNeedsCode: z.boolean().default(false),
})
export type PublicConfig = z.infer<typeof PublicConfig>

export const SetupInput = z.object({
  email: z.email(),
  displayName: z.string().min(1).max(80),
  password: z.string().min(8).max(200),
  appName: z.string().min(1).max(40).default('Greenlit'),
  timeZone: z.string().min(1),
  locale: z.enum(['en', 'it']).default('en'),
  /** The one-time code from the server log (`docker compose logs app`); required in production. */
  setupCode: z.string().max(40).optional(),
})
export type SetupInput = z.infer<typeof SetupInput>

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
