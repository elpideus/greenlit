import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { type Actor, assertCan } from './actor.ts'
import { HttpError } from './errors.ts'
import type { Logger } from './logger.ts'

export type AppEnv = { Variables: { actor: Actor | null; requestId: string } }
export type Api = OpenAPIHono<AppEnv>
export type Ctx = Context<AppEnv>

export function createApi(): Api {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new HttpError('validation_failed', 'Some fields are not valid', result.error.issues)
      }
    },
  })
}

/**
 * - `public`: anyone, signed in or not
 * - `signed-in`: any signed-in user (also share-link sessions)
 * - anything else: a permission name declared by a module
 */
export type Access = 'public' | 'signed-in' | (string & {})

type AnyObject = z.ZodObject<z.ZodRawShape>

export interface RouteSpec<
  P extends AnyObject | undefined,
  Q extends AnyObject | undefined,
  B extends z.ZodType | undefined,
  R extends z.ZodType | undefined,
> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  /** OpenAPI-style path, e.g. `/media/{id}` (mounted under /api). */
  path: string
  summary: string
  description?: string
  tags?: string[]
  access: Access
  params?: P
  query?: Q
  body?: B
  response?: R
  status?: 200 | 201 | 202 | 204
  handler: (args: {
    c: Ctx
    actor: Actor
    params: P extends AnyObject ? z.infer<P> : Record<string, never>
    query: Q extends AnyObject ? z.infer<Q> : Record<string, never>
    body: B extends z.ZodType ? z.infer<B> : undefined
  }) =>
    | Promise<(R extends z.ZodType ? z.input<R> : unknown) | Response>
    | (R extends z.ZodType ? z.input<R> : unknown)
}

/** Declares a JSON route with validation, permissions and OpenAPI documentation in one place. */
export function route<
  P extends AnyObject | undefined = undefined,
  Q extends AnyObject | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  R extends z.ZodType | undefined = undefined,
>(app: Api, spec: RouteSpec<P, Q, B, R>) {
  const status = spec.status ?? 200
  const definition = createRoute({
    method: spec.method,
    path: spec.path,
    summary: spec.summary,
    description: spec.description,
    tags: spec.tags,
    security: spec.access === 'public' ? [] : [{ session: [] }, { bearer: [] }],
    request: {
      ...(spec.params ? { params: spec.params } : {}),
      ...(spec.query ? { query: spec.query } : {}),
      ...(spec.body
        ? { body: { content: { 'application/json': { schema: spec.body } }, required: true } }
        : {}),
    },
    responses: {
      [status]: spec.response
        ? { description: 'OK', content: { 'application/json': { schema: spec.response } } }
        : { description: 'OK' },
      default: { description: 'Error' },
    },
  })
  // biome-ignore lint/suspicious/noExplicitAny: the typed facade above is what modules see
  ;(app as any).openapi(definition, async (c: Ctx) => {
    const actor = c.get('actor')
    if (spec.access !== 'public') {
      if (!actor) throw new HttpError('unauthenticated', 'Sign in first')
      if (spec.access !== 'signed-in') assertCan(actor, spec.access)
    }
    const valid = (target: string) => {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: hono's validated-data accessor
        return (c.req as any).valid(target)
      } catch {
        return undefined
      }
    }
    const result = await spec.handler({
      c,
      actor: actor as Actor,
      params: (spec.params ? valid('param') : {}) as never,
      query: (spec.query ? valid('query') : {}) as never,
      body: (spec.body ? valid('json') : undefined) as never,
    })
    if (result instanceof Response) return result
    if (status === 204) return c.body(null, 204)
    return c.json(result ?? { ok: true }, status)
  })
}

export function requireActor(c: Ctx): Actor {
  const actor = c.get('actor')
  if (!actor) throw new HttpError('unauthenticated', 'Sign in first')
  return actor
}

export function errorHandler(log: Logger) {
  return (err: Error, c: Ctx) => {
    if (err instanceof HttpError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status as 400,
      )
    }
    if (err instanceof z.ZodError) {
      return c.json(
        { error: { code: 'validation_failed', message: 'Some fields are not valid', details: err.issues } },
        422,
      )
    }
    // Hono's own HTTPException (body limit etc.)
    const status = (err as { status?: number }).status
    if (status && status >= 400 && status < 500) {
      return c.json(
        { error: { code: status === 413 ? 'too_large' : 'bad_request', message: err.message } },
        status as 400,
      )
    }
    log.error({ err, path: c.req.path, requestId: c.get('requestId') }, 'unhandled error')
    return c.json({ error: { code: 'internal', message: 'Something went wrong on the server' } }, 500)
  }
}

export const requestId = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  c.set('requestId', c.req.header('x-request-id') ?? crypto.randomUUID())
  await next()
}

export const IdParams = z.object({ id: z.uuid() })
export const Ok = z.object({ ok: z.literal(true) })
