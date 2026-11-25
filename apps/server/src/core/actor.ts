import type { ChangeSource, Locale, Role } from '@greenlit/shared'
import { forbidden, HttpError } from './errors.ts'

export interface ActorUser {
  id: string
  email: string | null
  username: string | null
  displayName: string
  avatarUrl: string | null
  role: Role
  locale: Locale
}

export interface ShareScope {
  linkId: string
  targetType: string
  targetId: string | null
}

/** Who is doing something. Every service call receives one, so permissions and history are never guessed. */
export type Actor =
  | {
      kind: 'user'
      user: ActorUser
      permissions: ReadonlySet<string>
      source: ChangeSource
      sessionId?: string
      tokenId?: string
      share?: ShareScope
    }
  | { kind: 'system'; source: 'system' | 'sync'; label?: string }

export const systemActor = (label = 'system', source: 'system' | 'sync' = 'system'): Actor => ({
  kind: 'system',
  source,
  label,
})

export function can(actor: Actor | null | undefined, permission: string): boolean {
  if (!actor) return false
  if (actor.kind === 'system') return true
  return actor.permissions.has('*') || actor.permissions.has(permission)
}

export function assertCan(actor: Actor | null | undefined, permission: string): asserts actor is Actor {
  if (!actor) throw new HttpError('unauthenticated', 'Sign in first')
  if (!can(actor, permission)) throw forbidden()
}

export function actorUserId(actor: Actor): string | null {
  return actor.kind === 'user' ? actor.user.id : null
}

export function isAdmin(actor: Actor): boolean {
  return actor.kind === 'system' || actor.user.role === 'admin'
}
