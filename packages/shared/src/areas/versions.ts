import { z } from 'zod'
import { ChangeSource, Id, IsoDate, UserRef } from '../common.ts'

export const Revision = z.object({
  id: Id,
  entityType: z.string(),
  entityId: Id,
  seq: z.number().int(),
  author: UserRef.nullable(),
  source: ChangeSource,
  /** Fields that changed compared with the previous revision. */
  changed: z.array(z.string()),
  summary: z.string(),
  name: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: IsoDate,
  data: z.record(z.string(), z.unknown()).optional(),
})
export type Revision = z.infer<typeof Revision>

export const LabelRevisionInput = z.object({
  name: z.string().max(120).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
})
