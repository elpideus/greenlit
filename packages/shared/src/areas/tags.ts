import { z } from 'zod'

export const TagCount = z.object({ name: z.string(), count: z.number().int() })
export type TagCount = z.infer<typeof TagCount>

/** Tags are compared case-insensitively with collapsed whitespace; the first spelling used is kept. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').replace(/\s+/g, ' ')
}

export function tagKey(tag: string): string {
  return normalizeTag(tag).toLocaleLowerCase()
}
