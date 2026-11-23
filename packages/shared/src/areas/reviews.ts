import { z } from 'zod'
import { Id, IsoDate, UserRef } from '../common.ts'

export const ReviewDecision = z.enum(['approved', 'changes_requested'])

export const ReviewRequest = z.object({
  id: Id,
  mediaId: Id,
  requestedBy: UserRef,
  reviewers: z.array(UserRef),
  message: z.string(),
  dueAt: IsoDate.nullable(),
  status: z.enum(['open', 'approved', 'changes_requested', 'cancelled']),
  decisions: z.array(
    z.object({ reviewer: UserRef, decision: ReviewDecision, note: z.string(), at: IsoDate }),
  ),
  createdAt: IsoDate,
})
export type ReviewRequest = z.infer<typeof ReviewRequest>

export const SendForReviewInput = z.object({
  mediaIds: z.array(Id).min(1).max(200),
  reviewerIds: z.array(Id).min(1),
  message: z.string().max(5000).default(''),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
})

export const DecideInput = z.object({
  decision: ReviewDecision,
  note: z.string().max(5000).default(''),
})
