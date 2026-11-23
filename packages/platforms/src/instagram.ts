import { bytes, jpeg, socialVideo } from './presets.ts'
import { definePlatform } from './types.ts'

/**
 * Instagram through the Instagram Graph API (Content Publishing, Facebook Login, API v27).
 * Checked 2026-11-21 — sources in README.md (keys in `sources`).
 */

/** Meta's Reels/Stories safe zone: 14% top, 35% bottom, 6% each side (ads guide; there is no organic one). */
const metaVerticalSafe = {
  top: 0.14,
  bottom: 0.35,
  left: 0.06,
  right: 0.06,
  basis:
    'Meta ads guide (Reels and Stories): keep 14% top, 35% bottom and 6% at each side free of text and logos.',
}

const igVideo = (o: { box: { width: number; height: number }; rotatable: boolean; requireTrack: boolean }) =>
  socialVideo({
    frame: { box: o.box, rotatable: o.rotatable, fitInRange: 'keep', fitOutOfRange: 'pad' },
    fps: { min: 23, max: 60 },
    // "VBR, 25 Mbps maximum"; "Audio bitrate: 128kbps" (a plain value, not a ceiling) — IG User Media reference.
    rate: { hardMaxKbps: 25_000 },
    audio: { bitrateStereo: 128, bitrateMono: 128, requireTrack: o.requireTrack },
  })

export const instagram = definePlatform({
  id: 'instagram',
  name: 'Instagram',
  brand: { color: '#E1306C', colorAlt: '#F77737', textOnColor: '#ffffff' },
  icon: 'Camera',
  checked: '2026-11-21',
  limits: {
    postsPerDay: 50,
    note: 'content_publishing_limit reports quota_total 50 per rolling 24 h (the guide also says 100): read it at runtime. Containers expire after 24 h; at most 400 containers per 24 h.',
  },
  placements: [
    {
      key: 'instagram.feed',
      platform: 'instagram',
      label: 'Feed post',
      surface: 'feed',
      api: {
        publish: 'yes',
        endpoint: 'POST /{ig-user-id}/media (image_url | CAROUSEL children) → /media_publish',
        note: 'A single video in the feed is published as a reel (media_type REELS); videos appear here only as carousel items.',
      },
      media: {
        kinds: ['image', 'video'],
        videoContainers: ['mp4', 'mov'],
        videoCodecs: ['h264', 'hevc'],
        imageFormats: ['jpeg'],
      },
      // API: 4:5 … 1.91:1 (error 36003 outside). The app shows 3:4 uncropped since 2025-05, the API still stops at 4:5.
      aspect: { min: 4 / 5, max: 1.91, recommended: 4 / 5, alsoGood: [1] },
      resolution: { recommended: { width: 1440, height: 1800 }, minWidth: 320, maxWidth: 1440 },
      duration: {
        minSec: 3,
        maxSec: 60,
        note: 'Carousel videos: Meta documents no separate spec; 3–60 s, 100 MB, 4:5–16:9 are the conservative third-party figures.',
      },
      maxBytes: { image: 8 * bytes.MB, video: 100 * bytes.MB },
      fps: { min: 23, max: 60 },
      maxVideoKbps: 25_000,
      text: {
        caption: { max: 2200, unit: 'chars' },
        altText: { max: 1000, unit: 'chars' },
        hashtags: {
          max: 5,
          strict: false,
          note: 'The app allows 5 hashtags per post since 2025-12 (caption and comments share the cap); the API reference still says 30.',
        },
        mentions: { max: 20 },
      },
      display: { caption: { chars: 125, lines: 2, more: 'more' } },
      thumbnail: {
        modes: ['none'],
        note: 'Images are their own thumbnail; carousel videos use their first frame.',
      },
      carousel: {
        min: 2,
        max: 20,
        mixedKinds: true,
        note: 'Up to 20 items (the error-code page still says 10 — test before relying on 11–20). Every item is cropped to the first item’s shape (1:1 by default). Caption, location and collaborators go on the parent.',
      },
      scheduling: {
        native: 'no',
        note: 'No publish-time parameter: Greenlit keeps the post and publishes it at the time itself.',
      },
      music: { library: true, api: 'no', note: 'Music on photo posts and carousels is app-only.' },
      localization: { titleDescription: 'no', multilingualText: 'no' },
      features: { location: true, collaborators: 3, userTags: true, aiLabel: true },
      encode: {
        image: jpeg({
          frame: {
            box: { width: 1440, height: 1800 },
            rotatable: false,
            fitInRange: 'keep',
            fitOutOfRange: 'crop',
          },
        }),
        video: igVideo({ box: { width: 1080, height: 1350 }, rotatable: false, requireTrack: false }),
      },
      notes: [
        'JPEG only through the API (MPO/JPS refused), sRGB, ≤ 8 MB; wider than 1440 px is scaled down, narrower than 320 px up.',
        'Alt text up to 1000 characters on images (2025-03).',
      ],
      sources: [
        'ig-media-ref',
        'ig-publishing',
        'ig-errors',
        'ig-changelog',
        'petapixel-ig-34',
        'smt-ig-hashtags',
        'observed',
      ],
    },
    {
      key: 'instagram.reel',
      platform: 'instagram',
      label: 'Reel',
      surface: 'vertical',
      api: { publish: 'yes', endpoint: 'POST /{ig-user-id}/media media_type=REELS → /media_publish' },
      media: { kinds: ['video'], videoContainers: ['mp4', 'mov'], videoCodecs: ['h264', 'hevc'] },
      aspect: { min: 0.01, max: 10, recommended: 9 / 16 },
      resolution: { recommended: { width: 1080, height: 1920 }, maxWidth: 1920 },
      duration: {
        minSec: 3,
        maxSec: 15 * 60,
        softMaxSec: 3 * 60,
        note: 'The API takes up to 15 min; reels over 3 min are not recommended to people who do not follow the account.',
      },
      maxBytes: { video: 300 * bytes.MB },
      fps: { min: 23, max: 60 },
      maxVideoKbps: 25_000,
      text: {
        caption: { max: 2200, unit: 'chars' },
        hashtags: {
          max: 5,
          strict: false,
          note: 'The app allows 5 hashtags per post since 2025-12; the API reference still says 30.',
        },
        mentions: { max: 20 },
      },
      display: { caption: { chars: 55, lines: 1, more: 'more' } },
      thumbnail: {
        modes: ['frame', 'image'],
        formats: ['jpeg'],
        maxBytes: 8 * bytes.MB,
        recommended: { width: 1080, height: 1920 },
        aspect: 9 / 16,
        note: 'cover_url (JPEG, sRGB, ≤ 8 MB; cut to its centre 9:16) or thumb_offset in ms (ignored when cover_url is set, must be < the duration). The profile grid shows the centre of the cover.',
      },
      safeZone: { ...metaVerticalSafe, regions: [] },
      scheduling: { native: 'no', note: 'No publish-time parameter: Greenlit publishes at the time itself.' },
      music: {
        library: true,
        api: 'partial',
        note: 'Instagram Audio API (2026-06): audio_configuration.audio_id from GET /ig_audio, Facebook Login only. Fails with 2207082 when the video has no audio track — the preset writes a silent one.',
      },
      localization: { titleDescription: 'no', multilingualText: 'no' },
      features: { location: true, collaborators: 3, userTags: true, aiLabel: true },
      encode: { video: igVideo({ box: { width: 1080, height: 1920 }, rotatable: true, requireTrack: true }) },
      notes: [
        'MOV/MP4, moov atom first, no edit lists; H.264 or HEVC, progressive, closed GOP, 4:2:0; 23–60 fps; ≤ 1920 px wide; VBR ≤ 25 Mbps; AAC ≤ 48 kHz, mono/stereo, 128 kbps.',
        'share_to_feed decides whether the reel also shows in the feed grid. Trial reels: trial_params.graduation_strategy (2025-12).',
      ],
      sources: [
        'ig-media-ref',
        'ig-publishing',
        'ig-audio-api',
        'ig-changelog',
        'meta-ads-ig-reels',
        'smt-ig-reels-3min',
        'smt-ig-hashtags',
        'observed',
      ],
    },
    {
      key: 'instagram.story',
      platform: 'instagram',
      label: 'Story',
      surface: 'story',
      api: { publish: 'yes', endpoint: 'POST /{ig-user-id}/media media_type=STORIES → /media_publish' },
      media: {
        kinds: ['image', 'video'],
        videoContainers: ['mp4', 'mov'],
        videoCodecs: ['h264', 'hevc'],
        imageFormats: ['jpeg'],
      },
      aspect: { min: 0.1, max: 10, recommended: 9 / 16 },
      resolution: { recommended: { width: 1080, height: 1920 }, maxWidth: 1920 },
      duration: { minSec: 3, maxSec: 60 },
      maxBytes: { image: 8 * bytes.MB, video: 100 * bytes.MB },
      fps: { min: 23, max: 60 },
      maxVideoKbps: 25_000,
      text: {},
      display: {},
      thumbnail: { modes: ['none'] },
      safeZone: { ...metaVerticalSafe, regions: [] },
      scheduling: { native: 'no' },
      music: { library: true, api: 'no', note: 'Music stickers are app-only.' },
      localization: { titleDescription: 'no', multilingualText: 'no' },
      features: { location: false, collaborators: 0, userTags: true },
      encode: {
        image: jpeg({
          frame: {
            box: { width: 1080, height: 1920 },
            rotatable: false,
            fitInRange: 'keep',
            fitOutOfRange: 'pad',
          },
          padColor: '#000000',
        }),
        video: igVideo({ box: { width: 1080, height: 1920 }, rotatable: true, requireTrack: false }),
      },
      notes: [
        'Stories published through the API carry no caption, collaborators, location or alt text; user tags work (2025-07).',
        'Shapes other than 9:16 are shown on a coloured backdrop by the app.',
      ],
      sources: ['ig-media-ref', 'meta-ads-ig-story'],
    },
  ],
})
