import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ t: ['display', 'title-1', 'title-2', 'headline', 'body', 'callout', 'caption', 'micro', 'meta', 'label'] }],
    },
  },
})

/** Class names, later ones winning over conflicting earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
