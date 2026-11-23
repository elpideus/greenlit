import { bytes, jpeg, socialVideo } from './presets.ts'
import { definePlatform } from './types.ts'

/**
 * Facebook Pages through the Graph API (Pages API, Video API, Reels Publishing API, Page Stories API; v27).
 * Checked 2026-11-21 — sources in README.md.
 */

const metaVerticalSafe = {
  top: 0.14,
  bottom: 0.35,
  left: 0.06,
  right: 0.06,
  regions: [],
  basis:
    'Meta ads guide (Facebook Reels): keep 14% top, 35% bottom and 6% at each side free. Used for Stories too (no official Stories page loads).',
}

const fbVertical = (rotatable: boolean) =>
  socialVideo({
    // 1080×1920 recommended, 540×960 minimum (Reels Publishing API / Page Stories API).
    frame: {
      box: { width: 1080, height: 1920 },
      rotatable,
      minShortEdge: 540,
      fitInRange: 'keep',
      fitOutOfRange: 'pad',
    },
    fps: { min: 24, max: 60 },
    // "closed GOP of 2 to 5 seconds", fixed frame rate, AAC-LC 48 kHz stereo at 128 kbps or more.
    gopSeconds: 2,
    audio: { bitrateStereo: 192, bitrateMono: 128 },
  })

const fbPhoto = jpeg({
  // No API maximum is documented; 2048 px on the long edge is what Facebook keeps for high-quality photos.
  frame: { box: { width: 2048, height: 2048 }, rotatable: false, fitInRange: 'keep', fitOutOfRange: 'pad' },
})

export const facebook = definePlatform({
  id: 'facebook',
  name: 'Facebook',
  brand: { color: '#0866FF', textOnColor: '#ffffff' },
  icon: 'Users',
  checked: '2026-11-21',
  limits: {
    note: 'Reels: 30 API-published reels per Page per rolling 24 h. Feed posts: no documented daily cap.',
  },
  placements: [
    {
      key: 'facebook.feed',
      platform: 'facebook',
      label: 'Feed post',
      surface: 'feed',
      api: {
        publish: 'yes',
        endpoint: 'POST /{page-id}/feed (text, link, attached_media) · /{page-id}/photos · /{page-id}/videos',
      },
      media: {
        kinds: ['text', 'image', 'video'],
        videoContainers: ['mp4', 'mov'],
        videoCodecs: ['h264'],
        imageFormats: ['jpeg', 'png', 'gif', 'bmp', 'tiff'],
      },
      aspect: { min: 9 / 16, max: 16 / 9, recommended: 4 / 5, alsoGood: [1, 16 / 9] },
      resolution: { recommended: { width: 1440, height: 1800 }, minWidth: 120, minHeight: 120 },
      duration: {
        minSec: 1,
        maxSec: 40 * 60,
        note: 'Video API error table: 1 s – 40 min, ≤ 2 GB; the ads guide says up to 241 min and 4 GB. Query /{page-id}/video_upload_limits at runtime.',
      },
      maxBytes: { video: 2 * bytes.GB, image: 4 * bytes.MB },
      fps: { max: 60 },
      text: {
        caption: { max: 63_206, unit: 'chars' },
        hashtags: { note: 'No documented limit; a few relevant hashtags work best.' },
      },
      display: { caption: { chars: 240, lines: 3, more: 'See more' } },
      thumbnail: {
        modes: ['image', 'none'],
        formats: ['jpeg', 'png'],
        maxBytes: 10 * bytes.MB,
        note: 'Videos: `thumb` on upload or POST /{video-id}/thumbnails (source, is_preferred); same shape as the video.',
      },
      carousel: {
        min: 2,
        max: 10,
        mixedKinds: false,
        note: 'Multi-photo posts (attached_media) have no documented maximum; 10 is a conservative choice. Link carousels show 2–5 cards.',
      },
      scheduling: {
        native: 'yes',
        minLeadMinutes: 10,
        maxLeadDays: 30,
        note: 'published=false + scheduled_publish_time. The Pages guide says 10 min–30 days (the /feed reference says 75 days; videos 6 months).',
      },
      music: { library: true, api: 'no', note: 'Music is added in the app composer only.' },
      localization: {
        titleDescription: 'no',
        multilingualText: 'no',
        note: '/videos lists undocumented multilingual_data fields; /feed and /photos have none. Treated as unsupported.',
      },
      features: { location: true, aiLabel: false },
      encode: {
        image: fbPhoto,
        video: socialVideo({
          // Ads guide: H.264, square pixels, fixed frame rate, progressive, AAC stereo ≥ 128 kbps; 4:5 1440×1800 recommended.
          frame: {
            box: { width: 1920, height: 1080 },
            rotatable: true,
            fitInRange: 'keep',
            fitOutOfRange: 'pad',
          },
          fps: { max: 60 },
          audio: { bitrateStereo: 192, bitrateMono: 128 },
        }),
      },
      notes: [
        'The 63,206-character post limit is a long-standing figure that the current docs no longer state.',
        'PNG photos above 1 MB can look soft after Facebook’s recompression: JPEG is used.',
      ],
      sources: [
        'fb-pages-posts',
        'fb-page-feed',
        'fb-page-photos',
        'fb-page-videos',
        'fb-video-errors',
        'fb-video-thumbnails',
        'meta-ads-fb-feed-video',
        'observed',
      ],
    },
    {
      key: 'facebook.reel',
      platform: 'facebook',
      label: 'Reel',
      surface: 'vertical',
      api: {
        publish: 'yes',
        endpoint: 'POST /{page-id}/video_reels (start → rupload → finish)',
        note: 'Since 2025-06 every Facebook video is a reel in the app; the API still splits /videos and /video_reels (3–90 s).',
      },
      media: { kinds: ['video'], videoContainers: ['mp4'], videoCodecs: ['h264', 'hevc', 'vp9', 'av1'] },
      aspect: { min: 9 / 16, max: 16 / 9, recommended: 9 / 16 },
      resolution: { recommended: { width: 1080, height: 1920 }, minWidth: 540, minHeight: 960 },
      duration: { minSec: 3, maxSec: 90 },
      maxBytes: {},
      fps: { min: 24, max: 60 },
      text: { caption: { max: 63_206, unit: 'chars' }, hashtags: { note: 'No documented limit.' } },
      display: { caption: { chars: 70, lines: 2, more: 'See more' } },
      thumbnail: {
        modes: ['image', 'none'],
        formats: ['jpeg', 'png'],
        maxBytes: 10 * bytes.MB,
        aspect: 9 / 16,
        note: 'Not documented on /video_reels; POST /{video-id}/thumbnails between upload and finish is reported to work.',
      },
      safeZone: metaVerticalSafe,
      scheduling: {
        native: 'yes',
        minLeadMinutes: 10,
        maxLeadDays: 29,
        note: 'video_state=SCHEDULED + scheduled_publish_time.',
      },
      music: {
        library: true,
        api: 'no',
        note: 'The API cannot attach a track (/audio/recommendations only lists them); the app composer can.',
      },
      localization: { titleDescription: 'no', multilingualText: 'no' },
      features: { location: false, aiLabel: true },
      encode: { video: fbVertical(true) },
      notes: [
        'H.264/H.265 (VP9, AV1 accepted), 4:2:0, closed GOP 2–5 s, fixed frame rate, progressive; AAC-LC 48 kHz stereo ≥ 128 kbps.',
      ],
      sources: ['fb-reels-publishing', 'fb-all-videos-reels', 'meta-ads-fb-reels', 'fb-music', 'observed'],
    },
    {
      key: 'facebook.story',
      platform: 'facebook',
      label: 'Story',
      surface: 'story',
      api: { publish: 'yes', endpoint: 'POST /{page-id}/photo_stories · /{page-id}/video_stories' },
      media: {
        kinds: ['image', 'video'],
        videoContainers: ['mp4'],
        videoCodecs: ['h264', 'hevc', 'vp9', 'av1'],
        imageFormats: ['jpeg', 'png', 'gif', 'bmp', 'tiff'],
      },
      aspect: { min: 9 / 16, max: 9 / 16, recommended: 9 / 16 },
      resolution: { recommended: { width: 1080, height: 1920 }, minWidth: 540, minHeight: 960 },
      duration: {
        minSec: 3,
        maxSec: 60,
        note: 'The spec table says 3–90 s, the limitations section 60 s: 60 s is used.',
      },
      maxBytes: { image: 4 * bytes.MB },
      fps: { min: 24, max: 60 },
      text: {},
      display: {},
      thumbnail: { modes: ['none'] },
      safeZone: metaVerticalSafe,
      scheduling: { native: 'no', note: 'A story goes live on finish.' },
      music: { library: true, api: 'no' },
      localization: { titleDescription: 'no', multilingualText: 'no' },
      features: { location: false },
      encode: {
        image: jpeg({
          frame: {
            box: { width: 1080, height: 1920 },
            rotatable: false,
            minShortEdge: 540,
            fitInRange: 'pad',
            fitOutOfRange: 'pad',
          },
          padColor: '#000000',
        }),
        video: fbVertical(false),
      },
      notes: ['Stories carry no text through the API. The file must not have been used in an earlier post.'],
      sources: ['fb-stories', 'meta-ads-fb-reels'],
    },
  ],
})
