import { z } from 'zod'
import { Id, IsoDate, UserRef } from '../common.ts'
import { BrandSummary } from './brands.ts'
import { PlaceRef } from './places.ts'

/** `project`: work (a property, a shoot, a campaign); `brand`: a brand kit (logos, colours, fonts, templates...). */
export const ProjectKind = z.enum(['project', 'brand'])
export type ProjectKind = z.infer<typeof ProjectKind>

export const Project = z.object({
  id: Id,
  kind: ProjectKind,
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
  /** Brand kits: what their card shows (logo, colours, fonts). */
  brand: BrandSummary.nullable().optional(),
})
export type Project = z.infer<typeof Project>

export const CreateProjectInput = z.object({
  kind: ProjectKind.default('project'),
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
