import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  ApiToken,
  CreateApiTokenInput,
  CreateUserInput,
  LoginInput,
  Me,
  UpdateProfileInput,
  UpdateUserInput,
  User,
  UserRef,
} from '@greenlit/shared'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { can } from '../../core/actor.ts'
import { badRequest, HttpError } from '../../core/errors.ts'
import { type Ctx, IdParams, Ok, route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { SESSION_COOKIE, UsersService } from './service.ts'

declare module '../../core/services.ts' {
  interface Services {
    users: UsersService
  }
}
declare module '../../core/events.ts' {
  interface Events {
    'user.changed': { id: string }
  }
}

const attempts = new Map<string, { n: number; until: number }>()
function throttle(key: string) {
  const now = Date.now()
  const a = attempts.get(key)
  if (a && a.until > now && a.n >= 8)
    throw new HttpError('rate_limited', 'Too many attempts. Wait a minute and try again.')
  if (!a || a.until <= now) attempts.set(key, { n: 1, until: now + 60_000 })
  else a.n++
}

export function clientIp(c: Ctx) {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}

export function setSessionCookie(c: Ctx, token: string, days: number, publicUrl: string) {
  const secure = publicUrl.startsWith('https') || c.req.header('x-forwarded-proto') === 'https'
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: days * 86_400,
  })
}

export default defineModule({
  id: 'users',
  name: 'Users & sign-in',
  description: 'Accounts, roles, profiles, sessions and API tokens.',
  permissions: {
    'users.manage': { description: 'Add people, change their details, roles and passwords', roles: [] },
    'users.directory': { description: 'See who else uses Greenlit', roles: ['reviewer'] },
  },
  setup(ctx) {
    const svc = new UsersService(ctx)
    ctx.services.provide('users', svc)

    ctx.addActorResolver(async (c) => {
      const auth = c.req.header('authorization')
      if (auth?.startsWith('Bearer glt_')) {
        const source = c.req.path.startsWith('/api/mcp') ? 'mcp' : 'api'
        return svc.resolveToken(auth.slice(7).trim(), source)
      }
      const token = getCookie(c, SESSION_COOKIE)
      return token ? svc.resolveSession(token) : null
    })

    const api = ctx.api
    const tags = ['Users']

    route(api, {
      method: 'post',
      path: '/auth/login',
      summary: 'Sign in with email and password',
      tags,
      access: 'public',
      body: LoginInput,
      response: Me,
      handler: async ({ c, body }) => {
        throttle(`${clientIp(c)}:${body.email.toLowerCase()}`)
        const row = await svc.login(body.email, body.password)
        const days = body.remember ? 60 : 1
        const token = await svc.createSession(row.id, {
          days,
          userAgent: c.req.header('user-agent'),
          ip: clientIp(c),
        })
        setSessionCookie(c, token, days, ctx.config.publicUrl)
        return svc.me(svc.actorFor(row, 'web'))
      },
    })

    route(api, {
      method: 'post',
      path: '/auth/logout',
      summary: 'Sign out of this browser',
      tags,
      access: 'public',
      response: Ok,
      handler: async ({ c }) => {
        const token = getCookie(c, SESSION_COOKIE)
        if (token) await svc.revokeSession(token)
        deleteCookie(c, SESSION_COOKIE, { path: '/' })
        return { ok: true as const }
      },
    })

    route(api, {
      method: 'get',
      path: '/auth/me',
      summary: 'Who am I',
      tags,
      access: 'signed-in',
      response: Me,
      handler: ({ actor }) => svc.me(actor),
    })

    route(api, {
      method: 'patch',
      path: '/me',
      summary: 'Update my profile or password',
      tags,
      access: 'signed-in',
      body: UpdateProfileInput,
      response: Me,
      handler: async ({ actor, body }) => {
        if (actor.kind !== 'user') throw badRequest('Not a person')
        if (actor.share) throw new HttpError('forbidden', 'Share-link sessions cannot change the profile')
        if (body.newPassword) {
          const row = await svc.get(actor.user.id)
          if (!body.currentPassword || !(await svc.verifyPassword(row, body.currentPassword)))
            throw new HttpError('forbidden', 'Your current password is not right')
        }
        await svc.update(
          actor.user.id,
          { displayName: body.displayName, locale: body.locale, password: body.newPassword },
          actor,
        )
        return svc.me(actor)
      },
    })

    const readImage = async (c: Ctx) => {
      const form = await c.req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) throw badRequest('Send the picture as "file"')
      if (file.size > 20 * 1024 * 1024) throw new HttpError('too_large', 'Pictures up to 20 MB')
      return Buffer.from(await file.arrayBuffer())
    }

    api.post('/me/avatar', async (c) => {
      const actor = c.get('actor')
      if (actor?.kind !== 'user' || actor.share) throw new HttpError('unauthenticated')
      await svc.setAvatar(actor.user.id, await readImage(c))
      return c.json(await svc.me(actor))
    })
    api.delete('/me/avatar', async (c) => {
      const actor = c.get('actor')
      if (actor?.kind !== 'user' || actor.share) throw new HttpError('unauthenticated')
      await svc.clearAvatar(actor.user.id)
      return c.json(await svc.me(actor))
    })
    api.post('/users/:id/avatar', async (c) => {
      const actor = c.get('actor')
      if (!can(actor, 'users.manage')) throw new HttpError('forbidden')
      await svc.setAvatar(c.req.param('id'), await readImage(c))
      return c.json(svc.toUser(await svc.get(c.req.param('id'))))
    })
    api.get('/users/:id/avatar', async (c) => {
      const row = await svc.get(c.req.param('id'))
      const file = row.avatarPath ? join(svc.avatarDir(), row.avatarPath) : null
      if (!file || !existsSync(file))
        return c.json({ error: { code: 'not_found', message: 'No picture' } }, 404)
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' },
      })
    })

    route(api, {
      method: 'get',
      path: '/me/tokens',
      summary: 'My API tokens',
      tags,
      access: 'signed-in',
      response: z.array(ApiToken),
      handler: async ({ actor }) => {
        if (actor.kind !== 'user') return []
        const rows = await svc.listTokens(actor.user.id)
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          prefix: r.prefix,
          createdAt: r.createdAt.toISOString(),
          lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
          expiresAt: r.expiresAt?.toISOString() ?? null,
        }))
      },
    })

    route(api, {
      method: 'post',
      path: '/me/tokens',
      summary: 'Create an API token (shown once)',
      tags,
      access: 'signed-in',
      body: CreateApiTokenInput,
      response: z.object({ token: z.string(), info: ApiToken }),
      status: 201,
      handler: async ({ actor, body }) => {
        if (actor.kind !== 'user' || actor.share) throw new HttpError('forbidden')
        const { token, row } = await svc.createToken(actor.user.id, body.name, body.expiresInDays)
        return {
          token,
          info: {
            id: row.id,
            name: row.name,
            prefix: row.prefix,
            createdAt: row.createdAt.toISOString(),
            lastUsedAt: null,
            expiresAt: row.expiresAt?.toISOString() ?? null,
          },
        }
      },
    })

    route(api, {
      method: 'delete',
      path: '/me/tokens/{id}',
      summary: 'Revoke an API token',
      tags,
      access: 'signed-in',
      params: IdParams,
      response: Ok,
      handler: async ({ actor, params }) => {
        if (actor.kind === 'user') await svc.revokeToken(actor.user.id, params.id)
        return { ok: true as const }
      },
    })

    route(api, {
      method: 'get',
      path: '/users',
      summary: 'Everyone with an account',
      tags,
      access: 'users.manage',
      response: z.array(User),
      handler: () => svc.list(),
    })

    route(api, {
      method: 'get',
      path: '/users/directory',
      summary: 'People you can mention or send things to',
      tags,
      access: 'users.directory',
      response: z.array(UserRef.extend({ role: z.string() })),
      handler: async () =>
        (await svc.list())
          .filter((u) => !u.disabled)
          .map((u) => ({ id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, role: u.role })),
    })

    route(api, {
      method: 'post',
      path: '/users',
      summary: 'Add a person',
      tags,
      access: 'users.manage',
      body: CreateUserInput,
      response: User,
      status: 201,
      handler: ({ body }) => svc.create(body),
    })

    route(api, {
      method: 'patch',
      path: '/users/{id}',
      summary: "Change someone's details, role or password",
      tags,
      access: 'users.manage',
      params: IdParams,
      body: UpdateUserInput,
      response: User,
      handler: ({ actor, params, body }) => svc.update(params.id, body, actor),
    })

    route(api, {
      method: 'delete',
      path: '/users/{id}',
      summary: 'Delete an account',
      tags,
      access: 'users.manage',
      params: IdParams,
      response: Ok,
      handler: async ({ actor, params }) => {
        await svc.remove(params.id, actor)
        return { ok: true as const }
      },
    })

    route(api, {
      method: 'post',
      path: '/users/{id}/sign-out',
      summary: 'Sign someone out everywhere',
      tags,
      access: 'users.manage',
      params: IdParams,
      response: Ok,
      handler: async ({ params }) => {
        await svc.revokeSessions(params.id)
        return { ok: true as const }
      },
    })

    ctx.mcp.tool({
      name: 'whoami',
      description: 'Who the API token belongs to, their role and permissions.',
      input: {},
      access: 'signed-in',
      readOnly: true,
      handler: async (_i, { actor }) => svc.me(actor),
    })
    ctx.mcp.tool({
      name: 'users_list',
      description: 'List the people who can use Greenlit (id, name, role). Use ids to send media for review.',
      input: {},
      access: 'users.directory',
      readOnly: true,
      handler: async () =>
        (await svc.list()).map((u) => ({
          id: u.id,
          name: u.displayName,
          role: u.role,
          disabled: u.disabled,
        })),
    })
  },
})
