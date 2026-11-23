import type { Transition } from 'motion/react'

/**
 * Motion presets. Critically damped springs (no bounce) for anything that moves or responds; a little bounce only
 * after a gesture that carried momentum, and when a lamp lights. Durations are a spring's perceived response.
 */
export const spring = {
  /** Default for movement and layout. */
  move: { type: 'spring', bounce: 0, duration: 0.38 } satisfies Transition,
  /** Small things snapping into place (indicators, toggles). */
  snap: { type: 'spring', bounce: 0, duration: 0.26 } satisfies Transition,
  /** Sheets and drawers released after a drag. */
  sheet: { type: 'spring', bounce: 0.12, duration: 0.34 } satisfies Transition,
  /** A lamp lighting: the only overshoot in the product. */
  lamp: { type: 'spring', bounce: 0.42, duration: 0.42 } satisfies Transition,
}

export const ease = [0.22, 1, 0.36, 1] as const

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.18, ease },
}

/** Content arriving: rises 6 px while fading in. */
export const rise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: 0.28, ease },
}

/** Staggered list entrance; pass the index. Keep lists short: only the first 12 items stagger. */
export function stagger(i: number, base = 0.025) {
  return { ...rise, transition: { ...rise.transition, delay: Math.min(i, 12) * base } }
}
