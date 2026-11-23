import { DEPTH_ACCEPT, type Media, type MediaFormat } from '@greenlit/shared'
import { uploadMedia } from '@/data/media'
import { qk, queryClient } from '@/lib/query'

/** Opens the file picker for one depth map file; null when nothing was chosen. */
export function pickDepthFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = DEPTH_ACCEPT
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Whether a file is a picture or a video, by its type or (EXR, PFM, TIFF: often typeless) its extension. */
export function fileKind(file: Pick<File, 'name' | 'type'>): 'image' | 'video' | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (/\.(exr|pfm|tiff?|png|jpe?g|webp|heic|avif)$/i.test(file.name)) return 'image'
  if (/\.(mp4|mov|m4v|mkv|webm|avi|mxf)$/i.test(file.name)) return 'video'
  return null
}

/** Uploads `file` as the depth map of `format` (its own version's); resolves to whether it went through. */
export async function uploadDepth(media: Pick<Media, 'id'>, format: MediaFormat, file: File) {
  const ids = await uploadMedia([file], {
    mediaId: media.id,
    formatKey: format.key,
    ...(format.version ? { version: format.version } : {}),
    depth: true,
  })
  void queryClient.invalidateQueries({ queryKey: qk.mediaItem(media.id) })
  void queryClient.invalidateQueries({ queryKey: qk.media() })
  return ids.length > 0
}
