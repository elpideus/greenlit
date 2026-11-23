import { z } from 'zod'
import { Id, IsoDate, UserRef } from '../common.ts'

export const ShareTargetType = z.enum(['post', 'media', 'project', 'calendar'])

export const ShareLink = z.object({
  id: Id,
  user: UserRef,
  targetType: ShareTargetType,
  targetId: Id.nullable(),
  targetTitle: z.string(),
  expiresAt: IsoDate,
  usedAt: IsoDate.nullable(),
  createdBy: UserRef,
  createdAt: IsoDate,
  /** Only returned once, when the link is created. */
  url: z.string().optional(),
})
export type ShareLink = z.infer<typeof ShareLink>

export const CreateShareLinkInput = z.object({
  userId: Id,
  targetType: ShareTargetType,
  targetId: Id.nullable().default(null),
  expiresInHours: z
    .number()
    .min(1)
    .max(24 * 90)
    .default(72),
})
