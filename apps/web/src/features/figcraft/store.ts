import { create } from 'zustand'
import type { FigcraftHost } from './host'

/** A file FigCraft handed over that is not the document: an export (PNG, SVG, PDF…) or a Save As copy. */
export interface HandedFile {
  id: string
  name: string
  mime: string
  bytes: ArrayBuffer
  /** A design document under a new name (Save As, or another tab's document). */
  document: boolean
  state: 'waiting' | 'adding' | 'added' | 'failed'
  mediaId?: string
}

interface DesignStage {
  /** The format FigCraft shows. */
  formatId: string | null
  phase: 'starting' | 'opening' | 'ready' | 'failed'
  error: string | null
  /** view = the canvas alone; edit = FigCraft's panels and tools. */
  mode: 'view' | 'edit'
  dirty: boolean
  saving: boolean
  /** Families the document uses that neither FigCraft nor Greenlit has. */
  missingFonts: string[]
  /** Someone saved a newer file while this one is open. */
  newer: boolean
  host: FigcraftHost | null
  handed: HandedFile[]
  set: (patch: Partial<DesignStage>) => void
  reset: () => void
}

const initial = {
  formatId: null,
  phase: 'starting' as const,
  error: null,
  dirty: false,
  saving: false,
  missingFonts: [],
  newer: false,
  host: null,
  handed: [],
}

/** What the design stage, its top-bar tools and the Info section share (one design is open at a time). */
export const useDesign = create<DesignStage>((set) => ({
  ...initial,
  mode: 'view',
  set: (patch) => set(patch),
  reset: () => set(initial),
}))
