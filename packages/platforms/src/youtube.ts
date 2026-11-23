import { bytes, jpeg, youtubeTable } from './presets.ts'
import { definePlatform, type VideoEncodeInput } from './types.ts'

/**
 * YouTube through the Data API v3 (videos.insert, thumbnails.set). Checked 2026-11-21 — sources in README.md.
 *
 * Upload settings follow "Recommended upload encoding settings": MP4 with the moov atom first and no edit lists;
 * H.264 High, progressive, 2 consecutive B-frames, closed GOP of half the frame rate, CABAC, VBR, 4:2:0;
 * AAC-LC 48 kHz (stereo 384 kbps, mono 128, 5.1 512); BT.709 for SDR.
 */

const BOOST_NOTE =
  'Uploading at 1440p or more is widely reported to get YouTube’s higher-bitrate VP9/AV1 encodes even when watched in 1080p. Not confirmed by YouTube; ' +
  'it also gives up "1080p Premium" (enhanced bitrate), which only applies to videos uploaded in 1080p. Off by default.'

const youtubeVideo = (
  box: { width: number; height: number },
  outOfRangeTarget: 'nearest' | 'recommended',
): VideoEncodeInput => ({
  container: 'mp4',
  codec: 'h264',
  profile: 'high',
  pixelFormat: 'yuv420p',
  color: 'bt709',
  // YouTube's player adapts to any shape: never burn bars in (fitInRange keep).
  frame: { box, rotatable: true, fitInRange: 'keep', fitOutOfRange: 'pad', outOfRangeTarget },
  fps: { max: 60 },
  rate: {
    crf: 17,
    preset: 'slow',
    tiers: youtubeTable,
    // The table is an average to aim for, with "no bitrate cap": CRF sets quality, the ceiling is 2× the table.
    ceilingFactor: 2,
    bufferFactor: 2,
  },
  gopSeconds: 0.5,
  bFrames: 2,
  audio: {
    codec: 'aac',
    profile: 'aac_low',
    sampleRate: 48000,
    bitrateStereo: 384,
    bitrateMono: 128,
    bitrate51: 512,
    allow51: true,
    requireTrack: false,
  },
  faststart: true,
  qualityBoost: { shortEdge: 1440, note: BOOST_NOTE },
  hdr: {
    accepted: true,
    note: 'HDR (PQ or HLG, BT.2020) is kept only on request (hdr: "keep") and encoded as HEVC Main10; otherwise tone-mapped to SDR.',
  },
})

const ytText = {
  title: { max: 100, unit: 'chars' as const, required: true, forbidden: ['<', '>'] },
  description: { max: 5000, unit: 'bytes' as const, forbidden: ['<', '>'] },
  hashtags: {
    ignoredAbove: 60,
    shown: 3,
    note: 'Up to three of the description’s hashtags show next to the title; with more than 60, YouTube ignores all of them.',
  },
  tags: { maxTotal: 500 },
}

export const youtube = definePlatform({
  id: 'youtube',
  name: 'YouTube',
  brand: { color: '#FF0033', textOnColor: '#ffffff' },
  icon: 'Play',
  checked: '2026-11-21',
  limits: {
    note: 'videos.insert has its own quota bucket (about 100 uploads a day by default — check Cloud Console). Always set privacyStatus: it defaults to public since 2026-11.',
  },
  placements: [
    {
      key: 'youtube.video',
      platform: 'youtube',
      label: 'Video',
      surface: 'watch',
      api: { publish: 'yes', endpoint: 'POST /upload/youtube/v3/videos (resumable) + thumbnails.set' },
      media: {
        kinds: ['video'],
        videoContainers: ['mp4', 'mov', 'webm', 'mkv', 'avi'],
        videoCodecs: ['h264', 'hevc', 'vp9', 'av1', 'prores'],
      },
      // No published range: vertical, square and wide all play. These bounds only catch nonsense.
      aspect: { min: 0.25, max: 4, recommended: 16 / 9 },
      resolution: { recommended: { width: 3840, height: 2160 }, maxWidth: 7680, maxHeight: 7680 },
      duration: {
        minSec: 1,
        maxSec: 12 * 3600,
        note: '256 GB or 12 hours, whichever is less. Unverified channels are limited to 15 minutes.',
      },
      maxBytes: { video: 256 * bytes.GB },
      fps: { max: 60 },
      text: ytText,
      display: {
        title: { lines: 2, more: '' },
        description: { chars: 160, lines: 3, more: '...more' },
      },
      thumbnail: {
        modes: ['image', 'none'],
        formats: ['jpeg', 'png'],
        maxBytes: 50 * bytes.MB,
        recommended: { width: 3840, height: 2160 },
        minWidth: 640,
        aspect: 16 / 9,
        note: 'thumbnails.set takes up to 50 MB since 2026-09 (2 MB in the mobile app). Custom thumbnails need a verified channel.',
      },
      scheduling: {
        native: 'yes',
        note: 'status.publishAt, only with privacyStatus private on a video that was never public.',
      },
      music: {
        library: false,
        api: 'no',
        note: 'The Audio Library is a download in Studio, not something attached to an upload.',
      },
      localization: {
        titleDescription: 'yes',
        multilingualText: 'no',
        note: 'localizations: { [bcp47]: { title, description } }; snippet.defaultLanguage is required with them.',
      },
      features: { location: false },
      encode: { video: youtubeVideo({ width: 7680, height: 4320 }, 'nearest') },
      notes: [
        'Upload at the frame rate it was recorded at; deinterlace first (1080i60 → 1080p30).',
        'Set paidProductPlacementDetails.hasPaidProductPlacement explicitly (no default since 2026-11).',
      ],
      sources: [
        'yt-encoding',
        'yt-aspect',
        'yt-limits',
        'yt-videos',
        'yt-insert',
        'yt-hashtags',
        'yt-thumbnails',
        'yt-thumbnails-set',
        'yt-revisions',
        'yt-premium',
        'vp9-trick',
        'observed',
      ],
    },
    {
      key: 'youtube.short',
      platform: 'youtube',
      label: 'Short',
      surface: 'vertical',
      api: {
        publish: 'yes',
        endpoint: 'POST /upload/youtube/v3/videos',
        note: 'There is no Shorts flag: a square or vertical upload of 3 minutes or less becomes a Short.',
      },
      media: {
        kinds: ['video'],
        videoContainers: ['mp4', 'mov', 'webm'],
        videoCodecs: ['h264', 'hevc', 'vp9', 'av1'],
      },
      aspect: { min: 0.25, max: 1, recommended: 9 / 16, alsoGood: [1] },
      resolution: { recommended: { width: 1080, height: 1920 }, maxWidth: 4320, maxHeight: 7680 },
      duration: {
        minSec: 1,
        maxSec: 180,
        note: 'Up to 3 minutes. Shorts over 1 minute with an active Content ID claim are blocked.',
      },
      maxBytes: { video: 256 * bytes.GB },
      fps: { max: 60 },
      text: ytText,
      display: { title: { lines: 2, more: '' } },
      thumbnail: {
        modes: ['image', 'none'],
        formats: ['jpeg', 'png'],
        maxBytes: 50 * bytes.MB,
        recommended: { width: 2160, height: 3840 },
        aspect: 9 / 16,
        note: 'thumbnails.set supports Shorts since 2026-11-03 (call it after processing). Shorts thumbnails are cropped, not letterboxed.',
      },
      safeZone: {
        top: 0.15,
        bottom: 0.35,
        left: 0.044,
        right: 0.178,
        regions: [],
        basis:
          'Google universal video ad safe zones (1080×1920: 288 px top, 672 px bottom, 192 px right, 48 px left). YouTube publishes no organic numbers.',
      },
      scheduling: { native: 'yes', note: 'status.publishAt with privacyStatus private.' },
      music: { library: true, api: 'no', note: 'Shorts sounds are attached in the app only.' },
      localization: { titleDescription: 'yes', multilingualText: 'no' },
      features: { location: false },
      // 16:9 sources would become a normal video, so they are padded to 9:16 (not to the nearest accepted 1:1).
      encode: { video: youtubeVideo({ width: 2160, height: 3840 }, 'recommended') },
      notes: [
        'Uploaded at the source resolution up to 2160×3840; Shorts play at up to 1080p for most viewers.',
      ],
      sources: [
        'yt-shorts',
        'yt-encoding',
        'yt-thumbnails',
        'yt-thumbnails-set',
        'yt-revisions',
        'yt-safezones',
        'observed',
      ],
    },
    {
      key: 'youtube.post',
      platform: 'youtube',
      label: 'Post',
      surface: 'post',
      api: {
        publish: 'no',
        endpoint: 'posts.insert (pilot)',
        note: 'Text and image posts have an API since 2026-11-16, for approved Google Cloud projects only (general availability planned for 2027).',
      },
      media: { kinds: ['text', 'image'], imageFormats: ['jpeg', 'png'] },
      aspect: { min: 0.5, max: 2, recommended: 1 },
      resolution: { recommended: { width: 1080, height: 1080 } },
      maxBytes: {},
      text: {},
      display: { caption: { lines: 4, more: 'Read more' } },
      thumbnail: { modes: ['none'] },
      carousel: { min: 1, max: 10, mixedKinds: false },
      scheduling: { native: 'partial', note: 'Scheduling exists in YouTube Studio; not in the pilot API.' },
      music: { library: false, api: 'no' },
      localization: { titleDescription: 'no', multilingualText: 'no' },
      features: { location: false },
      encode: {
        image: jpeg({
          frame: {
            box: { width: 2048, height: 2048 },
            rotatable: false,
            fitInRange: 'keep',
            fitOutOfRange: 'pad',
          },
        }),
      },
      notes: [
        'YouTube publishes no image size or text limits for posts; the values here are conservative choices.',
      ],
      sources: ['yt-posts', 'yt-revisions'],
    },
  ],
})
