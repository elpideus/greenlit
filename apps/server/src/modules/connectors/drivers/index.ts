import type { Platform } from '@greenlit/shared/areas/posts'
import { deviceDrivers } from './device-apps.ts'
import { facebookApi } from './facebook-api.ts'
import { instagramApi } from './instagram-api.ts'
import { meta } from './meta.ts'
import { tiktok } from './tiktok.ts'
import { tiktokApi } from './tiktok-api.ts'
import type { Driver } from './types.ts'
import { youtube } from './youtube.ts'
import { youtubeApi } from './youtube-api.ts'

/**
 * Every driver; one per way of reaching a platform, the first of a platform being the one new sign-ins use.
 * YouTube runs through API Anything (youtube-api.ts); the YouTube Studio browser driver remains only for
 * accounts connected with it. Facebook and Instagram each have two: the site itself (facebook-api.ts,
 * instagram-api.ts) and Meta Business Suite, which serves both; a sign-in names the one it is for. TikTok
 * runs through API Anything (tiktok-api.ts); the TikTok Studio browser driver remains for accounts connected
 * with it.
 */
export const drivers: Driver[] = [
  youtubeApi,
  facebookApi,
  meta,
  instagramApi,
  tiktokApi,
  tiktok,
  youtube,
  // The platforms' apps on Greenlit's Android device: found by scanning it, never a platform's first driver.
  ...deviceDrivers,
]

/** The driver a sign-in uses: the one named (when it serves the platform), else the platform's first. */
export function driverFor(platform: Platform, id?: string | null): Driver | null {
  if (id) {
    const named = drivers.find((d) => d.id === id && d.platforms.includes(platform))
    if (named) return named
  }
  return drivers.find((d) => !d.device && d.platforms.includes(platform)) ?? null
}
