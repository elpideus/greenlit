import type { Asset, Composition, Op } from '@greenlit/composition'
import type { Media } from '@greenlit/shared'
import type { MediaService } from '../media/service.ts'

/**
 * An editing project's asset is a media item, one of its versions (absent = the main one) and one of that version's
 * formats. The export, stills and auto-reframe find its file here; the live preview does the same in the web app
 * (features/editor/assets.ts).
 */

/**
 * The key of the version `wanted` names: a version's key or its name (any case); '' or `main` = the main version.
 * null when the item has no such version.
 */
export function versionKeyOf(
  m: { versions: Pick<Media['versions'][number], 'key' | 'label'>[] },
  wanted: string | null | undefined,
): string | null {
  const w = (wanted ?? '').trim()
  if (!w || w.toLowerCase() === 'main') return ''
  const byKey = m.versions.find((v) => v.key === w)
  if (byKey) return byKey.key
  return m.versions.find((v) => v.label.toLowerCase() === w.toLowerCase())?.key ?? null
}

/** The file an asset plays: the format with its key in its version, else that version's main format. */
export async function assetFile(
  media: Pick<MediaService, 'formatsOf'>,
  asset: Pick<Asset, 'mediaId' | 'version' | 'formatKey'>,
) {
  // A version the item no longer has falls back to the main version (formatsOf does that).
  const formats = await media.formatsOf(asset.mediaId, { version: asset.version || null })
  return formats.find((f) => f.key === asset.formatKey) ?? formats.find((f) => f.isPrimary) ?? formats[0]
}

/**
 * A media item's main version changed: `promoted` is the main one now, and the old main one has the key `demoted`.
 * The `add_asset` ops that keep the edit's assets of that item on the files they played (as posts do): the ones
 * that used the main version now name `demoted`, the ones that named `promoted` use the main version. None when
 * the edit doesn't use the item.
 */
export function keepVersionOps(doc: Composition, mediaId: string, promoted: string, demoted: string): Op[] {
  const ops: Op[] = []
  for (const a of Object.values(doc.assets)) {
    if (a.mediaId !== mediaId || !promoted) continue
    const version = a.version ?? ''
    if (version === promoted) {
      const { version: _old, ...main } = a
      ops.push({ op: 'add_asset', asset: main })
    } else if (version === '') ops.push({ op: 'add_asset', asset: { ...a, version: demoted } })
  }
  return ops
}
