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

/**
 * A name to sign in with instead of an email: lower-case letters, numbers, dots, dashes, underscores.
 * Never contains "@", so a sign-in name is an email exactly when it has one.
 */
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,31}$/, 'Use 2 to 32 letters, numbers, dots, dashes or underscores')

export const User = z.object({
  id: Id,
  /** Everyone has an email, a username or both: either one signs them in. */
  email: z.email().nullable(),
  username: z.string().nullable(),
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

export const CreateUserInput = z
  .object({
    email: z.email().nullable().optional(),
    username: Username.nullable().optional(),
    displayName: z.string().min(1).max(80),
    role: Role,
    password: Password,
    locale: Locale.default('en'),
  })
  .refine((u) => u.email || u.username, { message: 'Give them an email or a username to sign in with' })
export type CreateUserInput = z.infer<typeof CreateUserInput>

export const UpdateUserInput = z.object({
  /** null removes it (they keep signing in with the other one). */
  email: z.email().nullable().optional(),
  username: Username.nullable().optional(),
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
  /** Username or email. */
  login: z.string().min(1).max(200),
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
