import { create } from 'zustand'

const KEY = 'gl.graph.process'
const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

interface ProcessState {
  /** The viewer's process strip is open (kept for the next item and the next visit). */
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useProcessStrip = create<ProcessState>((set, get) => ({
  open: read(),
  setOpen: (open) => {
    try {
      localStorage.setItem(KEY, open ? '1' : '0')
    } catch {}
    set({ open })
  },
  toggle: () => get().setOpen(!get().open),
}))
