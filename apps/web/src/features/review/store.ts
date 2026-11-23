import { create } from 'zustand'

/** The review room: which item is open, and what happens after a decision (move to the next one). */
export const useReviewRoom = create<{
  /** Set by the review room while it is open; the decision area calls it after deciding. */
  advance: (() => void) | null
  set: (p: { advance: (() => void) | null }) => void
}>((set) => ({ advance: null, set: (p) => set(p) }))

/** Opens the "Send for review" dialog (mounted once by this feature). */
export const useSendDialog = create<{
  ids: string[] | null
  open: (ids: string[]) => void
  close: () => void
}>((set) => ({
  ids: null,
  open: (ids) => set({ ids }),
  close: () => set({ ids: null }),
}))

export const openSendForReview = (ids: string[]) => useSendDialog.getState().open(ids)
