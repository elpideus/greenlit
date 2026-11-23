# @greenlit/platforms

What Instagram, Facebook, TikTok and YouTube accept, and how to encode for each of them. Plain TypeScript and zod, no
React and no Node APIs, so the server (publishing, conversions) and the web app (previews, warnings) use the same data.

Every figure was checked on **2026-11-21** against the sources listed at the end. Each placement names its sources by
key (`sources: [...]`), and a test fails if a key is missing from this file.

## Files

| File                                                     | What it holds                                                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                                               | zod schemas and types: `PlacementSpec`, `PlatformSpec`, `VideoEncode`, `ImageEncode`, `SafeZone`, `SourceInfo`, `EncodeOptions`, `Issue` |
| `instagram.ts`, `facebook.ts`, `tiktok.ts`, `youtube.ts` | one platform each, parsed by `definePlatform` at import time, so a typo fails loudly                                                     |
| `presets.ts`                                             | Greenlit's own quality choices that several platforms share (CRF, presets, ceilings, YouTube's bitrate table)                            |
| `geometry.ts`                                            | keep, pad or crop, and at what size (`planFrame`)                                                                                        |
| `ffmpeg.ts`                                              | `ffmpegArgsFor`, `ffmpegCommand`, `chooseFps`, `h264Level`                                                                               |
| `image.ts`                                               | `imagePlanFor`: the same picture decisions, written as a recipe for sharp                                                                |
| `validate.ts`                                            | `validateForPlacement`: problems and warnings in plain English, with stable codes for translation                                        |
| `text.ts`                                                | how platforms count and cut text: `textLength`, `extractHashtags`, `youtubeTagsLength`, `truncateForDisplay`…                            |
| `index.ts`                                               | the registry: `platforms`, `placements`, `getPlacement`, `pickBestFormat`                                                                |

## Placements

| Key               | Takes                                   | Shape                     | Length                                | Notes                                       |
| ----------------- | --------------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------------- |
| `instagram.feed`  | image, carousel of 2–20 (images/videos) | 4:5 … 1.91:1              | carousel video 3–60 s                 | JPEG only, ≤ 1440 px wide                   |
| `instagram.reel`  | video                                   | 9:16 (0.01 … 10 accepted) | 3 s – 15 min (3 min for reach)        | ≤ 300 MB, ≤ 25 Mbps                         |
| `instagram.story` | image, video                            | 9:16                      | 3–60 s                                | no caption through the API                  |
| `facebook.feed`   | text, images, video                     | 9:16 … 16:9, best 4:5     | 1 s – 40 min                          | native scheduling                           |
| `facebook.reel`   | video                                   | 9:16 (16:9 … 9:16)        | 3–90 s                                | ≥ 540×960, native scheduling                |
| `facebook.story`  | image, video                            | 9:16                      | 3–60 s                                | no text                                     |
| `tiktok.video`    | video                                   | 9:16                      | up to 10 min (per creator, usually 3) | 360–4096 px                                 |
| `tiktok.photo`    | 1–35 images                             | 9:16                      | —                                     | JPEG/WebP, title 90, description 4000       |
| `youtube.video`   | video                                   | any, best 16:9            | 12 h / 256 GB                         | title 100, description 5000 bytes, tags 500 |
| `youtube.short`   | video                                   | 9:16 or 1:1               | ≤ 3 min                               |                                             |
| `youtube.post`    | text, 1–10 images                       | —                         | —                                     | API is a pilot: not publishable yet         |

## Encoding

```ts
import { ffmpegArgsFor, ffmpegCommand, getPlacement, validateForPlacement } from '@greenlit/platforms'

const source = { width: 2160, height: 3840, fps: 59.94, durationSec: 20, hasAudio: true, hdr: 'hlg' } // from ffprobe
const spec = getPlacement('instagram.reel')

const issues = validateForPlacement(spec, source, { caption, hashtags })
const plan = ffmpegArgsFor(spec, source, { fit: 'auto', qualityBoost: false })
// plan.args: everything between the input and the output. Prepend the input, append the output:
spawn('ffmpeg', ['-hide_banner', '-y', '-i', input, ...plan.args, `${out}.${plan.outputExt}`])
// …or: spawn('ffmpeg', ffmpegCommand(plan, input, `${out}.${plan.outputExt}`))
// plan.notes: what was done and why, for logs and the UI. plan.output: size, fps, ceilings, worst-case bytes.
```

`args` contain no input options. They use a `-filter_complex` that reads `[0:v:0]`, so the source must be the first
(and only) input. The server's `HDR_TO_SDR` chain uses the same tone mapping, which needs an ffmpeg build with libzimg.

`SourceInfo` is what the server's `probe()` already returns: display width and height (after rotation), fps,
duration, `hasAudio` and `hdr` (`'pq'`, `'hlg'`, `true` or `false`). Optional fields make the result better:

- `audioChannels`: keeps 5.1 on YouTube, mono as mono.
- `colorMatrix` and `colorRange`: ffprobe `color_space` and `color_range`. When `colorMatrix` is missing it is guessed
  the way players guess (BT.709 at 720p and up, BT.601 below).
- `interlaced`
- `bytes`

`EncodeOptions`:

- `fit`: `auto` (the placement's default), `keep`, `pad` or `crop`.
- `qualityBoost`: YouTube only.
- `hdr`: `tonemap` (the default) or `keep`. `keep` works on YouTube only, and only when the source is `'pq'` or `'hlg'`.
- `trimToMax`: cut to the maximum length.
- `speed`: `fast` for drafts.
- `padColor`, `threads`

For pictures, `ffmpegArgsFor` with `kind: 'image'` writes a JPEG with ffmpeg. ffmpeg cannot convert ICC profiles
(iPhone photos are Display P3), so on the server prefer `imagePlanFor()` with sharp:

```ts
const p = imagePlanFor(getPlacement('instagram.feed'), { width, height })
await sharp(src)
  .rotate()
  .resize(p.resize.width, p.resize.height, { fit: p.resize.fit, background: p.resize.background })
  .toColorspace('srgb')
  .jpeg({ quality: p.quality, chromaSubsampling: p.chroma, mozjpeg: true })
  .toFile(out)
```

### What every video preset does

- **Container.** MP4 with the moov atom first (`+faststart`) and no edit list. The two B-frame delay is written as
  negative CTS offsets (`+negative_cts_offsets`). Instagram's and YouTube's specs both ask for no edit lists, and
  without them the video would start 2 frames after the audio.
- **Video.** H.264 High (libx264), `yuv420p`, BT.709 primaries, transfer and matrix, limited range. The tags are
  written on the frames with `setparams`, because ffmpeg 7+ takes the colour description from the frames and not only
  from `-color_*`. The level is computed from frame size, macroblock rate and the VBV ceiling (`h264Level`).
- **Frame rate.** Constant frame rate (phones record variable).
  - The source rate is kept up to the platform maximum.
  - Above the maximum, the rate is divided by whole frames: 120 → 60, 119.88 → 59.94, 100 → 50.
  - Below a platform minimum (Instagram 23, Facebook 24), frames are repeated.
  - Nothing is ever interpolated.
- **Shape.**
  - `keep`: the source shape, scaled down (never up) into the placement's frame. A 16:9 reel becomes 1920×1080.
  - `pad`: bars, inside the recommended frame or the source size, whichever is larger.
  - `crop`: cut from the centre.
  - A shape the placement refuses is padded to the nearest accepted ratio (9:16 to 4:5 for the Instagram feed). Shorts
    are padded to 9:16, because a 16:9 upload would become a normal video.
  - The only upscaling: to the platform's minimum size (Facebook reels 540, TikTok 360), or with `qualityBoost`.
- **HDR.** Tone-mapped to SDR with zscale and the Hable curve, except YouTube with `hdr: 'keep'`. That writes HEVC
  Main10 with BT.2020 and PQ or HLG tags, at the HDR bitrates YouTube publishes. HDR10 mastering metadata is not
  carried over.
- **Rate control.**
  - CRF sets the quality: 18 for social, 17 for YouTube, `preset slow`.
  - A VBV ceiling per resolution tier stops pathological peaks.
  - Instagram has a hard limit of 25 Mbps.
  - For YouTube the ceiling is 2× its published averages. The averages are 8/12 Mbps at 1080p, 16/24 at 1440p and
    45/68 at 2160p (≤ 30 fps / > 30 fps), and YouTube sets "no bitrate cap".
  - When a file size limit and the duration are known (Instagram reels 300 MB, Facebook 2 GB…), the ceiling is
    lowered so the worst case fits, with a note.
- **Keyframes.** A closed GOP every 2 s for the social apps. Facebook asks for 2–5 s. For YouTube it is half the frame
  rate (0.5 s), as YouTube recommends. 2 B-frames everywhere.
- **Audio.** AAC-LC at 48 kHz, in stereo. Mono sources stay mono. 5.1 is kept on YouTube only.
  - Bitrates: Instagram 128 kbps (its spec gives exactly that), Facebook and TikTok 192 kbps (Facebook asks for
    ≥ 128), YouTube 384 kbps (512 for 5.1).
  - Instagram reels get a silent track when the source has none. The Instagram Audio API refuses a video with no
    audio track (error 2207082, seen in Greenlit's own live tests).
- **Metadata.** Global metadata and chapters are dropped (GPS and device tags from phones).

### Checking with real ffmpeg

`pnpm exec vitest run packages/platforms` (from the repo root) tests the plans themselves. To check that ffmpeg
really produces what the plans promise, run this:

```sh
node packages/platforms/scripts/check-ffmpeg.ts [work-dir]
```

The script makes synthetic clips with `testsrc2` and `sine`:

- 4K60 HLG vertical, the way an iPhone records
- 1080p25 landscape
- 1080×1920 mono
- 720p120 with no sound
- SD BT.601
- a 3000×2000 photo

It then encodes each clip with every preset that takes it, and checks each output with ffprobe: size, codec, profile,
BT.709 tags, frame rate, AAC 48 kHz, moov first, no edit list, and video and audio starting together.

On 2026-11-21 all 55 outputs passed with ffmpeg n9.0.2. The run takes about 2 minutes on 12 cores.

### YouTube `qualityBoost`

`ffmpegArgsFor(getPlacement('youtube.video'), src, { qualityBoost: true })` scales the short edge up to 1440 with
lanczos, for example 1920×1080 → 2560×1440. Creators widely report that YouTube's higher-bitrate VP9/AV1 encodes kick
in at 1440p and up, so even 1080p viewers get a cleaner picture.

- **Not official.** YouTube does not document this. A 2025 yt-dlp maintainer comment calls low-bitrate cases normal
  encoder behaviour.
- **It costs something.** YouTube's "1080p Premium" (enhanced bitrate) only applies to videos uploaded in 1080p, so
  boosting gives it up.
- **Off by default.** Turn it on per post. To find out whether it still works, compare `yt-dlp -F` on two test uploads.

## Uncertain or conflicting (re-check before relying on it)

**Instagram**

- **Hashtags.** The app has allowed 5 per post since December 2025, but the API reference still says 30.
  `hashtags.strict: false` makes going over a warning.
- **Carousel size.** The API reference allows 20 items, but the error-code page still says 10.
- **Carousel videos.** Meta publishes no spec for them. The 3–60 s, 100 MB and 4:5–16:9 used here are conservative
  third-party figures.
- **3:4 photos.** The app shows them, but the API still rejects anything taller than 4:5.
- **Daily publishing quota.** The guide says 100, `content_publishing_limit` says 50. Read it at runtime.
- **Caption "… more" cut-off.** There are no official numbers; about 125 characters for the feed and about 55 for
  reels are observed values (`observed`).

**Facebook**

- **Scheduling window.** The Pages guide says 30 days, the `/feed` reference says 75. Videos get 6 months.
- **Feed video limits.** The error table says 40 min and 2 GB, the ads guide says 241 min and 4 GB. Query
  `video_upload_limits` at runtime.
- **Photo size.** The English page says 10 MB, the Italian one 4 MB. 4 MB is used here.
- **Post length.** The 63,206-character limit is legacy and no longer documented.
- **Stories length.** The spec table says 90 s, the limitations section 60 s.
- **Multilingual posts.** Not supported through the API: `/videos` has undocumented `multilingual_data` fields,
  `/feed` has none.
- **Feed video size.** Feed video is capped at the 1080p class (1920 on the long edge). Meta's ads guide recommends
  1440×1800 for 4:5, and Greenlit does not exceed 1080p there.

**TikTok**

- **Safe zone.** Measured from TikTok's In-Feed ad template, so it is conservative for organic posts.
- **Photo resolution.** "max 1080p" is read as 1080×1920 portrait or 1920×1080 landscape.
- **Shape and length.** The API states no aspect ratio range; the 0.25–4 used here only rejects nonsense. The
  minimum length is not documented.
- **Playback above 1080p.** Not documented, which is why the preset stops at 1080p.

**YouTube**

- **Shorts safe zone.** From Google's universal ad safe zones; there is no organic Shorts safe zone.
- **Shorts detection.** The API has no Shorts flag: shape and duration (≤ 3 min) decide.
- **Localization limits.** Assumed to be the same as the snippet limits.
- **Posts.** `youtube.post` image and text limits are not published, and the API is a pilot.

**Every platform**

- **Safe zones.** All of them are published for ads, and Greenlit uses them as conservative organic guides.

## Sources (accessed 2026-11-21)

"No date" means the page showed none. In that case the newest dated change listed on the page is given.

**Instagram**

| Key                 | Source                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ig-media-ref`      | IG User Media reference, https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media (no date; v27.0, newest notes 2025-07-09)                 |
| `ig-publishing`     | Content Publishing guide, https://developers.facebook.com/docs/instagram-platform/content-publishing (no date)                                                                         |
| `ig-errors`         | Instagram Platform error codes, https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes                                                      |
| `ig-audio-api`      | Instagram Audio API, https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api (changelog 2026-06-01)                                                       |
| `ig-changelog`      | Instagram Platform changelog, https://developers.facebook.com/docs/instagram-platform/changelog (entries to 2026-06-22)                                                                |
| `meta-ads-ig-reels` | Meta Ads Guide, Instagram Reels video, https://www.facebook.com/business/ads-guide/update/video/instagram-reels                                                                        |
| `meta-ads-ig-story` | Meta Ads Guide, Instagram Stories, https://www.facebook.com/business/ads-guide/update/video/instagram-story                                                                            |
| `smt-ig-hashtags`   | Social Media Today, "Instagram's implementing new limits on hashtag use" (2025-12-18), https://www.socialmediatoday.com/news/instagrams-implementing-new-limits-on-hashtag-use/808309/ |
| `smt-ig-reels-3min` | Social Media Today, Reels up to 3 minutes (2025-01), https://www.socialmediatoday.com/news/instagram-officially-expands-reels-length-to-3-minutes/737766/                              |
| `petapixel-ig-34`   | PetaPixel, Instagram adds 3:4 photos (2025-05-29), https://petapixel.com/2025/05/29/instagram-finally-adds-support-for-34-aspect-ratio-photos                                          |

**Facebook**

| Key                      | Source                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fb-pages-posts`         | Pages API, posts, https://developers.facebook.com/docs/pages-api/posts                                                                              |
| `fb-page-feed`           | Graph API reference, /page/feed, https://developers.facebook.com/docs/graph-api/reference/page/feed                                                 |
| `fb-page-photos`         | Graph API reference, /page/photos, https://developers.facebook.com/docs/graph-api/reference/page/photos/                                            |
| `fb-page-videos`         | Graph API reference, /page/videos, https://developers.facebook.com/docs/graph-api/reference/page/videos/                                            |
| `fb-video-errors`        | Video API error codes, https://developers.facebook.com/documentation/video-api/reference/error-codes                                                |
| `fb-video-thumbnails`    | Video thumbnails, https://developers.facebook.com/docs/graph-api/reference/video/thumbnails/                                                        |
| `fb-reels-publishing`    | Reels Publishing API, https://developers.facebook.com/documentation/video-api/guides/reels-publishing                                               |
| `fb-stories`             | Page Stories API, https://developers.facebook.com/documentation/video-api/page-stories-api                                                          |
| `fb-music`               | Music recommendations, https://developers.facebook.com/documentation/video-api/guides/music-recommendations                                         |
| `fb-all-videos-reels`    | Meta newsroom, all videos become reels (2025-06-17, updated 2025-07-14), https://about.fb.com/news/2025/06/making-it-easier-create-videos-facebook/ |
| `meta-ads-fb-feed-video` | Meta Ads Guide, Facebook Feed video, https://www.facebook.com/business/ads-guide/update/video/facebook-feed                                         |
| `meta-ads-fb-reels`      | Meta Ads Guide, Facebook Reels, https://www.facebook.com/business/ads-guide/update/video/facebook-facebook-reels                                    |

**TikTok**

| Key                     | Source                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tt-media-transfer`     | Content Posting API, media transfer guide (updated 2026-08-04), https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide        |
| `tt-direct-post`        | Content Posting API, Direct Post reference (updated 2026-10-27), https://developers.tiktok.com/doc/content-posting-api-reference-direct-post      |
| `tt-photo-post`         | Content Posting API, photo post reference (updated 2026-10-27), https://developers.tiktok.com/doc/content-posting-api-reference-photo-post        |
| `tt-creator-info`       | Query creator info (updated 2026-10-27), https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info                       |
| `tt-sharing-guidelines` | Content sharing guidelines (updated 2026-08-04), https://developers.tiktok.com/doc/content-sharing-guidelines                                     |
| `tt-ads-infeed`         | TikTok Ads help, In-Feed ads specs and safe-zone templates (updated 2026-06), https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads      |
| `tt-scheduler`          | TikTok business blog, video scheduler, https://ads.tiktok.com/business/en-US/blog/introducing-video-scheduler-now-you-can-plan-tiktoks-in-advance |
| `manypixels-tt`         | ManyPixels, TikTok ad specs with measured safe zones (2026-11-11, secondary), https://manypixels.co/blog/social-media-design/tiktok-ad-specs      |

**YouTube**

| Key                 | Source                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `yt-encoding`       | YouTube Help, Recommended upload encoding settings, https://support.google.com/youtube/answer/1722171                                                                                                                                                  |
| `yt-aspect`         | YouTube Help, video resolution and aspect ratios, https://support.google.com/youtube/answer/6375112                                                                                                                                                    |
| `yt-limits`         | YouTube Help, upload length and file size, https://support.google.com/youtube/answer/71673                                                                                                                                                             |
| `yt-videos`         | Data API, videos resource, https://developers.google.com/youtube/v3/docs/videos                                                                                                                                                                        |
| `yt-insert`         | Data API, videos.insert, https://developers.google.com/youtube/v3/docs/videos/insert                                                                                                                                                                   |
| `yt-hashtags`       | YouTube Help, hashtags, https://support.google.com/youtube/answer/6390658                                                                                                                                                                              |
| `yt-shorts`         | YouTube Help, Shorts length and classification, https://support.google.com/youtube/answer/15424877                                                                                                                                                     |
| `yt-thumbnails`     | YouTube Help, custom thumbnails, https://support.google.com/youtube/answer/72431                                                                                                                                                                       |
| `yt-thumbnails-set` | Data API, thumbnails.set, https://developers.google.com/youtube/v3/docs/thumbnails/set                                                                                                                                                                 |
| `yt-revisions`      | Data API revision history (entries to 2026-11-16), https://developers.google.com/youtube/v3/revision_history                                                                                                                                           |
| `yt-posts`          | Data API, posts resource (pilot, 2026-11-16), https://developers.google.com/youtube/v3/docs/posts                                                                                                                                                      |
| `yt-premium`        | YouTube Help, 1080p Premium, https://support.google.com/youtube/answer/6308116                                                                                                                                                                         |
| `yt-safezones`      | Google universal video ad safe zones (PDF), https://services.google.com/fh/files/misc/universalsafezones-youtube.pdf                                                                                                                                   |
| `vp9-trick`         | The 1440p trick (secondary): https://wpreset.com/why-some-creators-re%E2%80%91encode-their-video-to-4k-the-hidden-trick-to-prevent-blurriness-after-upload-on-youtube/ and the counterpoint in https://github.com/yt-dlp/yt-dlp/issues/14636 (2025-10) |

**All platforms**

| Key        | Source                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observed` | How the apps lay posts out and where they cut captions, observed in November 2026. Used only for previews (`display`), never for publishing limits. |
