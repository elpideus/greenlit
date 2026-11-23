# Connected accounts

Greenlit publishes to YouTube, Facebook, Instagram and TikTok with the accounts people already use: no developer
apps, API keys or OAuth clients. The owner signs in once on the platform's own page, in a private browser that
Greenlit streams into Settings → Connected accounts (passwords and 2-step codes go to the platform, never to
Greenlit). From then on Greenlit talks to the platform with that sign-in.

The module is `apps/server/src/modules/connectors`; the web side is `apps/web/src/features/connectors`.

## Two kinds of connector

A connector (a _driver_, `drivers/*.ts`) is one way of reaching a platform. There are two kinds:

- **`api`** — every operation is a request the platform's own web (or app) frontend sends, replayed over plain
  HTTP by [API Anything](#api-anything) with the sign-in's cookies. The browser is only used to sign in.
- **`browser`** — drives the platform's web UI like a person (Meta Business Suite, and the older YouTube Studio
  and TikTok Studio drivers). Kept where nothing better exists yet.

| Connector             | Kind    | Platforms                 | Reads                                                            | Publishing                                                                                                                                                                                                                                                                              |
| --------------------- | ------- | ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `youtube`             | api     | YouTube                   | channels, uploads, details, stats, sync, sounds for Shorts       | uploads, details and deletes in Studio's own page, as the channel; Shorts with a sound from YouTube's library through the YouTube app's requests (both tested for real, Nov 2026)                                                                                                       |
| `facebook`            | api     | Facebook                  | profile and Pages, their posts (sync), sounds for a Page's reels | Pages: feed posts with pictures or text, now or scheduled on Facebook, and deleting them (tested for real, Nov 2026); reels, with a sound from Meta's music library or their own audio, through Business Suite's requests (tested for real, Nov 2026). The login's own profile: not yet |
| `instagram`           | api     | Instagram                 | the account, its posts (sync), sounds for reels                  | reels, with a sound from Instagram's library or with their own audio, feed posts (a picture or a carousel of up to 10), stories (a picture or a video) and deleting posts, through the Instagram app's requests (all tested for real, Nov 2026). Edits: not yet                         |
| `tiktok`              | api     | TikTok                    | the account, sounds for videos                                   | videos with a sound from TikTok's library at both volumes, now or scheduled, and deleting them, made in TikTok Studio's own page in the account's browser profile (tested for real with an "Only you" post, Nov 2026)                                                                   |
| `meta-business-suite` | browser | Facebook Pages, Instagram | Pages, linked Instagram                                          | posts, reels, stories, scheduling                                                                                                                                                                                                                                                       |
| `tiktok-studio`       | browser | TikTok                    |                                                                  | uploads; its TikTok Studio steps (with the editor's sound step) are what the `tiktok` connector posts with                                                                                                                                                                              |
| `youtube-studio`      | browser | YouTube                   |                                                                  | uploads (kept for accounts connected with it)                                                                                                                                                                                                                                           |

While an account's publishing is switched off (`capabilities.publish: false`), every write to it — publish,
update, remove — is refused; only dry runs go through.

A sign-in names its connector (`POST /connectors/sessions {platform, driver}`); the first connector of a platform
is the default.

### One sign-in, many accounts

A sign-in connects **everything it reaches**: every YouTube channel of a Google account (brand channels
included), a Facebook profile and every Page it can act as, a Page's linked Instagram. Each is an account of its
own (`connector_accounts`), sharing the sign-in's session. Where a post goes is chosen in the composer, and a
project remembers where its posts last went (`project_post_destinations`): a new post there starts with the same
destinations.

Settings → Connected accounts lists accounts **by sign-in**: who signed in and where (a Google account, a Facebook
login on facebook.com or on Business Suite, an Instagram login), with the channels, Pages and accounts it reaches
under it (`Account.signIn`).

### One account through two connectors

The same account reached by two connectors — the GEM Page through facebook.com and through Business Suite, an
Instagram account through instagram.com and through Business Suite — is **one account** (`merge.ts`). They are told
apart by the ids each reads (a Page's classic id, which facebook.com keeps as `delegate_page_id`; Instagram's
`fbid_v2`, Business Suite's `igUserId`; a YouTube channel id), never by name. The platform's own connector leads;
the other is merged into it (`connector_accounts.merged_into`), listed under its own sign-in as merged, and no
longer offered in the composer. The account then does what either can (`capabilities` is their union, but for
the schedule, which is what the connector that publishes each placement keeps, see below):
publishing goes through the main connector when it can do everything the post asks, otherwise through the one
that can (a reel, a story, music, a place). The version remembers which connector published it
(`post_targets.via_account_id`), so edits and deletes go back through it. Merging runs after every sign-in and
refresh and when the server starts; turning off or disconnecting a merged account does it to all its connectors.

### Who keeps a post's time

A version with a time is scheduled **on the platform** when the connector that publishes it keeps that kind of
post that far ahead (`capabilities.nativeSchedule`, narrowed by `scheduleOn`, the placements it schedules, and
`scheduleWindow`, how soon and how far ahead; `platformKeepsSchedule` in `@greenlit/shared`). Otherwise
**Greenlit holds it**: publishing leaves the version queued with its time, the post page and the calendar show it
as "Scheduled in Greenlit", and `posts.due` (every minute) sends it when its time comes. A held post goes out only
if Greenlit is running at that time; one the platform keeps goes out even if Greenlit is off. A dry run of a held
version says so in its first step and rehearses the publish as it will be sent then.

| Connector           | Kept on the platform                 | Held by Greenlit                 |
| ------------------- | ------------------------------------ | -------------------------------- |
| `facebook` (a Page) | feed posts at least 10 minutes ahead | reels, and anything sooner       |
| `instagram`         | nothing yet                          | feed posts, reels and stories    |
| `tiktok`            | videos 15 minutes to 10 days ahead   | a time sooner or later than that |
| `youtube`           | videos and Shorts                    | nothing                          |

Capabilities are saved on each account by its checks; when the server starts they are brought up to what the
connectors of that version do, so a change like this one applies at once.

An account can be **turned off** (`POST /connectors/accounts/{id}/enabled {enabled: false}`) without losing the
sign-in it shares with others: it is left out of publishing, the sign-in checks and reading posts, the composer
shows it as turned off, and signing in again later keeps it off. Turning it on checks the sign-in again.

## API Anything

`packages/api-anything` is a fork of [api-anything](https://github.com/goodnight000/api-anything) 0.4.0 (MIT,
kept with its license; `FORK.md` lists the changes). It learns a site's operations from the requests its own
frontend sends and calls them over plain HTTP. Greenlit's fork adds what publishing needs, all local-only (never
in a spec shared with the public catalog):

- file and multipart request bodies (uploads, byte ranges for chunked uploads), reading only from Greenlit's data
  folder (`API_ANYTHING_FILE_ROOTS`);
- kept response headers (an upload start returns its address in a header);
- `gen: "sapisidhash"` — Google's per-request `SAPISIDHASH` authorization, made from the session's cookies;
- answers streamed one JSON value per line (GraphQL `@stream` / `@defer`) put back into one answer.

`aa/engine.ts` runs it inside the server: state in `DATA_DIR/api-anything`, sessions sealed with a key derived
from `GREENLIT_SECRET`, nothing shared or reported (`API_ANYTHING_LOCAL_ONLY`). Each sign-in is one API Anything
_site_ named `gl-<session>`, made from the platform's template spec in `aa/sites/<platform>.json`. After a
sign-in (or a cookie import) the browser profile's cookies are handed to that site's session.

### The specs

`aa/sites/*.json` are API Anything site specs, written from recordings of the platforms' own traffic: request
templates with `{param}` slots, cookie references (`cookie:c_user`), derived values (Facebook's `fb_dtsg`, looked
up from its JSON token endpoint before each call) and generated ones (`sapisidhash`). They hold no session
values; `aa/sites.test.ts` checks that and that every spec parses.

| Spec                  | Operations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `youtube.json`        | `channels` (every channel of the sign-in, with its pageId), `resolveHandle` (handle → channel id, public), `videos` (a channel's uploads as Studio lists them, paged), `video`                                                                                                                                                                                                                                                                                                                                                                        |
| `facebook.json`       | `me` (the login's profile), `profiles` (every Page it can act as), `posts` (a timeline, streamed answer merged), `uploadPhoto`, `createPost`, `schedulePost`, `draftPost` and `deletePost` (learned with the requests aborted, as the profile and as a Page; not sent yet). A scheduled post or a draft is the same request as a post plus `unpublished_content_data`. From Business Suite (business.facebook.com, same login): `musicSearch`, `videoUploadStart`, `videoUploadBytes`, `videoUploadReceive` and `createReel` (see below)              |
| `instagram.json`      | `profile` (an account by id; the signed-in one's id is the `ds_user_id` cookie) and `posts` (its grid), the GraphQL queries instagram.com's profile page sends; the form token is looked up in instagram.com's own page (`DTSGInitialData`). From the Instagram app: `musicSearch`, `uploadReelVideo`, `configureReelWithSound`, `configureReel`, `uploadPhoto`, `uploadVideo`, `configurePhoto`, `configureSidecar`, `configureStoryPhoto`, `configureStoryVideo` and `deleteMedia` (see [the platforms' Android apps](#the-platforms-android-apps)) |
| `tiktok.json`         | `account` (the signed-in account, from tiktok.com's passport request)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `business-suite.json` | `uploadPhoto` and `createPost` (Business Suite's one request for Instagram and/or the Page, now or scheduled), recorded in dry runs with the final request aborted; not used by a connector yet                                                                                                                                                                                                                                                                                                                                                       |

A YouTube request acts as a channel with `x-goog-pageid` and the delegation context. A Facebook read acts as the
login (`av` and `__user` from `c_user`); a write as a Page goes the way facebook.com sends it after switching to
the Page: `av` and `__user` are the Page's profile id and the session carries the `i_user` cookie. The driver asks
for that with `asActor` on the call, and the engine keeps a second session for the Page (`gl-<session>-p<page>`),
made from the sign-in's.

### Dry runs

`POST /connectors/accounts/{id}/dry-run` on an API connector sends **no write**: each write the driver makes is
built exactly as it would be sent (API Anything's `plan`) and returned in `dryRun.requests` — method, address,
headers and body with the sign-in's values masked (`<c_user>`), and the files it would upload — and the driver goes
on with placeholder answers (an upload's id). Reads still happen. A dry run may rehearse an account whose
publishing is not switched on yet.

### What plain requests cannot do

- **YouTube Studio's writes** (upload, details, delete) answer `CHALLENGE_PROMPT_TYPE_AUTHENTICATE` unless
  Google's BotGuard attestation ran first (`att/get` → the page runs Google's program → `att/esr` →
  `security/get_web_reauth_url`). That check must run in a real page; Greenlit does not compute it elsewhere.
  So the `youtube` connector writes in Studio itself, in the sign-in's own browser profile: it hands the page the
  session API Anything keeps current, switches to the channel (`youtube.com/signin?pageid=…`), then runs Studio's
  upload, details and delete steps (`drivers/youtube.ts`). Reads stay plain requests.

### Learning an operation

Operations are learned from the platform's own requests, never by guessing:

1. Record the requests a signed-in page sends for the action (a copy of the sign-in's browser profile, secrets
   masked before anything is written). A **write** is learned with the request **aborted** in the browser, so
   nothing is sent while learning; where a write must really happen to learn the next step, it is a private /
   "only me" test post on an account the owner allowed, deleted straight after.
2. Find the smallest request that works over plain HTTP (dropping one field at a time).
3. Write it into the spec with slots for what varies, and call it through the engine.

When a platform has no web feature for something (Instagram music), the Android app's requests are the source.

### Sound previews

The composer plays a sound before and after it is chosen and draws its waveform: `GET
/connectors/accounts/{id}/sounds/{trackId}/waveform` and `…/audio` (byte ranges). A driver says where the audio
is (`Driver.soundAudio`), else the track's own `previewUrl` is used; either way it must be on one of the platforms'
media hosts. ffmpeg reads up to 5 minutes into `DATA_DIR/cache/sounds/<platform>/` with the waveform's peaks
beside it (loudness per 50 ms, scaled to the 98th percentile). A merged account's sounds come from the connector
in it that has sounds (Business Suite for a Facebook Page).

### The platforms' Android apps

**Their sign-ins are accounts too** (`drivers/device-apps.ts`): what the YouTube, Instagram and Facebook apps on
Greenlit's Android device are signed in to is listed in Settings → Connected accounts, under its own sign-in
("YouTube app on Greenlit's Android device"). Greenlit scans the device at start-up, with the health checks, after
the device view closes and on "Find sign-ins" (`POST /connectors/device/scan`): the YouTube app through its account
switcher (`accountsList`, the app's token), Instagram and Facebook from the apps' own files (as root: Instagram's
`current` user, the Facebook app's `authentication` light preferences; never their tokens). Each app account joins
the account already connected that it is, merged by real ids (a channel id, a username, the profile id a Page acts
with), and helps it with what only the app does. A device sign-in never connects an account by itself, nor brings
back one that was disconnected; one that joins a switched-off account starts off. What matches no connected account
is listed after "Find sign-ins" (the scan's `unmatched`: the app, the account's name and id), with what to do: the
app is usually signed in to another account than the one connected here (for a Page, the Facebook app has to act
as the Page's profile). Switching an app's account off stops Greenlit using that app for it.

What only an app does goes through Greenlit's own Android device (`docker/android`, see `docs/DOCKER.md`). A driver
names the app (`Driver.app`: its spec, package and token scope) and calls its operations with `run.api.app(op, …)`:
the app's own requests, sent over plain HTTP from Greenlit with the OAuth token the app holds on the device. That
token is read from Android's account database (as root, the copy deleted straight after) and handed to the app's
API Anything site as the session value `androidToken`. The tokens last about an hour: when the platform refuses
one, Greenlit starts the app, which has Google renew it, reads the new one and sends the request once more.
Nothing is tapped in the app. No device, or the app signed out there, fails that action with its own message
(`DeviceUnavailable`); the account's web sign-in stays as it is.

**YouTube Shorts with a sound** (`aa/sites/youtube-android.json`, recorded from YouTube 21.32.4, Nov 2026). The
YouTube app on the device must be signed in to the Google account that manages the channel.

- `soundSearch` is the Shorts sound picker's search (`sfv/search`, as the channel): each sound is a YouTube video
  id, with its title, artist, cover, clip length and how many Shorts use it.
- A Short with a sound goes up as the app makes it. YouTube's servers mix nothing: the app mixes the sound into the
  video on the phone (from its start point, at both volumes) and uploads that, so Greenlit does the same with
  ffmpeg (the sound's audio from `soundPlayer`, the video stream copied as it is). Then `uploadStart` and
  `uploadBytes` (YouTube's resumable upload server), `createVideo` (protobuf: the upload, the channel's pageId, and
  the edit — the video's segment and the sound, from where and for how long, and both volumes as floats), then
  `metadataUpdate` (title, description). `createVideo` links the sound ("Use this sound"). The Short is private until
  it is finished: any other visibility, a schedule, tags, a thumbnail and translations are then set in Studio, as for
  any upload. Checked by measuring: a Short made from a 1 kHz test tone with the video's volume at 0 carries the
  sound and no tone.
- The app's integrity data (`/1/5/34`, `/1/9`), the device's identifiers and the recorded request info (a
  consistency token jar, experiment data) are left out of the templates; YouTube accepts the requests without
  them.
- Previews: `soundPlayer` is the app's player answer for the sound's video id; its progressive stream (itag 18)
  plays from Greenlit's address. Greenlit cuts the first 5 minutes into its sound cache (`sounds.ts`) for the
  composer's player and waveform.

**Instagram reels and sounds** (in `aa/sites/instagram.json`, recorded from Instagram 455 for Android, Nov 2026).
These are the app's requests, but they need no token from the device: they go with the instagram.com sign-in's own
session, in the header form the app uses (`Authorization: Bearer IGT:2:<base64 of ds_user_id and sessionid>`, API
Anything's `gen: igt`). The app's attestation header (`x-meta-zca`), its device ids and its upload provenance data
are left out; Instagram takes the requests without them. An op marked `cookies: false` goes without the session's
Cookie header and without the browser's `sec-fetch-*` headers, as the app's own request does (an endpoint may
refuse a cookie- or sec-fetch-carrying request as not its app's); its cookie-ref slots still read the session.

- `musicSearch` is the reel audio picker's search (`music/search_v2`): each sound has two ids (its asset and its
  cluster, both named by a reel; Greenlit's track id is `<asset>-<cluster>`), its title, artist, cover, length and
  the whole track's address on Instagram's CDN, which is its preview.
- A reel goes up as the app makes it. The app mixes the sound into the video itself (from its start point, at both
  volumes) and uploads that, so Greenlit does the same (`drivers/sound-mix.ts`, shared with YouTube). The address
  of the track is signed and expires (`oe`); one that has expired is found again by searching the sound's title.
  Then `uploadReelVideo` (the file in one piece to `rupload_igvideo/<name>`, with its upload id, the time in ms),
  then the app's Share: `configureReelWithSound` (`media/configure_to_clips`, a JSON body behind `signed_body=
  SIGNATURE.`, reached with API Anything's `prefix:` step) names the sound in `music_params`, in its hidden music
  sticker (`tap_models`, a JSON array written as a string) and in `clips_audio_metadata` with both volumes;
  `volume_data.volume` is the sound's volume as the app encodes it (protobuf field 1 as a float, base64). Without a
  sound, `configureReel` is the same request with the sound's parts left out and the video's own audio at its
  volume (set in the file). While Instagram still processes the upload it answers "Transcode not finished yet" and
  Share is sent again; any other failure of Share is never retried, since the reel may exist.
- Share publishes in the background (`async_publish`, as the app sends it): Instagram answers `ok` without naming
  the reel. A reel also shown in the grid is then read back from it by its caption (`posts`), which gives its id and
  address; one kept to the Reels tab ("Also share to feed" off) is not listed where Greenlit reads, so it keeps the
  upload's id (`upload:<id>`) and the post says Greenlit cannot link to it or delete it.
- `deleteMedia` is the app's Delete (`media/<pk>_<account id>/delete/`): the post goes to Recently deleted, where
  the owner can restore it for 30 days.
- Tested for real (Nov 2026): a reel of the 1 kHz test video with a sound from the library went up on the account,
  shown in the app with the sound linked ("Gentle Resolve · Fellow Travelers") and the caption, then was deleted in
  the app (the request recorded for `deleteMedia`).
- A reel's **location** is the same `location` string as a feed post's, in `configure_to_clips` (recorded with the
  Share held). Tested for real (Nov 2026): a reel tagged Ostuni showed it; deleted through Greenlit.
- **Cover and AI label** (recorded from the reel's "Edit cover" and "Add AI label" with the Share held, nothing
  posted): the cover is a frame of the video, sent as `cover_frame_time_ms` (its time) and `poster_frame_index` (its
  place in the video as a percentage, as the app counts it); no separate image is uploaded. The post's cover
  "frame" sets it (`PublishRequest.thumbnailAt`); a cover that is a picture of its own is left out and Greenlit says
  so. The AI label is `gen_ai_detection_method: SELF_DISCLOSURE_FLOW`, as on feed posts. Tested for real (Nov 2026):
  a reel with the cover at 6 s and the AI label went up showing the label and a late frame as its cover; deleted
  through Greenlit and gone.
- A **paid partnership** label is not offered by the app on this account (neither on the Share screen nor in More
  options: it needs "branded content tools" turned on in the account's settings, which Greenlit does not change),
  so there is no request to learn; Greenlit says it was left out.
- **Editing a post** (the caption): the app's Edit on its own post is `media/<id>/edit_media/` (`editMedia`,
  recorded with the send held on a cached copy of a deleted test post, so nothing was changed). It carries the new
  `caption_text` and names the post's AI label as it is (`gen_ai_detection_method`: `NONE`, or the label while it
  is on), so an edit does not clear the label: Greenlit gives it the post's "made with AI" option. Changing a
  published post's text in Greenlit edits it on Instagram too (feed posts and reels; a story has nothing to
  edit). Only the caption: other changes are refused with a reason. Tested for real (Nov 2026): a feed picture's
  caption was changed from Greenlit and the public page showed the new text, then the post was deleted. Like the
  carousel's Share, this request refuses a browser's `sec-fetch-*` headers ("SecFetch Policy violation"), so it is
  sent app-style (`cookies: false`). An edit that repeats the caption Instagram already has is refused.
- An edit also changes the post's **location** (edit_media's `location`, recorded with the send held) and its
  **comments**: the post menu's "Turn off commenting" is `media/<id>/disable_comments/` (`disableComments`, the
  device id only; `enableComments` turns them back on). Greenlit sends the comments switch when the post's option
  is set.
  Tested for real (Nov 2026): a feed picture's caption and place were changed from Greenlit (the public page showed
  both) and its comments turned off; deleted through Greenlit.
- Not set through these requests yet: a paid partnership (see below). Instagram's own schedule is not used: a reel with a time is
  held by Greenlit and published at that time (see "Who keeps a post's time").

**Instagram feed posts and stories** (the same spec, recorded from the app's Share and "Your story" with the
publish requests held, so nothing was posted, and the held posts discarded in the app).

- A feed picture: `uploadPhoto` (`rupload_igphoto/<upload id>_0_<n>`, a JPEG with its size), then `configurePhoto`
  (`media/configure/`). A carousel of 2 to 10 pictures and videos: each item uploaded with the carousel's id as
  its session (`is_sidecar`), a video with its first frame uploaded as its cover, then `configureSidecar`
  (`media/configure_sidecar/`, the items in order as the app writes them in `children_metadata`). One video in
  the feed is a reel on Instagram, shown in the grid.
- A story: `uploadPhoto` or `uploadVideo` (`share_type: stories`; Instagram makes a video's cover), then
  `configureStoryPhoto` or `configureStoryVideo` (`media/configure_to_story/`). A story has no caption.
- The app adds a Facebook cross-post to these by itself (`share_to_facebook` and the linked Page's id); the
  templates leave it out, so Greenlit never cross-posts. The device's and session's ids and the capture's own
  metadata (provenance, navigation, timeline logs) are left out too.
- The AI label is `gen_ai_detection_method: SELF_DISCLOSURE_FLOW`, sent only when the post asks for it: API
  Anything's `omitEmpty` slot option leaves a JSON member out when its value is empty.
- Like reels, these Share in the background: a feed post is read back from the grid by its caption; a story keeps
  its upload's id and links to the account's stories.
- A **picture with a sound** is a reel on Instagram: the app's editor, once a sound is added, says "New reel" and
  makes the video itself. Greenlit does the same: the picture becomes a silent video of 10 seconds (the post's
  `stillSeconds` option sets another, 3 to 90) with ffmpeg and goes out through the reel-with-sound requests
  above, shown in the grid. Not recorded again: it is the same requests with a video made from the picture.
  Tested for real (Nov 2026): a picture with "Gentle Resolve" went up on the account as a reel with the sound
  linked ("Gentle Resolve · Fellow Travelers") and the caption, then was deleted through Greenlit and was gone
  from its address.
  A carousel takes no sound (Greenlit says so on the post).
- A **picture story with a sound** takes two requests that name the sound (`uploadPhoto` and
  `configureStoryPhotoWithSound`), learned by comparing Greenlit's request with one the app made and Instagram
  played:
  - the **upload** carries the sound for Instagram to burn into the picture
    (`photo_to_video_duration_ms: 20000`, `music_burnin_params: {asset_fbid, offset_ms}`, `sticker_burnin_params`,
    `for_album`). Without these the story shows the song but is silent;
  - the **Share** (`configure_to_story`) carries the app's hidden music sticker (`tap_models`,
    `story_music_metadata`, `story_sticker_ids: music_overlay_sticker_hidden`): the sound's ids, where it starts, how
    long it plays (20 s), its audio address, DASH manifest, cover, title, monetization info and highlight times,
    which come from the sound search (`musicSearch` picks `dashManifest` and `monetization`). A sound the search
    gives no manifest for is left out and Greenlit says so.
    The app also cross-posts stories to Facebook by itself (`share_to_facebook`); Greenlit's request leaves that out.
    A story's Share answers "ok" before publishing and gives no id, so Greenlit cannot tell a story that never
    appeared: check the account after a story with new request shapes (the phone's app can show a story minutes
    late). Tested for real (Nov 2026): the 1 kHz test picture with "Gentle Resolve" from 1.5 s went up as a story
    and played the sound; deleted in the app.
- A **video story with a sound** is the same (recorded with the Share held): the video's upload carries
  `music_burnin_params`, and `configureStoryVideoWithSound` is `configure_to_story/?video=1` with the music sticker,
  the sound playing as long as the video and the video's own sound muted (`audio_muted`, the app's "music only").
  Tested for real (Nov 2026): the 1 kHz test video with "Gentle Resolve" played the sound; deleted in the app.
- A story's **location** is the app's location sticker (recorded with the Share held): `tap_models` names a
  `type: location` sticker with its `meta_place_id` and where it sits, and `story_sticker_ids: location_sticker`.
  The app draws its stickers into the picture or video (the upload carries no sticker), so Greenlit draws a white
  pill with a pin and the place's name in the middle (`frames.ts`: sharp for a picture, an ffmpeg overlay for a
  video) and names that area. A story with a sound takes no location sticker here (said).
  Tested for real (Nov 2026): a picture story showed the white "Ostuni" sticker, and tapping it opened the place;
  deleted in the app.
- **Comments off** on a feed picture or carousel is the app's "Turn off commenting": `disable_comments` in
  `media/configure/` (recorded with the Share held: it also showed `like_and_view_counts_disabled` for "Hide like
  count", not used yet). The carousel's `media/configure_sidecar/` takes the same field, not recorded separately.
  The post's "comments" switch sets it; a story has no such switch.
  Tested for real (Nov 2026): a feed picture with comments off went up and the app showed "Comments are turned off";
  deleted through Greenlit and gone from its address.
- A **location** on a feed picture or carousel: the app's "Add location" searches places with a GraphQL request
  (`placeSearch`: `IGPlaceSearchQuery`, no coordinates sent) and the Share carries the chosen place as `location`, a
  JSON string (`name`, `address` (the distance line), `lat`, `lng`, `external_source: meta_place`,
  `meta_place_id`). Greenlit searches the post's place name and takes the place with the chosen id, else the exact
  name, else the first; a name Instagram does not know goes up without a location and says so. Recorded with the
  Share held; tested for real (Nov 2026): a feed picture tagged "Ostuni" linked to Instagram's Ostuni place, then
  was deleted through Greenlit and was gone. Reels and stories: the same field is likely, not recorded, so they say it was left out.
- A **first comment** is posted once the post is up, as the app's comment box posts it (`postComment`:
  `media/<id>/comment/`, recorded with the send held on one of the account's own posts; the app first asks
  `media/comment/check_offensive_comment/`, which Greenlit does not). The app's `user_breadcrumb`, a signed
  typing-behavior token, is left out and not computed: Greenlit does not reproduce an integrity signal, so
  Instagram took the comment without it when tried. A refused comment leaves the post up and Greenlit says so. Feed
  posts and reels; a story has no comments. Tested for real (Nov 2026): a feed picture with a first comment went
  up, the comment was there without the `user_breadcrumb` (Instagram took it), then the post was deleted through
  Greenlit and was gone. Reels: not tested.
  **Pin the first comment** (the post's "Pin the first comment" switch): the app's Pin on a long-pressed comment is
  `POST media/<id>/pin_comment/<comment id>/` with only the user and device ids (recorded with the send held, on a
  test post and comment made by Greenlit and deleted after). Greenlit pins the comment `postComment` named; when
  Instagram refuses, the comment stays up and Greenlit says so. Tested for real (Nov 2026): a feed picture
  with a pinned first comment went up and the comment showed pinned; deleted through Greenlit and gone.
- Not set through these requests yet: a paid partnership (see the reels' note). A time is kept by Greenlit, as for reels.
- `media/configure_sidecar/` refuses a request that carries a browser's Fetch Metadata headers
  (`sec-fetch-*`, which Node's `fetch` adds) with "SecFetch Policy violation": a carousel's Share is sent as an
  app-style request (API Anything's `cookies: false`, which also strips those headers, see below).
- Tested for real (Nov 2026): a picture, a carousel (a picture and a video), a picture story and a video story
  went up on the account, were checked in the app (the carousel's two items, both stories), left GEM's Facebook
  Page untouched, and were deleted (the carousel through Greenlit, the stories in the app).

**Facebook reels and sounds** (in `aa/sites/facebook.json`, recorded from Meta Business Suite's reel composer as
the GEM Page, Nov 2026, with every write but the video upload aborted, so nothing was posted). They go with the
`facebook` connector's own login, as the Page: `av` is the Page's classic id (Business Suite's `asset_id`), sent
as the login itself (not the Page's profile session facebook.com's own posts use).

- `musicSearch` is the composer's audio search (`ReelComposerAudioSearchResultsContainerFBQuery`, as the Page):
  Meta's music library, the tracks available for business use; each has its asset id, title, artist, cover, the
  whole track's address (its preview) and its length. Its tags' names are the track's suggested starts, in ms.
- The video goes up in three steps: `videoUploadStart` (`ajax/video/upload/requests/start/`: the size; it answers
  the video's id and an upload session), `videoUploadBytes` (the file in one piece to `rupload.facebook.com/
  fb_video/<name>`, with the login's `__user` and `fb_dtsg` in the address, which the upload service checks; the
  composer's regional host, from `video/composer/init_upload/`, answers the same) and
  `videoUploadReceive` (the upload service's handle). An upload makes no post. The cover is the video's first
  frame, uploaded with facebook.com's `uploadPhoto` as the Page.
- `createReel` is the composer's Share (`BusinessComposerStoryCreationMutation`, Facebook only): the text, the
  cover and `web_reels_composer_video_edits`, which Facebook renders itself: `music_overlay` (the asset, where in
  the track it starts and for how long, in whole seconds; left out for a reel without a sound, API Anything's
  `omitEmpty`) and `audio_mixing` (both volumes, 0 to 1). Unlike the YouTube and Instagram apps, nothing is mixed
  into the file. The composer posts to the Page and its linked Instagram by default; the template is the Facebook
  only Share (`channels: FACEBOOK_NEWS_FEED`).
- The post is named in the Share's answer, else read back from the Page's timeline by its text; the reel's
  address is `facebook.com/reel/<video id>`.
- The **cover** is the post's own when it has one (a frame Greenlit took, or a picture from the library), uploaded
  as the composer uploads its cover; else the video's first frame. Tested for real (Nov 2026): a reel with its cover
  at 6 s showed that frame; deleted through Greenlit.
- A reel's **place** is the reel composer's "Location": the Share's `explicit_place_id` (empty without one, as the
  composer sends it), from the same facebook.com place search as a feed post's. Recorded with the Share aborted.
  Tested for real (Nov 2026): a reel tagged Ostuni showed it; deleted through Greenlit.
- A reel with a time is held by Greenlit and published at that time (Facebook schedules only the Page's feed posts
  here).
- Tested for real (Nov 2026): a reel of the 1 kHz test video with "Lofi Return" from 49 s, the video's own audio
  at 0, went up on the Page with the sound linked ("half.cool · Lofi Return"); its audio measured as the track
  alone (the tone gone) and lined up with the track at 49.0 s. Nothing reached the linked Instagram. It was
  deleted through Greenlit (facebook.com's delete, as the Page) and was gone from its address, the Page's reels and
  its timeline.

**Facebook places and first comments** (recorded on facebook.com as the login, Nov 2026, with every write aborted,
so nothing was posted; sent as the Page in its own session, as the Page's posts are):

- A feed post's **place** is the composer's "Check in": `placeSearch` (`useComposerLocationPickerTypeaheadDataSourceQuery`,
  `caller_platform: FB_COMPOSER_CHECKIN`) finds places by name (each a Page id, its name, and whether it is a
  city-like "geohub"), and `createPost` / `schedulePost` carry the chosen one as `explicit_place_id` with
  `place_attachment_setting: SHOW_ATTACHMENT` (both left out without a place). Greenlit takes the place with the
  chosen id, else the exact name, else the first; a name Facebook does not know, or a failed search, posts without
  a place and says so. Tested for real (Nov 2026): a Page picture post tagged
  "Ostuni" showed the place; deleted through Greenlit.
- The **first comment** goes through Graph, as Business Suite replies to comments as the Page, in plain requests
  (no browser): `plannerToken` reads the token Business Suite's settings page embeds for its planner
  (`apiAccessToken`, from the page's HTML), `pageToken` asks Graph for the Page's own token, and `pageComment` is
  `POST /<page>_<post>/comments` (a reel Facebook named no post for: its video) with it. The tokens are tied to the
  login's session, so the Graph calls carry its cookies; they are kept in memory for the run only, and no developer
  app is involved. A dry run reads the two tokens (it shows the comment can go) and sends nothing.
  Tested for real (Nov 2026): a Page picture post and a reel each got their first comment from the Page (the
  post's comment went on the second try, while Facebook still published it); deleted through Greenlit. Facebook publishes a post
  in the background, so the comment is tried again for about 25 seconds while Graph says the post does not exist
  (nothing is made then). Feed posts and reels; a scheduled post gets its comment on Facebook once it is out.
  facebook.com's own comment box (`useCometUFICreateCommentMutation`) was refused ("field_exception") without the
  feed's encrypted tracking, in every variant tried for real (Nov 2026), so it is not used.

**Facebook Page stories** (`createStory` in `aa/sites/facebook.json`, recorded from Meta Business Suite's "Create
story" as the GEM Page, Nov 2026, with every write but the picture upload aborted, so nothing was posted): the
picture goes up with `uploadPhoto` as the Page (an upload makes no story, and the composer's own upload is the same
request), then `createStory` is the composer's Share: the same `BusinessComposerStoryCreationMutation` document as a
reel's, with the picture named in the attachment, its original and burned-in copies and the Facebook story's own
attachment, `channels: FACEBOOK_STORY` and `INSTAGRAM_STORY: null`. The composer's default also shares to the linked
Instagram account (its id is in `identities`); Greenlit sends only the Page. A story has no caption; sounds, a
location and video stories are not set yet, and Greenlit says so. Facebook's answer to the Share was not seen (the
write was aborted): Greenlit takes a post id or address from it when there is one, else keeps the picture's id
(`photo:<id>`) and links to the Page; it cannot delete a story (the Page's stories end after 24 hours, or are
deleted on the Page). Tested for real (Nov 2026): the test picture went up as the Page's story, on Facebook only
(nothing on the linked Instagram); Facebook's answer named no post id, so Greenlit kept the picture's id.

A **video story** (recorded the same way, with the encode let through): the video goes up in the reel's three steps,
`encodeVideo` (`BusinessComposerVideoEncodingTriggerMutation`, as the Page; no post) asks Facebook to encode it,
then `createVideoStory` is the same Share with the video as the attachment (60 seconds at most). A story Facebook
names no post for keeps `story:<id>` (picture or video). Tested for real (Nov 2026): the 1 kHz test video went up as the Page's story; deleted on the
Page.

**TikTok sounds and posts** (recorded from TikTok Studio's upload page and video editor as GEM's TikTok, Nov 2026,
with every write but the video upload aborted). TikTok Studio's own requests are signed in the page (`msToken`,
`X-Bogus`, `X-Gnarly` and the `tt-ticket-guard-*` keys of its Post); Greenlit does not make those anywhere else. So:

- Reads that carry no signature go as plain requests in `aa/sites/tiktok.json`: `account`, and `musicSearch`
  (`api/search/music/full/` with `search_channel=tiktok_music_create`, the editor's Sounds panel): each sound's id,
  title, author, cover, audio (`play_url`, its preview), length and how many videos use it.
- Posts are made in TikTok Studio itself, in the account's own signed-in browser profile (`run.api.browser`, as
  YouTube Studio's writes are), with the TikTok Studio steps of `drivers/tiktok.ts`: the upload, the caption, who
  can see it, the switches, the sound, the schedule, then Post. The page signs its own requests, as for a person.
- The sound is added in the video editor (`chooseSound`): its Sounds panel is searched by the sound's title and
  artist, the result whose id is the chosen sound's (read from the search's own answer) is added with its "+",
  then each track's volume is set in the Audio panel in dB (−60 to +20; 1 is 0 dB, half is −6 dB), the video's own
  track muted outright at 0, and the edit saved. TikTok renders it (its Post names the sound, `music_volume` and
  `origin_volume`). The editor starts a sound at its beginning; another start is not applied (Greenlit says so).
- A post asked to be private ("Only you") or for friends is never posted with TikTok's default: when that choice
  cannot be set, or the menu shows another, the post is not made.
- Tested for real (Nov 2026): a video of the 1 kHz test card with "Lofi" (Domknowz), the video's own sound muted,
  went up as "Only me" (TikTok Studio's list showed it), and was deleted through Greenlit (TikTok Studio's own
  delete); the list and its data no longer named it. The sound could not be read back from the private post
  (TikTok's player streams it encrypted): the same editor steps, recorded with Post aborted, put the sound's id and
  both volumes in the Post.
- **Photo posts** (`photo`): Studio's upload page has a Videos and a Photos tab; the Photos tab's own file input
  takes JPEG, PNG and WebP pictures, several at once (up to 35; the first is the cover, as the page marks it). Its
  form is the video form's: the post's title goes in "Add a catchy title" (90 characters), the text in the
  description, then the place, when to post, who can see it, and "Comment" (photos have no duet or stitch). The
  **cover** is the first picture (the form marks it, with no other cover choice): when the post's cover is one of
  its pictures (`PublishRequest.coverIndex`), Greenlit puts it first; a cover that is not one of them is left out
  and said. A **sound** is the form's "Add sound": its Sounds dialog is searched by the sound's title and artist,
  and the row at the sound's place in the search's own answer (`api/search/music/full/`, as in the video editor) is
  used once it shows the sound's title. A photo post's sound has no volume or start in the form (said when asked).
  Tested for real (Nov 2026): two pictures with "Lofi" (Domknowz) and the second one chosen as cover went up as
  "Only you", played the sound with that cover; deleted through Greenlit. A photo post's
  address is `/@<handle>/photo/<id>`, and Greenlit's delete finds it in the content list by that link. Learned and
  rehearsed in dry runs in the account's own Studio page (nothing posted). Tested for real (Nov 2026): two test
  pictures with a title went up as "Only you"; TikTok named the post (`/photo/<id>`) and it was deleted through
  Greenlit (Studio's content list).
