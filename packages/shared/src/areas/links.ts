import { z } from 'zod'
import { Id, IsoDate } from '../common.ts'

export const LinkableType = z.enum(['media', 'composition', 'post', 'project'])
export type LinkableType = z.infer<typeof LinkableType>

export const EntityRef = z.object({ type: LinkableType, id: Id })
export type EntityRef = z.infer<typeof EntityRef>

/**
 * Directed relations. `from <relation> to`, e.g. "raw clip  source_of  final cut".
 * The UI shows the inverse wording when you look at a link from its `to` side.
 */
export const LinkRelation = z.enum([
  'source_of',
  'uses',
  'rendered_to',
  'related',
  'reference_for',
  'published_as',
])
export type LinkRelation = z.infer<typeof LinkRelation>

export const LINK_WORDING: Record<LinkRelation, { forward: string; inverse: string }> = {
  source_of: { forward: 'Source of', inverse: 'Made from' },
  uses: { forward: 'Uses', inverse: 'Used in' },
  rendered_to: { forward: 'Rendered to', inverse: 'Rendered from' },
  related: { forward: 'Related to', inverse: 'Related to' },
  reference_for: { forward: 'Reference for', inverse: 'Reference' },
  published_as: { forward: 'Published as', inverse: 'Publishes' },
}

export const LinkEnd = EntityRef.extend({
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  kind: z.string().nullable(),
})

export const Link = z.object({
  id: Id,
  from: LinkEnd,
  to: LinkEnd,
  relation: LinkRelation,
  note: z.string(),
  /** Created by Greenlit itself (editor usage, renders); users can still remove it. */
  auto: z.boolean(),
  createdAt: IsoDate,
})
export type Link = z.infer<typeof Link>

export const CreateLinkInput = z.object({
  from: EntityRef,
  to: EntityRef,
  relation: LinkRelation.default('related'),
  note: z.string().max(500).default(''),
})
export type CreateLinkInput = z.infer<typeof CreateLinkInput>
