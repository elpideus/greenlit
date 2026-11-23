import { DeleteTagsInput, normalizeTag, RenameTagsInput, TagChangeResult, TagCount } from '@greenlit/shared'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Actor } from '../../core/actor.ts'
import { badRequest } from '../../core/errors.ts'
import { route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { media } from '../media/schema.ts'

export interface TagsService {
  /** Tags in use with how many items carry each (most used spelling wins), optionally filtered by prefix/substring. */
  counts: (actor: Actor, opts?: { q?: string; limit?: number }) => Promise<TagCount[]>
  /** Rename a tag (or merge several into one) on every item in the library. Returns how many items changed. */
  rename: (actor: Actor, from: string[], to: string) => Promise<number>
  /** Remove tags from every item in the library. Returns how many items changed. */
  remove: (actor: Actor, names: string[]) => Promise<number>
}
declare module '../../core/services.ts' {
  interface Services {
    tags: TagsService
  }
}

const quote = (names: string[]) => names.map((n) => `"${normalizeTag(n)}"`).join(', ')

export default defineModule({
  id: 'tags',
  name: 'Tags',
  description:
    'Tag suggestions with usage counts across the platform; rename, merge and delete tags everywhere.',
  dependsOn: ['media'],
  permissions: {
    'tags.manage': {
      description: 'Rename, merge and delete tags on every item in the library',
      roles: [],
    },
  },
  setup(ctx) {
    const counts: TagsService['counts'] = async (actor, opts = {}) => {
      const visible = await ctx.services.media.visibleWhere(actor)
      const q = opts.q?.trim().replace(/^#/, '').toLowerCase()
      const rows = await ctx.db.execute<{ name: string; count: number }>(sql`
        with t as (
          select unnest(${media.tags}) as tag from ${media} where ${visible}
        ), g as (
          select lower(tag) as k, tag, count(*)::int as n from t group by lower(tag), tag
        )
        select (array_agg(tag order by n desc))[1] as name, sum(n)::int as count
        from g
        ${q ? sql`where k like ${`%${q.replace(/[%_\\]/g, '\\$&')}%`}` : sql``}
        group by k
        order by ${q ? sql`(k like ${`${q.replace(/[%_\\]/g, '\\$&')}%`}) desc,` : sql``} count desc, name asc
        limit ${opts.limit ?? 50}`)
      return rows.map((r) => ({ name: r.name, count: r.count }))
    }

    const rename: TagsService['rename'] = async (actor, from, to) => {
      const name = normalizeTag(to)
      if (!name) throw badRequest('The new tag name is empty')
      // What each item's history says, from the tags that item had.
      const note = (lost: string[]) => {
        const others = lost.filter((l) => l !== name)
        if (!others.length) return `Tag spelling changed to "${name}"`
        if (others.length > 1) return `Tags ${quote(others)} merged into "${name}"`
        return `Tag "${others[0]}" renamed to "${name}"`
      }
      return (await ctx.services.media.replaceTags(from, name, actor, note)).length
    }

    const remove: TagsService['remove'] = async (actor, names) => {
      const note = (lost: string[]) =>
        lost.length > 1 ? `Tags ${quote(lost)} deleted` : `Tag ${quote(lost)} deleted`
      return (await ctx.services.media.replaceTags(names, null, actor, note)).length
    }

    ctx.services.provide('tags', { counts, rename, remove })

    const tags = ['Tags']
    route(ctx.api, {
      method: 'get',
      path: '/tags',
      summary: 'Tags in use, with how many media items carry each',
      tags,
      access: 'media.read',
      query: z.object({
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(10_000).optional(),
      }),
      response: z.array(TagCount),
      handler: ({ actor, query }) => counts(actor, query),
    })
    route(ctx.api, {
      method: 'post',
      path: '/tags/rename',
      summary: 'Rename a tag, or merge several into one, on every item that carries them',
      tags,
      access: 'tags.manage',
      body: RenameTagsInput,
      response: TagChangeResult,
      handler: async ({ actor, body }) => ({ count: await rename(actor, body.from, body.to) }),
    })
    route(ctx.api, {
      method: 'post',
      path: '/tags/delete',
      summary: 'Remove tags from every item that carries them',
      tags,
      access: 'tags.manage',
      body: DeleteTagsInput,
      response: TagChangeResult,
      handler: async ({ actor, body }) => ({ count: await remove(actor, body.names) }),
    })

    ctx.mcp.tool({
      name: 'tags_list',
      description:
        'Tags already used in the library with their counts. Reuse existing tags instead of inventing near-duplicates.',
      input: { q: z.string().optional(), limit: z.number().int().max(10_000).optional() },
      access: 'media.read',
      readOnly: true,
      handler: ({ q, limit }, { actor }) => counts(actor, { q, limit }),
    })
    ctx.mcp.tool({
      name: 'tags_rename',
      description:
        'Rename a tag on every media item that carries it, trash included. Several `from` tags merge them into `to` ' +
        '(also how to fix a spelling: "Trullo" → "trullo"). Tags are lower-case English, one concept each.',
      input: { from: z.array(z.string().min(1).max(60)).min(1).max(500), to: z.string().min(1).max(60) },
      access: 'tags.manage',
      handler: async ({ from, to }, { actor }) => ({ count: await rename(actor, from, to) }),
    })
    ctx.mcp.tool({
      name: 'tags_delete',
      description:
        'Remove tags from every media item that carries them, trash included. Cannot be undone in one step.',
      input: { names: z.array(z.string().min(1).max(60)).min(1).max(500) },
      access: 'tags.manage',
      destructive: true,
      handler: async ({ names }, { actor }) => ({ count: await remove(actor, names) }),
    })
  },
})
