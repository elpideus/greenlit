import { type ErrorCode, httpStatusFor } from '@greenlit/shared'

export class HttpError extends Error {
  readonly code: ErrorCode
  readonly details: unknown
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code.replaceAll('_', ' '))
    this.code = code
    this.details = details
  }
  get status(): number {
    return httpStatusFor[this.code]
  }
}

export const notFound = (what = 'Not found') => new HttpError('not_found', what)
export const forbidden = (why = 'You are not allowed to do this') => new HttpError('forbidden', why)
export const badRequest = (why: string, details?: unknown) => new HttpError('bad_request', why, details)
export const conflict = (why: string, details?: unknown) => new HttpError('conflict', why, details)
