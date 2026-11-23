import { z } from 'zod'

export const TagCount = z.object({ name: z.string(), count: z.number().int() })
export type TagCount = z.infer<typeof TagCount>

const TagName = z.string().trim().min(1).max(60)

/** Rename one tag, or merge several into one: every item carrying any of `from` carries `to` instead. */
export const RenameTagsInput = z.object({ from: z.array(TagName).min(1).max(500), to: TagName })
export type RenameTagsInput = z.infer<typeof RenameTagsInput>

/** Remove tags from every item that carries them. */
export const DeleteTagsInput = z.object({ names: z.array(TagName).min(1).max(500) })
export type DeleteTagsInput = z.infer<typeof DeleteTagsInput>

/** How many media items a rename or delete changed. */
export const TagChangeResult = z.object({ count: z.number().int() })
export type TagChangeResult = z.infer<typeof TagChangeResult>

/** Tags are compared case-insensitively with collapsed whitespace; the first spelling used is kept. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').replace(/\s+/g, ' ')
}

export function tagKey(tag: string): string {
  return normalizeTag(tag).toLocaleLowerCase()
}
