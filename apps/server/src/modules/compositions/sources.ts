import { type Composition, forFormat } from '@greenlit/composition'
import type { EntityRef } from '@greenlit/shared'
import { inArray, sql } from 'drizzle-orm'
import type { Db } from '../../core/db.ts'
import type { LinksService } from '../links/module.ts'
import { media } from '../media/schema.ts'
import { projects } from '../projects/schema.ts'

/**
 * The library media an export is made of: media items whose clips are drawn or heard in it. A clip counts when it
 * starts before the end, isn't hidden, and is either a picture or video on a visible visual track that at least one
 * format shows, or sound (an audio clip, or a video with sound) on a track that isn't muted. So a hidden clip, a
 * hidden track, a muted audio clip or track and anything past the end leave their media out, as they leave the export.
 */
export function sourceMediaIds(doc: Composition): string[] {
  const used = new Set<string>()
  for (const track of doc.tracks)
    for (const c of track.clips) {
      const asset = c.assetId ? doc.assets[c.assetId] : undefined
      if (!asset || c.hidden || c.start >= doc.duration) continue
      const seen =
        track.kind === 'visual' &&
        !track.hidden &&
        c.type !== 'audio' &&
        doc.formats.some((f) => !forFormat(c, f.id).hidden)
      const heard =
        !track.muted && !c.audio?.muted && (c.type === 'audio' || (c.type === 'video' && asset.hasAudio))
      if (seen || heard) used.add(asset.mediaId)
    }
  return [...used]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Of `ids`, the media items that are material: not brand kit files (logos, fonts and templates are the brand an edit
 * wears, not what it is made of) and not gone from the library for good.
 */
export async function outsideBrandKits(db: Db, ids: string[]): Promise<string[]> {
  const valid = ids.filter((id) => UUID.test(id))
  if (!valid.length) return []
  const rows = await db
    .select({ id: media.id })
    .from(media)
    .where(
      sql`${inArray(media.id, valid)} and (${media.projectId} is null or ${media.projectId} not in (select ${projects.id} from ${projects} where ${projects.kind} = 'brand'))`,
    )
  const keep = new Set(rows.map((r) => r.id))
  return valid.filter((id) => keep.has(id))
}

export interface SourceLinkDeps {
  links: Pick<LinksService, 'syncAutoInto'>
  /** Leaves out brand kit files and items that no longer exist (outsideBrandKits). */
  material: (ids: string[]) => Promise<string[]>
}

/**
 * Links the exported item to every library item it was made from: `source  source_of  export` ("Made from …" on the
 * export), as Greenlit's own (auto) links. Each export replaces the set, so media an edit no longer uses lose their
 * link on the next export, and nothing is linked twice. Links people made themselves are never touched. Returns the
 * ids linked.
 */
export async function linkSources(deps: SourceLinkDeps, outputId: string, doc: Composition) {
  const ids = (await deps.material(sourceMediaIds(doc))).filter((id) => id !== outputId)
  await deps.links.syncAutoInto(
    { type: 'media', id: outputId },
    'source_of',
    ids.map((id): EntityRef => ({ type: 'media', id })),
  )
  return ids
}
