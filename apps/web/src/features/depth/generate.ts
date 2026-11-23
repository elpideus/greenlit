import type { DepthJob, Media, MediaFormat } from '@greenlit/shared'
import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { qk, queryClient } from '@/lib/query'
import { useTopic } from '@/lib/realtime'
import { confirm, toast } from '@/ui'

/** Whether a depth map is Greenlit's own and made from the picture's current file. */
export function generatedState(map: MediaFormat | undefined, format: MediaFormat) {
  const g = map?.depth?.generated
  if (!g) return null
  return { model: g.model, stale: g.fromRevision !== format.fileRevision }
}

/**
 * Asks Greenlit to make the depth map of `format`. An uploaded map is replaced only after asking (it stays in the
 * file history); Greenlit's own is simply made again.
 */
export async function generateDepth(media: Media, format: MediaFormat, t: TFunction, name: string) {
  const own = media.depthMaps.find((d) => d.key === format.key && d.version === format.version)
  const uploaded = own && !own.depth?.generated
  if (
    uploaded &&
    !(await confirm({
      title: t('gen.replaceTitle', { format: name }),
      body: t('gen.replaceBody'),
      confirm: t('gen.replaceConfirm'),
    }))
  )
    return
  try {
    await api.post(`/media/${media.id}/depth/generate`, {
      formatId: format.id,
      replace: uploaded || undefined,
    })
    toast.info(t('gen.started', { format: name }))
    void queryClient.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
  } catch (err) {
    toast.error(err)
  }
}

/** Makes depth maps for many items (each one's main version formats that have none, or Greenlit's out of date). */
export async function generateDepthMany(ids: string[], t: TFunction) {
  try {
    const r = await api.post<{ queued: number }>('/depth/generate', { ids })
    if (r.queued) toast.info(t('gen.startedMany', { count: r.queued }))
    else toast.info(t('gen.nothing'))
    for (const id of ids) void queryClient.invalidateQueries({ queryKey: qk.mediaItem(id) })
  } catch (err) {
    toast.error(err)
  }
}

/**
 * The depth map Greenlit is making for `format` right now, if any: what the item said when it was fetched, then the
 * live progress on `depth:<media id>`.
 */
export function useDepthJob(media: Media, format: MediaFormat): DepthJob | null {
  const fromItem = media.depthJobs?.find((j) => j.formatId === format.id) ?? null
  const [live, setLive] = useState<DepthJob | null>(fromItem)
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the fetched item's values, not its identity
  useEffect(() => setLive(fromItem), [fromItem?.state, fromItem?.progress, format.id])
  useTopic<{ formatId: string; state: DepthJob['state'] | 'done'; progress: number }>(
    `depth:${media.id}`,
    (msg) => {
      const p = msg.data
      if (!p || p.formatId !== format.id) return
      if (p.state === 'done') {
        setLive(null)
        void queryClient.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
      } else setLive({ formatId: p.formatId, state: p.state, progress: p.progress })
    },
  )
  return live
}
