# MCP: Greenlit for Claude Code and other agents

Greenlit speaks MCP over Streamable HTTP at `/api/mcp`. Authenticate with a personal API token
(Settings → API & MCP); every tool runs with that person's permissions, so a reviewer's token only
sees reviewer tools.

```bash
claude mcp add --transport http greenlit https://your-greenlit/api/mcp --header "Authorization: Bearer glt_…"
```

Read-only tools are marked _read-only_; tools that publish or delete are marked _careful_. The server
sends usage instructions on connect and exposes the editor guide as the resource
`greenlit://editor/guide` (`editor_guide` returns the same text). The live list for your token is at
`GET /api/mcp/tools`.

## accounts

- **`accounts_available`** — Lists everything a connected account’s sign-in can publish to: every YouTube channel of the Google sign-in, a Facebook profile and every Page it can act as, or (Meta Business Suite) each managed Page and its linked Instagram. A sign-in connects them all; entries with an accountId are connected. Pass `connect` (keys from this list) to connect ones that appeared since, without signing in again.
- **`accounts_check`** — Checks now that an account (or every account, without accountId) is still signed in on its platform. An account that needs a new sign-in becomes needs_login; only a person can sign in again (Settings → Connected accounts → Reconnect).
- **`accounts_list`** _(read-only)_ — The Instagram, Facebook, TikTok and YouTube accounts Greenlit can publish to: id, platform, name, handle, state (connected / needs_login / error), what each can do (placements, native scheduling, music, edit/delete after publishing) and when they were last checked and synced.

## calendar

- **`calendar`** _(read-only)_ — Scheduled and published posts between two ISO dates, in time order.

## comments

- **`comments_list`** _(read-only)_ — Read the feedback on a media item (or composition/post): threads with the spot on the frame (x,y from 0 to 1), the time in seconds for videos, status open/done and attachments. Use comments_view to SEE what a comment points at.
- **`comments_reply`** — Reply to a comment (e.g. to say what you changed).
- **`comments_resolve`** — Mark a comment (change request) as done once it has been addressed, or reopen it with done=false.
- **`comments_view`** _(read-only)_ — Shows the frame a comment refers to with the pinned spot, box and drawing marked on it, so you can see exactly what the reviewer means.

## design

- **`design_export_frames`** — Export frames of a FigCraft design as new media items (pictures, or PDF) in the same project, each linked to the design as "Rendered from". `frames` are frame ids from design_info; default: every frame of the first page. Needs figcraft-cli on the server.
- **`design_info`** _(read-only)_ — What a FigCraft design (a media item of kind "design") holds: its pages, the top-level frames on each (id, name, size), the fonts its text uses and counts of layers, components, styles and variables.

## editor

- **`editor_add_media`** — Add library media to an editing project: creates the asset and (unless asClip=false) a clip. For video/audio, duration defaults to the source length from `in`; images default to 5 s. Visual clips go on a new top track unless trackId is given.
- **`editor_apply`** — Apply ops to an editing project (all or nothing). Open editors update instantly. See editor_guide for the op list. Returns the new revision and outline.
- **`editor_auto_reframe`** — Make a video clip follow its subject in one format (typically "vertical" from 16:9 footage): samples the clip, finds the person/most important region and writes smoothed focusX (or focusY) keyframes. Check the result with editor_frames on that format; refine keyframes by hand with editor_apply if needed.
- **`editor_control`** — Drive the user's open editor: seek to a time, play, pause, select clips, or switch format — e.g. to show them what you changed.
- **`editor_create`** — Create an editing project. formats: any of landscape (16:9), vertical (9:16), square, portrait (4:5), or custom {id,name,width,height}. The first is the design format.
- **`editor_frame`** _(read-only)_ — See one frame of an editing project, drawn exactly as the export will look (no render needed). time in seconds; format id (default the first).
- **`editor_frames`** _(read-only)_ — See several moments at once as a contact sheet (e.g. times [0, 1.5, 3, 6]). Up to 12 frames.
- **`editor_get`** _(read-only)_ — Read an editing project: a readable outline, and the full JSON document when full=true.
- **`editor_guide`** _(read-only)_ — The full reference for editing projects: document model, clip types, keyframes, transitions, code (HTML) layers for motion graphics, and every op. Read it before editing.
- **`editor_list`** _(read-only)_ — Editing projects (optionally of one project): id, name, formats, duration, revision.
- **`editor_render`** — Export an editing project. Each format (default: all) becomes a format of one media item in the same project, linked as "rendered to". Returns a taskId; check it with task_status.
- **`editor_state`** _(read-only)_ — What the people with this editor open are looking at: playhead time, playing, selected clips, format. Use it to understand what the user means by 'this' or 'here'.

## history

- **`history_label`** — Give a version a name (e.g. "Sent to client") and/or a note.
- **`history_list`** _(read-only)_ — List versions of a versioned item (type: media, project, post, composition...). Newest first.
- **`history_restore`** — Restore an older version of an item. The restore becomes a new version, so it can be undone.

## links

- **`links_create`** — Link two items. relation: source_of (from is raw material of to), uses, rendered_to, related, reference_for, published_as.
- **`links_list`** _(read-only)_ — What an item is linked to (sources, renders, where it is used, posts that publish it). type: media | composition | post | project.

## map

- **`map_points`** _(read-only)_ — Projects and media items that have a place, one point per item and place: type, id, title, project, place name and coordinates. Filter with q (title or place name), type (project|media), placeId, or bbox "minLng,minLat,maxLng,maxLat".

## media

- **`media_get`** _(read-only)_ — Everything about one media item: notes, tags, formats with sizes and URLs, places, counts.
- **`media_import`** — Add a file to the library from a path on the Greenlit machine or from a URL. With mediaId it becomes a new format (formatKey e.g. "vertical", "square") or a new file version of that media item.
- **`media_search`** _(read-only)_ — Search the library. q understands words, "phrases", #tag, kind:video|image|audio|document|design, status:draft|in_review|changes_requested|approved, project:"name", place:"name", -exclude.
- **`media_trash`** _(careful)_ — Move media items to the trash (they can be restored).
- **`media_update`** — Change a media item: title, description (notes), tags (replaces the list), status, projectId. Every change is versioned.
- **`media_view`** _(read-only)_ — Look at a media item: returns the picture, or the video frame at `time` seconds (default: the poster), as an image you can see. Use it to check what is in a file before using it.

## music

- **`music_search`** _(read-only)_ — Searches the platform’s own music library for an account (TikTok sounds, Facebook reel music). Returns trackId, title, artist, duration, preview URL and how many posts use it. Put the chosen track on a post target as `music` ({ trackId, title, artist, startAt }): the platform attaches it, nothing is mixed into the file. Returns [] when the platform’s web tools have no music library (YouTube, Instagram).

## places

- **`places_assign`** — Assign a place to a project or media item (they can have several). Give placeId for an existing place, or place for a new one (e.g. a geocoded result from places_search — it is reused if it already exists). Returns all places of that item.
- **`places_search`** _(read-only)_ — Find a place by name or address. Returns `places` (already in Greenlit, with ids and how many things are there; reuse these) and `geocoded` (OpenStreetMap results not in Greenlit yet, with coordinates, kind and sourceId). Set geocode:false to only search existing places.
- **`places_unassign`** _(careful)_ — Remove a place from a project or media item. The place itself stays for other items. Returns the places left.

## platform

- **`platform_settings`** _(read-only)_ — Read the platform settings: time zone (all schedules use it, including on the social platforms), default language, branding and active theme.

## posts

- **`posts_check`** _(read-only)_ — Check a post against each platform’s rules (caption length, hashtags, aspect ratio, duration) before publishing.
- **`posts_get`** _(read-only)_ — Everything about a post: text per platform, translations, music, cover, schedule, state on each platform.
- **`posts_list`** _(read-only)_ — Posts with their status per platform (draft, scheduled, published…). Filter by projectId or mediaId.
- **`posts_publish`** _(careful)_ — Publish or schedule a post on its platforms (a scheduled target is scheduled on the platform when the platform keeps that kind of post that far ahead; otherwise Greenlit holds it and publishes it at its time, so Greenlit must be running then). This posts publicly — only do it when the user asked for it. dryRun=true rehearses everything without the final click.
- **`posts_save`** — Create (no id) or change a post. targets: one per account+placement (accounts_list for ids; placements feed|reel|story|video|short|photo|post). Per target you can override title/caption/hashtags, set tags (YouTube), thumbnail {mode:frame,time}|{mode:media,mediaId}, translations {it:{title,caption}}, music (from music_search), audio {original,music}, options, scheduleAt (ISO with offset; platform time zone applies). It does not publish — use posts_publish.

## projects

- **`projects_create`** — Create a project.
- **`projects_list`** _(read-only)_ — List projects (id, name, counts). Optional text filter.
- **`projects_update`** — Rename a project, change its description, archive it.

## reviews

- **`reviews_list`** _(read-only)_ — Open (or all) review requests, optionally for one media item, with every reviewer decision.
- **`reviews_send`** — Send media items for review to people (use users_list for ids). Sets them In review and notifies the reviewers.

## storage

- **`storage_archive_now`** — Start the archive pass now instead of waiting for the night: media older than the policy age are packed one file at a time (thumbnails and previews stay). Returns a task id to follow with task_status.
- **`storage_stats`** _(read-only)_ — Disk usage of Greenlit: free space, hot vs archived originals, previews, attachments, usage per kind of media, how many files are due for archival, the archive policy and the last archive run.

## tags

- **`tags_delete`** _(careful)_ — Remove tags from every media item that carries them, trash included. Cannot be undone in one step.
- **`tags_list`** _(read-only)_ — Tags already used in the library with their counts. Reuse existing tags instead of inventing near-duplicates.
- **`tags_rename`** — Rename a tag on every media item that carries it, trash included. Several `from` tags merge them into `to` (also how to fix a spelling: "Trullo" → "trullo"). Tags are lower-case English, one concept each.

## task

- **`task_status`** _(read-only)_ — Progress of a background task (render, processing, publishing). Poll it after starting long work.

## users

- **`users_list`** _(read-only)_ — List the people who can use Greenlit (id, name, role). Use ids to send media for review.

## whoami

- **`whoami`** _(read-only)_ — Who the API token belongs to, their role and permissions.
