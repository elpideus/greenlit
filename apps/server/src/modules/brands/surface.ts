import sharp from 'sharp'

/**
 * The background a transparent logo or graphic reads on: light artwork → 'dark', dark artwork → 'light'. Null when
 * the picture is (nearly) opaque, so it carries its own background.
 */
export async function artworkSurface(file: string): Promise<'dark' | 'light' | null> {
  const { data, info } = await sharp(file, { failOn: 'none' })
    .resize(96, 96, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const total = info.width * info.height
  let clear = 0
  let weight = 0
  let sum = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3]! / 255
    if (a < 0.5) clear++
    if (a < 0.1) continue
    sum += a * ((0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255)
    weight += a
  }
  if (!total || clear / total < 0.04 || !weight) return null
  return sum / weight >= 0.5 ? 'dark' : 'light'
}
