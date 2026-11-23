import { create } from 'zustand'

/** How the viewer shows a format that has a depth map: the picture, the map, the two side by side, or in 3D. */
export type DepthView = 'picture' | 'depth' | 'split' | '3d'

interface DepthState {
  view: DepthView
  /** The last view other than the picture (the `D` key goes back to it). */
  last: Exclude<DepthView, 'picture'>
  /** Where the split line is, 0..1 from the left (picture left of it, depth right). */
  split: number
  setView: (view: DepthView) => void
  toggle: () => void
  setSplit: (split: number) => void
}

export const useDepthView = create<DepthState>((set, get) => ({
  view: 'picture',
  last: 'depth',
  split: 0.5,
  setView: (view) => set(view === 'picture' ? { view } : { view, last: view }),
  toggle: () => set({ view: get().view === 'picture' ? get().last : 'picture' }),
  setSplit: (split) => set({ split: Math.max(0, Math.min(1, split)) }),
}))
