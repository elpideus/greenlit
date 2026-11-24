import type { Composition, OutputFormat } from '@greenlit/composition'
import { type Actor, actorUserId } from '../../core/actor.ts'
import type { JobContext } from '../../core/jobs.ts'
import type { FilesService } from '../files/service.ts'
import type { MediaService } from '../media/service.ts'

/**
 * The format key of the exported media item that each composition format lands in, in the order of `formats`.
 * The format called `main` is always the item's `main`; without one, the design format (the first) is. Every other
 * format keeps its own id. No two formats ever share a key: the second would replace the first one's file (and its
 * depth map would go on describing the file that was replaced).
 */
export function exportKeys(formats: readonly Pick<OutputFormat, 'id'>[]): string[] {
  const mainAt = Math.max(
    0,
    formats.findIndex((f) => f.id === 'main'),
  )
  const keys = formats.map((f, i) =>
    i === mainAt ? 'main' : f.id !== 'main' && formats.findIndex((x) => x.id === f.id) === i ? f.id : null,
  )
  // Ids used twice (a document edited by hand): the later ones get a key of their own.
  const taken = new Set(keys.filter((k) => k !== null))
  return keys.map((k, i) => {
    if (k !== null) return k
    let n = 2
    while (taken.has(`${formats[i]!.id}-${n}`)) n++
    const key = `${formats[i]!.id}-${n}`
    taken.add(key)
    return key
  })
}

export interface ExportDeps {
  /** Draws one format to a video file and returns its path. */
  render: (format: OutputFormat, job: JobContext) => Promise<string>
  files: Pick<FilesService, 'ingest'>
  media: Pick<MediaService, 'createFromBlob' | 'attachFile'>
  /** The item was just made: the editing project remembers it for the next export. */
  setOutputMedia: (mediaId: string) => Promise<void>
}

/**
 * Renders the formats of `doc` (only those in `only`, or all of them) and stores each one as a format of one media
 * item: `mediaId` (a new file version of each format), or a new item made from the first file. Returns the item.
 */
export async function exportFormats(
  deps: ExportDeps,
  r: { name: string; projectId: string | null; revision: number },
  doc: Composition,
  only: string[],
  mediaId: string | null,
  actor: Actor,
  job: JobContext,
): Promise<string | null> {
  const keys = exportKeys(doc.formats)
  const targets = doc.formats
    .map((format, i) => ({ format, key: keys[i]! }))
    .filter(({ format }) => !only.length || only.includes(format.id))
  for (const [i, { format, key }] of targets.entries()) {
    const sub: JobContext = {
      ...job,
      progress: (p: number, m?: string) =>
        job.progress((i + p) / targets.length, `${format.name}: ${m ?? ''}`),
    }
    const file = await deps.render(format, sub)
    const blob = await deps.files.ingest(file, {
      filename: `${r.name} (${format.name}).mp4`,
      mime: 'video/mp4',
      createdBy: actorUserId(actor),
      usage: 'media',
    })
    if (!mediaId) {
      mediaId = await deps.media.createFromBlob(
        blob,
        { projectId: r.projectId, title: r.name, formatKey: key, origin: 'render' },
        actor,
      )
      await deps.setOutputMedia(mediaId)
    } else
      await deps.media.attachFile(
        mediaId,
        blob,
        { formatKey: key, label: format.name, note: `Rendered from revision ${r.revision}` },
        actor,
      )
  }
  return mediaId
}
