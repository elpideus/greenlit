import { bytes, jpeg, socialVideo } from './presets.ts'
import { definePlatform } from './types.ts'

/**
 * TikTok through the Content Posting API (Direct Post / upload to inbox). Checked 2026-11-21 — sources in README.md.
 */

export const tiktok = definePlatform({
  id: 'tiktok',
  name: 'TikTok',
  brand: { color: '#FE2C55', colorAlt: '#25F4EE', textOnColor: '#ffffff' },
  icon: 'Music2',
  checked: '2026-11-21',
  limits: {
    postsPerDay: 15,
    note: 'About 15 posts per creator per day, shared by every Direct Post app (403 spam_risk_too_many_posts). Unaudited apps post SELF_ONLY to private accounts.',
  },
  placements: [
    {
      key: 'tiktok.video',
      platform: 'tiktok',
      label: 'Video',
      surface: 'vertical',
      api: {
        publish: 'yes',
        endpoint: 'POST /v2/post/publish/video/init/ (FILE_UPLOAD in 5–64 MB chunks, or PULL_FROM_URL)',
      },
      media: {
        kinds: ['video'],
        videoContainers: ['mp4', 'webm', 'mov'],
        videoCodecs: ['h264', 'hevc', 'vp8', 'vp9'],
      },
      // The API states no shape constraint; 9:16 is what the For You feed is built for.
      aspect: { min: 0.25, max: 4, recommended: 9 / 16, alsoGood: [1, 16 / 9] },
      resolution: {
        recommended: { width: 1080, height: 1920 },
        minWidth: 360,
        minHeight: 360,
        maxWidth: 4096,
        maxHeight: 4096,
      },
      duration: {
        minSec: 1,
        maxSec: 10 * 60,
        softMaxSec: 3 * 60,
        note: 'Each creator has their own max_video_post_duration_sec (creator_info): most get 3 min, some 5 or 10.',
      },
      maxBytes: { video: 4 * bytes.GB },
      fps: { min: 23, max: 60 },
      text: {
        caption: { max: 2200, unit: 'utf16' },
        hashtags: { note: 'No documented count limit; hashtags and @mentions are parsed from the caption.' },
      },
      display: { caption: { chars: 80, lines: 2, more: 'more' } },
      thumbnail: {
        modes: ['frame'],
        note: 'post_info.video_cover_timestamp_ms picks a frame (first frame if unset). No custom cover image through the Content Posting API.',
      },
      safeZone: {
        top: 0.125,
        bottom: 0.344,
        left: 0.111,
        right: 0.111,
        regions: [{ label: 'Action rail', x: 1 - 0.167, y: 0.4375, w: 0.167, h: 0.5625 }],
        basis:
          'TikTok In-Feed ad template (measured at 1080×1920: 240 px top, 660 px bottom, 120 px sides, 180 px right rail on the lower 1080 px). TikTok publishes no organic numbers.',
      },
      scheduling: {
        native: 'no',
        note: 'No schedule field in the API (the TikTok web scheduler books 15 min–10 days ahead, by hand).',
      },
      music: {
        library: true,
        api: 'no',
        note: 'Library sounds cannot be attached to videos through the Content Posting API; "upload to inbox" lets the creator finish in the app.',
      },
      localization: { titleDescription: 'no', multilingualText: 'no' },
      features: { location: false, aiLabel: true },
      encode: {
        video: socialVideo({
          // 360–4096 px accepted; TikTok plays back at up to 1080p, so 1080-class output loses nothing visible.
          frame: {
            box: { width: 1080, height: 1920 },
            rotatable: true,
            minShortEdge: 360,
            fitInRange: 'keep',
            fitOutOfRange: 'pad',
          },
          fps: { min: 23, max: 60 },
          audio: { bitrateStereo: 192, bitrateMono: 128 },
        }),
      },
      notes: [
        'privacy_level must be picked by the user from creator_info.privacy_level_options (no default); duet/stitch/comment toggles start unchecked.',
        'brand_content_toggle (Paid partnership, not with SELF_ONLY), brand_organic_toggle (Promotional content), is_aigc (AI-generated label).',
      ],
      sources: [
        'tt-media-transfer',
        'tt-direct-post',
        'tt-creator-info',
        'tt-sharing-guidelines',
        'tt-ads-infeed',
        'tt-scheduler',
        'manypixels-tt',
        'observed',
      ],
    },
    {
      key: 'tiktok.photo',
      platform: 'tiktok',
      label: 'Photo post',
      surface: 'vertical',
      api: {
        publish: 'yes',
        endpoint:
          'POST /v2/post/publish/content/init/ media_type=PHOTO (PULL_FROM_URL from a verified domain)',
      },
      media: { kinds: ['image'], imageFormats: ['jpeg', 'webp'] },
      aspect: { min: 0.25, max: 4, recommended: 9 / 16, alsoGood: [3 / 4, 1] },
      // "max 1080p": read as 1080×1920 portrait / 1920×1080 landscape.
      resolution: { recommended: { width: 1080, height: 1920 }, maxWidth: 1920, maxHeight: 1920 },
      maxBytes: { image: 20 * bytes.MB },
      text: {
        title: { max: 90, unit: 'utf16' },
        description: { max: 4000, unit: 'utf16' },
        hashtags: { note: 'Hashtags go in the description.' },
      },
      display: {
        title: { chars: 40, lines: 1, more: '' },
        description: { chars: 80, lines: 2, more: 'more' },
      },
      thumbnail: { modes: ['image'], note: 'photo_cover_index (zero-based) picks which photo is the cover.' },
      safeZone: {
        top: 0.125,
        bottom: 0.344,
        left: 0.111,
        right: 0.111,
        regions: [{ label: 'Action rail', x: 1 - 0.167, y: 0.4375, w: 0.167, h: 0.5625 }],
        basis: 'Same layout as videos (TikTok In-Feed ad template).',
      },
      carousel: { min: 1, max: 35, mixedKinds: false },
      scheduling: { native: 'no' },
      music: {
        library: true,
        api: 'partial',
        note: 'auto_add_music (Direct Post only) adds a TikTok-recommended track; the creator can change it later.',
      },
      localization: { titleDescription: 'no', multilingualText: 'no' },
      features: { location: false, aiLabel: true },
      encode: {
        image: jpeg({
          frame: {
            box: { width: 1080, height: 1920 },
            rotatable: true,
            fitInRange: 'keep',
            fitOutOfRange: 'pad',
          },
          padColor: '#000000',
        }),
      },
      notes: [
        'JPEG or WebP (no PNG), ≤ 20 MB each, up to 35 photos. Only "Allow comment" applies (no duet/stitch).',
      ],
      sources: ['tt-photo-post', 'tt-media-transfer', 'tt-sharing-guidelines', 'observed'],
    },
  ],
})
