import { z } from 'zod'

/** Stable machine-readable error codes. The web app maps them to localized messages. */
export const ErrorCode = z.enum([
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'gone',
  'too_large',
  'rate_limited',
  'unavailable',
  'bad_gateway',
  'internal',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBody>

export const httpStatusFor: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  too_large: 413,
  rate_limited: 429,
  unavailable: 503,
  // Never answer 502/504 from the origin: reverse proxies such as Cloudflare replace
  // those with their own HTML page, which hides our JSON error from the client.
  bad_gateway: 503,
  internal: 500,
}
