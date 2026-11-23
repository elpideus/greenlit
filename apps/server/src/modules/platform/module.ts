import { randomInt, timingSafeEqual } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  Branding,
  isValidTimeZone,
  PlatformSettings,
  PublicConfig,
  SetupInput,
  Theme,
} from '@greenlit/shared'
import { z } from 'zod'
import { REPO_ROOT } from '../../core/config.ts'
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../core/errors.ts'
import { Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { MIME } from '../../core/static.ts'
import { setSessionCookie } from '../users/module.ts'

export interface PlatformService {
  timeZone: () => string
  settings: () => PlatformSettings
  branding: () => Branding
  activeTheme: () => Theme
}

declare module '../../core/services.ts' {
  interface Services {
    platform: PlatformService
  }
}

/** Built-in theme packs live in /themes/<id>/theme.json. */
function loadBuiltInThemes(): Theme[] {
  const dir = join(REPO_ROOT, 'themes')
  if (!existsSync(dir)) return []
  const out: Theme[] = []
  for (const id of readdirSync(dir)) {
    const file = join(dir, id, 'theme.json')
    if (!existsSync(file)) continue
    out.push(Theme.parse({ ...JSON.parse(readFileSync(file, 'utf8')), builtIn: true }))
  }
  return out.sort((a, b) =>
    a.id === 'greenlit' ? -1 : b.id === 'greenlit' ? 1 : a.name.localeCompare(b.name),
  )
}

export default defineModule({
  id: 'platform',
  name: 'Platform settings',
  description: 'Time zone, branding, themes and first-run setup.',
  dependsOn: ['users'],
  permissions: {
    'platform.manage': {
      description: 'Change branding, themes, time zone and other platform settings',
      roles: [],
    },
  },
  setup(ctx) {
    const builtIn = loadBuiltInThemes()
    const platform = ctx.settings.define('platform', {
      schema: PlatformSettings,
      default: () => ({
        timeZone: ctx.config.systemTimeZone,
        defaultLocale: 'en' as const,
        weekStartsOn: 1 as const,
        publicUrl: ctx.config.publicUrl,
      }),
    })
    const branding = ctx.settings.define('branding', {
      schema: Branding,
      default: () => Branding.parse({}),
      public: true,
    })
    const customThemes = ctx.settings.define('themes.custom', { schema: z.array(Theme), default: () => [] })

    const allThemes = () => [...builtIn, ...customThemes.get().map((t) => ({ ...t, builtIn: false }))]
    const activeTheme = () => allThemes().find((t) => t.id === branding.get().themeId) ?? builtIn[0]!

    ctx.services.provide('platform', {
      timeZone: () => platform.get().timeZone,
      settings: () => platform.get(),
      branding: () => branding.get(),
      activeTheme,
    })

    const users = ctx.services.users
    const tags = ['Platform']
    const brandDir = join(ctx.config.dataDir, 'branding')

    route(ctx.api, {
      method: 'get',
      path: '/config',
      summary: 'Public configuration: branding, theme, time zone (no sign-in needed)',
      tags,
      access: 'public',
      response: PublicConfig,
      handler: async () => ({
        branding: branding.get(),
        theme: activeTheme(),
        themes: allThemes(),
        platform: {
          timeZone: platform.get().timeZone,
          defaultLocale: platform.get().defaultLocale,
          weekStartsOn: platform.get().weekStartsOn,
        },
        version: ctx.config.version,
        setupRequired: (await users.count()) === 0,
        setupNeedsCode: ctx.config.isProd,
      }),
    })

    // First run in production: a one-time setup code, printed in the log at every start until an admin exists.
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const setupCode = Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + ALPHABET[randomInt(ALPHABET.length)]).join('')
    const setupCodeMatches = (given: string | undefined) => {
      const a = Buffer.from((given ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      const b = Buffer.from(setupCode.replace('-', ''))
      return a.length === b.length && timingSafeEqual(a, b)
    }
    if (ctx.config.isProd)
      void users.count().then((n) => {
        if (n === 0)
          ctx.log.warn(
            `First run: open ${ctx.config.publicUrl} and create the admin account with the setup code ${setupCode}`,
          )
      })

    route(ctx.api, {
      method: 'post',
      path: '/setup',
      summary: 'First run: create the first admin account',
      tags,
      access: 'public',
      body: SetupInput,
      response: Ok,
      handler: async ({ c, body }) => {
        if ((await users.count()) > 0) throw conflict('Greenlit is already set up')
        // Whoever sets Greenlit up becomes its admin. Production publishes no local port (only the Cloudflare
        // Tunnel reaches it), so the first account needs the one-time code the server prints in its log.
        if (ctx.config.isProd && !setupCodeMatches(body.setupCode))
          throw forbidden(
            'Enter the setup code from the server log: run `docker compose logs app | grep "setup code"` on the computer Greenlit runs on.',
          )
        if (!isValidTimeZone(body.timeZone)) throw badRequest('Unknown time zone')
        const user = await users.create({
          email: body.email,
          displayName: body.displayName,
          password: body.password,
          role: 'admin',
          locale: body.locale,
        })
        await platform.update({ timeZone: body.timeZone, defaultLocale: body.locale }, user.id)
        await branding.update({ appName: body.appName }, user.id)
        const token = await users.createSession(user.id, { days: 60, userAgent: c.req.header('user-agent') })
        setSessionCookie(c, token, 60, ctx.config.publicUrl)
        return { ok: true as const }
      },
    })

    route(ctx.api, {
      method: 'get',
      path: '/settings/platform',
      summary: 'Platform settings',
      tags,
      access: 'signed-in',
      response: PlatformSettings,
      handler: () => platform.get(),
    })

    route(ctx.api, {
      method: 'patch',
      path: '/settings/platform',
      summary:
        'Change platform settings (time zone affects every schedule, including on the social platforms)',
      tags,
      access: 'platform.manage',
      body: PlatformSettings.partial(),
      response: PlatformSettings,
      handler: async ({ actor, body }) => {
        if (body.timeZone && !isValidTimeZone(body.timeZone)) throw badRequest('Unknown time zone')
        return platform.update(body, actor.kind === 'user' ? actor.user.id : null)
      },
    })

    route(ctx.api, {
      method: 'get',
      path: '/settings/timezones',
      summary: 'Every IANA time zone with its current offset',
      tags,
      access: 'signed-in',
      response: z.array(z.object({ id: z.string(), offset: z.string(), offsetMinutes: z.number() })),
      handler: () => {
        const now = new Date()
        return Intl.supportedValuesOf('timeZone').map((id) => {
          const part =
            new Intl.DateTimeFormat('en', { timeZone: id, timeZoneName: 'longOffset' })
              .formatToParts(now)
              .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
          const m = part.match(/GMT([+-])(\d{2}):(\d{2})/)
          const offsetMinutes = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
          return { id, offset: part.replace('GMT', 'UTC') || 'UTC', offsetMinutes }
        })
      },
    })

    route(ctx.api, {
      method: 'patch',
      path: '/settings/branding',
      summary: 'Change name, logos and the active theme',
      tags,
      access: 'platform.manage',
      body: Branding.partial(),
      response: Branding,
      handler: async ({ actor, body }) => {
        if (body.themeId && !allThemes().some((t) => t.id === body.themeId)) throw badRequest('Unknown theme')
        return branding.update(body, actor.kind === 'user' ? actor.user.id : null)
      },
    })

    // Logo / favicon / login picture upload: stored in the data folder, served from /api/branding/<file>
    ctx.api.post('/settings/branding/:slot', async (c) => {
      const actor = c.get('actor')
      if (!actor || actor.kind !== 'user' || !actor.permissions.has('*')) throw new HttpError('forbidden')
      const slot = c.req.param('slot') as 'logoLight' | 'logoDark' | 'mark' | 'favicon' | 'loginImage'
      if (!['logoLight', 'logoDark', 'mark', 'favicon', 'loginImage'].includes(slot)) throw notFound()
      const form = await c.req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) throw badRequest('Send the file as "file"')
      const ext = extname(file.name).toLowerCase() || '.png'
      if (!['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.avif'].includes(ext))
        throw badRequest('Use SVG, PNG, JPG, WebP or ICO')
      if (file.size > 15 * 1024 * 1024) throw new HttpError('too_large', 'Up to 15 MB')
      await mkdir(brandDir, { recursive: true })
      const name = `${slot}-${Date.now().toString(36)}${ext}`
      await writeFile(join(brandDir, name), Buffer.from(await file.arrayBuffer()))
      const next = await branding.update({ [slot]: `/api/branding/${name}` }, actor.user.id)
      return c.json(next)
    })
    ctx.api.get('/branding/:file', async (c) => {
      const name = c.req.param('file')
      if (!/^[a-zA-Z]+-[a-z0-9]+\.[a-z]+$/.test(name)) throw notFound()
      const file = join(brandDir, name)
      if (!existsSync(file)) throw notFound()
      return new Response(await readFile(file), {
        headers: {
          'content-type': MIME[extname(name)] ?? 'application/octet-stream',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    })

    route(ctx.api, {
      method: 'put',
      path: '/settings/themes/{id}',
      summary: 'Create or replace a custom theme',
      tags,
      access: 'platform.manage',
      params: z.object({ id: z.string().regex(/^[a-z0-9-]+$/) }),
      body: Theme,
      response: Theme,
      handler: async ({ actor, params, body }) => {
        if (builtIn.some((t) => t.id === params.id))
          throw badRequest('Built-in themes cannot be changed; duplicate it first')
        const theme = { ...body, id: params.id, builtIn: false }
        const list = customThemes.get().filter((t) => t.id !== params.id)
        await customThemes.set([...list, theme], actor.kind === 'user' ? actor.user.id : null)
        return theme
      },
    })

    route(ctx.api, {
      method: 'delete',
      path: '/settings/themes/{id}',
      summary: 'Delete a custom theme',
      tags,
      access: 'platform.manage',
      params: z.object({ id: z.string() }),
      response: Ok,
      handler: async ({ actor, params }) => {
        if (branding.get().themeId === params.id)
          throw badRequest('Switch to another theme before deleting this one')
        await customThemes.set(
          customThemes.get().filter((t) => t.id !== params.id),
          actor.kind === 'user' ? actor.user.id : null,
        )
        return { ok: true as const }
      },
    })

    ctx.mcp.tool({
      name: 'platform_settings',
      description:
        'Read the platform settings: time zone (all schedules use it, including on the social platforms), default language, branding and active theme.',
      input: {},
      access: 'signed-in',
      readOnly: true,
      handler: async () => ({ platform: platform.get(), branding: branding.get(), theme: activeTheme().id }),
    })
  },
})
