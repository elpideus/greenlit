import type { Placement, Platform } from '@greenlit/shared'

/** One item shown in a preview (a post can carry several: carousels). */
export interface PreviewMedia {
  kind: 'video' | 'image' | string
  /** Playable/displayable URL (the format's preview for video, the picture for images). */
  src: string | null
  poster: string | null
  width: number | null
  height: number | null
  duration: number | null
}

export interface PreviewAccount {
  name: string
  handle: string
  avatarUrl: string | null
}

export interface PlatformPreviewProps {
  platform: Platform
  placement: Placement
  media: PreviewMedia[]
  account: PreviewAccount
  caption?: string
  title?: string
  music?: { title: string; artist: string; coverUrl?: string | null } | null
  /** An audio URL for the chosen sound (plays along when the preview is unmuted). */
  musicSrc?: string | null
  musicStartAt?: number
  location?: string | null
  audio?: { original: number; music: number }
  firstComment?: string
  /** Width of the screen in CSS px (the phone keeps the proportions of a 390×844 screen). */
  width?: number
  /** Draw the phone around the screen. */
  device?: boolean
  /** Shade the areas the app's own interface covers (from @greenlit/platforms). */
  safeZones?: boolean
  /** Start the video at this time (seconds). */
  startAt?: number
  /** Cover shown before playing (videos). */
  coverTime?: number | null
  autoPlay?: boolean
  className?: string
}

/** The logical screen every surface is drawn on, then scaled to `width`. */
export const SCREEN = { width: 390, height: 844, statusBar: 50, homeBar: 30 }
