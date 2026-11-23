import { z } from 'zod'
import { Id, IsoDate, UserRef } from '../common.ts'

export const Notification = z.object({
  id: Id,
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  actor: UserRef.nullable(),
  readAt: IsoDate.nullable(),
  createdAt: IsoDate,
})
export type Notification = z.infer<typeof Notification>
