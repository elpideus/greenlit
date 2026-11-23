import { create } from 'zustand'

export interface ShareTarget {
  type: 'post' | 'media' | 'project' | 'calendar'
  id: string | null
  title: string
}

/** Any menu item opens the dialog through this store; the host lives in `globals`. */
export const useShareDialog = create<{
  target: ShareTarget | null
  open: (t: ShareTarget) => void
  close: () => void
}>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))

export const openShare = (t: ShareTarget) => useShareDialog.getState().open(t)
