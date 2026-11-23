import { create } from 'zustand'

/** Composer state shared by the Notes panel and the frame overlay. */
export const useNotesUi = create<{
  /** Bumped when something wants the composer focused (a click on the frame). */
  focus: number
  /** The next drags on the frame draw freehand strokes instead of marking an area. */
  drawing: boolean
  set: (p: Partial<{ focus: number; drawing: boolean }>) => void
}>((set) => ({ focus: 0, drawing: false, set: (p) => set(p) }))

export function focusComposer() {
  useNotesUi.setState((s) => ({ focus: s.focus + 1 }))
}
