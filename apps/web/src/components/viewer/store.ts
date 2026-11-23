import type { Placement, Platform } from '@greenlit/shared'
import { create } from 'zustand'

/**
 * The media viewer's shared state. The viewer (features/media) owns it and drives playback; other features read it
 * and draw on the frame through the `media.viewer.overlay` slot (note pins, platform previews) or add controls
 * through `media.viewer.tools`. Coordinates on the frame are normalised 0..1 (see FramePoint in @greenlit/shared).
 */
export interface FrameRect {
  /** The displayed picture inside the stage element, in CSS px relative to the stage. */
  x: number
  y: number
  width: number
  height: number
}

export interface NoteDraft {
  point: { x: number; y: number }
  region: { x: number; y: number; w: number; h: number } | null
  strokes: { x: number; y: number }[][]
  time: number | null
  frame: number | null
}

export interface ViewerControls {
  play: () => void
  pause: () => void
  seek: (seconds: number) => void
}

export interface ViewerState {
  mediaId: string | null
  formatId: string | null
  kind: string | null
  time: number
  duration: number
  fps: number
  playing: boolean
  muted: boolean
  frame: FrameRect | null
  /** Natural size of the current format. */
  natural: { width: number; height: number } | null
  /** Show the frame as it would look on a platform (drawn by the posts feature's overlay). */
  previewAs: { platform: Platform; placement: Placement } | null
  /** A note being placed on the frame (click = point, drag = region). */
  draft: NoteDraft | null
  /** Note under the pointer / opened in the panel: their pins highlight on the frame. */
  hoverNote: string | null
  activeNote: string | null
  /** Whether clicking the frame places a note (reviewers and admins while the Notes panel is open). */
  notesEnabled: boolean
  /** The side panel tab to show (`media.panels` entry id); features set it to bring their tab forward. */
  tab: string | null
  /** Playback options. */
  rate: number
  loop: boolean
  volume: number
  controls: ViewerControls | null
  set: (patch: Partial<Omit<ViewerState, 'set' | 'reset'>>) => void
  reset: () => void
}

const initial = {
  mediaId: null,
  formatId: null,
  kind: null,
  time: 0,
  duration: 0,
  fps: 30,
  playing: false,
  muted: false,
  frame: null,
  natural: null,
  previewAs: null,
  draft: null,
  hoverNote: null,
  activeNote: null,
  notesEnabled: true,
  tab: null,
  rate: 1,
  loop: false,
  volume: 1,
  controls: null,
}

export const useViewer = create<ViewerState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set(initial),
}))

/** Imperative access for event handlers (no re-render). */
export const viewer = {
  get: () => useViewer.getState(),
  seek: (t: number) => useViewer.getState().controls?.seek(t),
  pause: () => useViewer.getState().controls?.pause(),
  play: () => useViewer.getState().controls?.play(),
}
