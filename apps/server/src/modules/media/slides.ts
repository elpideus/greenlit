import type { Media, SlideRef } from '@greenlit/shared'
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { alias, type PgColumn } from 'drizzle-orm/pg-core'
import type { Actor } from '../../core/actor.ts'
import type { ModuleContext } from '../../core/module.ts'
import { media, mediaSlides } from './schema.ts'

/**
 * Slides items group a carousel's pages: pictures and videos that stay media items of their own (formats, versions,
 * notes, history), listed in order in `media_slides`. The Slides item (kind `slides`) has no files; the library shows
 * it in place of its pages.
 */

/** Listings leave out the pages of Slides items (trashed Slides items too, so their pages don't come loose). */
export const notASlide: SQL = sql`not exists (select 1 from ${mediaSlides} where ${mediaSlides.mediaId} = ${media.id})`

/** `media` again, as the pages of the Slides item in a listing's row (raw SQL names it `"page"`, see orItsPages). */
const page = alias(media, 'page')

type SearchColumns = { searchText: PgColumn; tags: PgColumn }

/**
 * `cond` holds for the item, or, for a Slides item, for one of its pages that isn't trashed: a search finds the
 * Slides item by its pages' words and tags.
 */
export function orItsPages(cond: (t: SearchColumns) => SQL): SQL {
  return sql`(${cond(media)} or (${media.kind} = 'slides' and exists (select 1 from ${mediaSlides} join ${media} as ${sql.raw('"page"')} on ${page.id} = ${mediaSlides.mediaId} where ${mediaSlides.slidesId} = ${media.id} and ${page.deletedAt} is null and ${cond(page)})))`
}

/** Every page of these Slides items in order, trashed ones and ones hidden from someone included. */
export async function pageRows(ctx: ModuleContext, slidesIds: string[]) {
  if (!slidesIds.length) return []
  return ctx.db
    .select({ slidesId: mediaSlides.slidesId, mediaId: mediaSlides.mediaId, position: mediaSlides.position })
    .from(mediaSlides)
    .where(inArray(mediaSlides.slidesId, slidesIds))
    .orderBy(asc(mediaSlides.slidesId), asc(mediaSlides.position), asc(mediaSlides.createdAt))
}

/** The Slides items (not trashed) these pictures and videos are pages of. */
export async function parentsOf(ctx: ModuleContext, ids: string[]) {
  if (!ids.length) return []
  return ctx.db
    .select({ mediaId: mediaSlides.mediaId, id: media.id, title: media.title })
    .from(mediaSlides)
    .innerJoin(media, eq(media.id, mediaSlides.slidesId))
    .where(and(inArray(mediaSlides.mediaId, ids), isNull(media.deletedAt)))
    .orderBy(asc(media.createdAt))
}

export function slideRef(m: Media): SlideRef {
  const f = m.formats.find((x) => x.isPrimary) ?? m.formats[0]
  return {
    mediaId: m.id,
    title: m.title,
    kind: m.kind,
    status: m.status,
    thumbnailUrl: m.thumbnailUrl,
    width: f?.width ?? null,
    height: f?.height ?? null,
    duration: f?.duration ?? null,
    openCommentCount: m.openCommentCount,
  }
}

/**
 * Fills in `slides` (Slides items: their pages the actor can see, the first page's thumbnail, note counts added up)
 * and `inSlides` (pages: the Slides items they are in). `pagesOf` gives the views of pages (never Slides items, so
 * this goes one level deep).
 */
export async function decorateSlides(
  ctx: ModuleContext,
  views: Media[],
  actor: Actor,
  pagesOf: (ids: string[], actor: Actor) => Promise<Media[]>,
) {
  const sets = views.filter((m) => m.kind === 'slides')
  const rows = await pageRows(
    ctx,
    sets.map((s) => s.id),
  )
  const pages = new Map(
    (await pagesOf([...new Set(rows.map((r) => r.mediaId))], actor)).map((m) => [m.id, m]),
  )
  for (const s of sets) {
    const own = rows
      .filter((r) => r.slidesId === s.id)
      .map((r) => pages.get(r.mediaId))
      .filter((m): m is Media => !!m)
    s.slides = own.map(slideRef)
    s.thumbnailUrl = own[0]?.thumbnailUrl ?? null
    s.commentCount += own.reduce((n, m) => n + m.commentCount, 0)
    s.openCommentCount += own.reduce((n, m) => n + m.openCommentCount, 0)
  }
  const others = views.filter((m) => m.kind !== 'slides')
  const parents = await parentsOf(
    ctx,
    others.map((m) => m.id),
  )
  for (const m of others) {
    const mine = parents.filter((p) => p.mediaId === m.id).map((p) => ({ id: p.id, title: p.title }))
    if (mine.length) m.inSlides = mine
  }
}
