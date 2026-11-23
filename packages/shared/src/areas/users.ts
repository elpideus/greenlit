import { z } from 'zod'
import { Id, IsoDate } from '../common.ts'

/**
 * Roles are coarse; what a role may do is the set of permissions the server modules grant it.
 * Adding a role = add it here and grant permissions to it in the modules that matter.
 */
export const Role = z.enum(['admin', 'reviewer'])
export type Role = z.infer<typeof Role>

export const Locale = z.enum(['en', 'it'])
export type Locale = z.infer<typeof Locale>

export const User = z.object({
  id: Id,
  email: z.email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: Role,
  locale: Locale,
  disabled: z.boolean(),
  createdAt: IsoDate,
  lastSeenAt: IsoDate.nullable(),
})
export type User = z.infer<typeof User>

export const Me = User.extend({
  permissions: z.array(z.string()),
  /** Signed in through a share link: limited to what the link points at. */
  viaShareLink: z.boolean(),
})
export type Me = z.infer<typeof Me>

export const Password = z.string().min(8, 'At least 8 characters').max(200)

export const CreateUserInput = z.object({
  email: z.email(),
  displayName: z.string().min(1).max(80),
  role: Role,
  password: Password,
  locale: Locale.default('en'),
})
export type CreateUserInput = z.infer<typeof CreateUserInput>

export const UpdateUserInput = z.object({
  email: z.email().optional(),
  displayName: z.string().min(1).max(80).optional(),
  role: Role.optional(),
  locale: Locale.optional(),
  disabled: z.boolean().optional(),
  password: Password.optional(),
})
export type UpdateUserInput = z.infer<typeof UpdateUserInput>

export const UpdateProfileInput = z.object({
  displayName: z.string().min(1).max(80).optional(),
  locale: Locale.optional(),
  currentPassword: z.string().optional(),
  newPassword: Password.optional(),
})
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>

export const LoginInput = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().default(true),
})
export type LoginInput = z.infer<typeof LoginInput>

export const ApiToken = z.object({
  id: Id,
  name: z.string(),
  prefix: z.string(),
  createdAt: IsoDate,
  lastUsedAt: IsoDate.nullable(),
  expiresAt: IsoDate.nullable(),
})
export type ApiToken = z.infer<typeof ApiToken>

export const CreateApiTokenInput = z.object({
  name: z.string().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
})
