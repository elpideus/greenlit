import { TagCount } from '@greenlit/shared'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Actor } from '../../core/actor.ts'
import { route } from '../../core/http.ts'
import { defineModule } from '../../core/module.ts'
import { media } from '../media/schema.ts'

export interface TagsService {
  /** Tags in use with how many items carry each (most used spelling wins), optionally filtered by prefix/substring. */
  counts: (actor: Actor, opts?: { q?: string; limit?: number }) => Promise<TagCount[]>
}
declare module '../../core/services.ts' {
  interface Services {
    tags: TagsService
  }
}

export default defineModule({
  id: 'tags',
  name: 'Tags',
  description: 'Tag suggestions with usage counts across the platform.',
  dependsOn: ['media'],
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
    ctx.services.provide('tags', { counts })

    route(ctx.api, {
      method: 'get',
      path: '/tags',
      summary: 'Tags in use, with how many media items carry each',
      tags: ['Tags'],
      access: 'media.read',
      query: z.object({
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }),
      response: z.array(TagCount),
      handler: ({ actor, query }) => counts(actor, query),
    })

    ctx.mcp.tool({
      name: 'tags_list',
      description:
        'Tags already used in the library with their counts. Reuse existing tags instead of inventing near-duplicates.',
      input: { q: z.string().optional(), limit: z.number().int().max(500).optional() },
      access: 'media.read',
      readOnly: true,
      handler: ({ q, limit }, { actor }) => counts(actor, { q, limit }),
    })
  },
})
