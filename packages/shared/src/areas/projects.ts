import { z } from 'zod'
import { Id, IsoDate, UserRef } from '../common.ts'
import { PlaceRef } from './places.ts'

export const Project = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  coverUrl: z.string().nullable(),
  color: z.string().nullable(),
  places: z.array(PlaceRef),
  mediaCount: z.number().int(),
  compositionCount: z.number().int(),
  sizeBytes: z.number(),
  createdBy: UserRef.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  archivedAt: IsoDate.nullable(),
  /** Only admins see this: reviewers the project is hidden from. */
  hiddenFrom: z.array(Id).optional(),
})
export type Project = z.infer<typeof Project>

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(20_000).default(''),
  color: z.string().nullable().default(null),
})
export type CreateProjectInput = z.infer<typeof CreateProjectInput>

export const UpdateProjectInput = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(20_000).optional(),
  color: z.string().nullable().optional(),
  coverMediaId: Id.nullable().optional(),
  hiddenFrom: z.array(Id).optional(),
  archived: z.boolean().optional(),
})
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>
