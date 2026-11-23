# Greenlit architecture

Greenlit is a TypeScript monorepo. Everything is split into **modules** (server) and **features** (web) that
are discovered automatically, so adding, removing or changing a part of Greenlit means working inside one
folder.

```
apps/
  server/            Node 24+ (runs .ts directly), Hono, Drizzle, Postgres, pg-boss
    src/core/        the kernel: config, db, http, module loader, events, hooks, jobs, realtime, mcp, settings, versioning
    src/lib/         shared helpers that are not features (ffmpeg, …)
    src/modules/<id> one folder per server module (module.ts, schema.ts, service.ts, …)
    drizzle/         SQL migrations generated from every module's schema.ts
  web/               React 19, Vite, Tailwind 4, Base UI, Motion, TanStack Query, React Router (see "Web app")
packages/
  shared/            zod schemas + types shared by server, web and API clients (src/areas/<area>.ts)
  composition/       editor document model (layers, keyframes, evaluation)
  player/            renders a composition in the browser (preview and headless render)
  platforms/         social platform specs: limits, aspect ratios, safe areas, encoding presets
themes/<id>/theme.json  built-in theme packs
```

## Server modules

A module is `apps/server/src/modules/<id>/module.ts` exporting `defineModule({...})`. The kernel finds every
folder, orders them by `dependsOn` / `after`, and calls `setup(ctx)`. A module whose dependencies are missing is
skipped; `GREENLIT_DISABLED_MODULES=a,b` turns modules off without deleting them.

`ctx` gives a module everything it needs:

|                       |                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.db`, `ctx.sql`   | Drizzle and raw postgres.js. Tables live in the module's `schema.ts`.                                                                         |
| `ctx.api`             | the Hono/OpenAPI app mounted at `/api`. Declare JSON routes with `route(ctx.api, {...})` (validation, permission, OpenAPI docs in one place). |
| `ctx.mcp.tool({...})` | MCP tools for Claude Code (and any MCP client) at `/api/mcp`.                                                                                 |
| `ctx.services`        | cross-module services. Provide yours with `ctx.services.provide('name', impl)` and declare its type by merging into `Services`.               |
| `ctx.hooks`           | synchronous extension points whose answers the caller uses (`media.decorate`, `files.access`, …).                                             |
| `ctx.events`          | fire-and-forget events (`media.updated`, …).                                                                                                  |
| `ctx.entities`        | directory of "things" (media, projects, posts…) so links, comments, search and the map can show any of them.                                  |
| `ctx.jobs`            | background jobs on pg-boss (Postgres only), with visible progress tasks.                                                                      |
| `ctx.realtime`        | WebSocket topics (`media:<id>`, `project:<id>`, `library`, `tasks`…) with per-prefix guards.                                                  |
| `ctx.versions`        | version history: register an entity once, then `record()` after every change.                                                                 |
| `ctx.settings`        | typed key/value settings with defaults.                                                                                                       |
| `ctx.permissions`     | declared in the module definition (`permissions: {...}`); admins have all of them.                                                            |

Rules that keep modules independent:

1. A module only talks to another through `ctx.services`, `ctx.hooks`, `ctx.events` or `ctx.entities`.
   Importing another module's `schema.ts` tables for a join is allowed; importing its service internals is not.
2. Optional integrations check `ctx.has('module')` or use optional services (`places?: PlacesService`).
3. Everything a user changes goes through the module's service, which records a version.
4. Every route and MCP tool takes an explicit permission.
5. Never answer 502/504 from the origin (Cloudflare replaces them with its own HTML page).

Database: `pnpm db:generate` turns the module schemas into a migration in `apps/server/drizzle/`; the server
applies migrations on start.

## Web app

`apps/web` is React 19 + Vite, Tailwind 4 on design tokens (docs/DESIGN.md), Base UI primitives, Motion, TanStack Query,
React Router, Zustand, i18next.

```
src/
  app/          the frame: registry (feature discovery), router, top bar shell, ⌘K palette, notifications, activity
  ui/           the design system (Button, Menu + right-click menus, Dialog, Toggle (semaphore), Signal, Segmented…)
  lib/          api client, realtime socket, session, theme, i18n, time zone formatting, uploads (tus), hotkeys
  data/         shared data hooks for areas many features read (media, projects, people, accounts, tags)
  components/   shared domain components, used by several features:
                viewer/ (the media viewer + its store), library/ (the media browser: grid, search tokens, selection),
                map/ (MapLibre setup, basemap, MiniMap), platform-preview/ (phone emulations of each app),
                MediaThumb, MediaPicker, PeoplePicker, PlatformIcon, DateTimeField, SettingsSection
  features/<id> one folder per feature: feature.ts(x), pages, components, api.ts, locales/{en,it}.json
```

A feature is `features/<id>/feature.ts(x)` default-exporting `defineFeature({...})` (app/feature.ts):

| Key        | What it adds                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `routes`   | pages: `{ path, load: () => import('./Page'), layout: 'shell' \| 'full' \| 'public', permission }` |
| `nav`      | top-bar destinations (and phone tab bar): `{ id, label, to, icon, order, permission, match }`      |
| `commands` | ⌘K actions                                                                                         |
| `settings` | Settings sections: `{ id, label, icon, group, order, permission, load }` → `/settings/<id>`        |
| `slots`    | components rendered in other features' screens (below)                                             |
| `menus`    | items added to other features' right-click / ⋯ menus (below)                                       |
| `globals`  | components mounted once in the signed-in app (dialog hosts, listeners)                             |
| `locales`  | `{ en, it }` strings under the feature's namespace (`useT('<id>')`)                                |

Rules: a feature never imports another feature's folder. It talks to the rest through slots, menus, shared `data/`
hooks, `components/` and the API. Delete a folder and the app still builds; its pages, tabs and menu items are gone.

### Slots

`<Slot name props />` renders every entry features registered for `name`; `useSlot(name, props)` returns them (for
tabs). Entries may set `label`, `icon`, `order`, `permission`, `when(props)`.

| Slot                     | Props                         | Rendered as                                                                            |
| ------------------------ | ----------------------------- | -------------------------------------------------------------------------------------- |
| `nav.badge.<navId>`      | `{}`                          | a count next to a top-bar item                                                         |
| `palette.results`        | `{ query, go }`               | `<Command.Group>` of live results in ⌘K                                                |
| `library.toolbar`        | `{ projectId }`               | extra buttons in the library toolbar                                                   |
| `media.bulk`             | `{ ids, items, clear }`       | buttons in the floating bulk bar                                                       |
| `media.panels`           | `{ media, format }`           | tabs of the viewer's side panel (`label`, `icon` required)                             |
| `media.info.sections`    | `{ media, format }`           | sections in the viewer's Info tab (`format` = the one on screen)                       |
| `media.viewer.tools`     | `{ media, format }`           | buttons in the viewer's top bar                                                        |
| `media.viewer.overlay`   | `{ media, format }`           | layers drawn exactly over the frame (`components/viewer/store` has the frame rect)     |
| `media.viewer.stage`     | `{ media, format }`           | the whole stage, for files a feature shows itself (designs, text files); first wins    |
| `media.scrubber.markers` | `{ media, format, duration }` | marks on the viewer's scrubber (note times)                                            |
| `media.decision`         | `{ media }`                   | the decision area under the viewer's title (review)                                    |
| `project.tabs`           | `{ project }`                 | tabs on a project page (`label`, `icon`); `order < 0` = before Media, the first opens  |
| `project.about.sections` | `{ project }`                 | sections in a project's About tab                                                      |
| `composition.panels`     | `{ composition }`             | tabs in the editor's right panel                                                       |
| `post.panels`            | `{ post }`                    | tabs in the post composer's side panel                                                 |

### Menus

`menuEntries(name, ctx, own)` (app/registry.ts) builds a menu from the owner's items plus every feature's `menus[name]`
contribution, ordered by `order`, with a line between bands: open/rename (< 20), workflow (20–79), files (80–99),
delete (100+).

| Menu          | Context                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `media`       | `{ items: Media[], me }` — tiles, rows, the viewer's ⋯ (one or many items) |
| `project`     | `{ project, me }`                                                          |
| `post`        | `{ post, me }`                                                             |
| `composition` | `{ composition, me }`                                                      |

## Brand kits

A project has a `kind`: `project` (work) or `brand` (a brand kit). The **brands** module (server) and feature (web)
make a kit more than a folder of files, without the files stopping being media items:

- Uploads may carry `path` (a file's place inside a dropped folder; `lib/dom` `droppedFiles` / `filePath` keep it,
  `uploadMedia` sends it without the folder the whole drop sits in). `media.created` passes it on; the brands module
  places each file of a kit into a section (logos, colours, fonts, graphics, templates, looks, guidelines, files) and
  a group (its folders) with `placeBrandFile` (`packages/shared/src/areas/brands.ts`), and keeps that in
  `brand_assets`. A `.zip` dropped at a kit's top level is unpacked by the `brands.unpack` job, then trashed.
- Palette files (.ase, .gpl, design tokens, CSS custom properties) are read into the kit's colours and font roles
  (`brand_kits`), merged by value across files; font files are read for family, style, weight and range
  (`lib/fonts.ts`); transparent artwork gets the background it reads on (`surface.ts`); the root README becomes the
  guide (and the project's description when it has none).
- The figcraft module asks `designs.extraFonts` for fonts other modules keep: kits answer with their font files,
  which then show in Design fonts and in FigCraft without being uploaded twice (`designs.fontsChanged` re-syncs).
- `GET /media?projectKind=project` (the library) leaves kits' files out; `projects.decorate` gives kit cards their
  logo, colours and families (`Project.brand`). Deleting a kit trashes its files. MCP: `brand_kits`, `brand_kit`,
  `brand_kit_update`.
- `GET /api/brands/{id}/download[?section=logos&label=Loghi]` streams the kit as a zip (`lib/zip-writer.ts`: stored
  pictures/PDFs with real sizes in their headers, everything else deflated, ZIP64 when needed): each file at the path
  it was added with, under a folder named after the kit; files added on their own or moved go to their section's
  folder. Archived files are read through `files.source()` (the storage module's stream).

## Depth maps

Depth maps are uploaded (made elsewhere: Depth Anything, Marigold, DepthCrafter, a render's Z pass…) or made by
Greenlit (the `depth` module, below). Each is a `media_formats` row with `role` `depth` and the `version` and `key` of the format
it describes (one per format of each version), so file history, processing, storage and downloads work as for any
file. `Media.depthMaps` lists them; `depthMapFor(media, format)` (`packages/shared/src/areas/depth.ts`) finds a
format's own, or lends another version the main version's map when the pictures have the same size (and length).

- Upload target `{ mediaId, formatKey, version?, depth: true }`: a picture's map must be a picture (8/16-bit PNG,
  TIFF, EXR, PFM…), a video's a video. Renaming a format's key moves its map; removing a format or a version removes
  theirs; "make main" swaps them with the formats.
- Processing (`processDepthImage`): the file stays as it is; the preview (thumb.webp, lossless poster.webp) is
  stretched over the values the map uses (16-bit integers through sharp, floats through ffmpeg's own decoder without
  its scaler, which would clip them to 0..1). Distances (near = dark) spanning a lot are spread on a log scale.
  `MediaFormat.depth` says which end is near (`near`: the user's choice via `PATCH /media/{id}/formats/{depthId}`,
  else a guess: EXR = dark, anything else = light), the bit depth and the range; flipping `near` re-reads a picture.
- `POST /media/depth-maps/match {names, projectId?}` finds the formats depth map files belong to by name
  (`depthNameCandidates`: `IMG_0412_depth_16bit.png`, `depth_IMG_0412.png`, `clip_vis.mp4`…). Search: `has:depth`,
  `no:depth`. MCP: `media_view` with `depth: true`, `media_import` with `depth: true`.
- Web (`features/depth`): the viewer tool (Picture / Depth map / Split / 3D, key `D`; make, add, replace), overlays
  under the notes (the map, or a WebGL 2 parallax view) and over them (the split line), the Info section (with live
  progress), the library's "Add depth maps" dialog, bulk-bar button and right-click items, Settings → Depth maps. A
  video map follows the stage's video frame by frame (`useViewer().element`, `followFrames`).

**Made by Greenlit** (`apps/server/src/modules/depth/`): Depth Anything V2 Small (Apache-2.0; Base and Large are
non-commercial), ONNX on the processor with `onnxruntime-node` (its install script, which only fetches CUDA
providers, stays off). The model (99 MB, a pinned revision checked by SHA-256) is downloaded into
`DATA_DIR/models/` the first time; `GREENLIT_DEPTH_MODEL` may point at a local copy.

- Job `depth.generate` (one at a time, a task in Activity): a picture becomes a 16-bit grey PNG of its size (518 px
  inference, upscaled); a video a grey MP4 of the same length (≤ 30 fps, ≤ 1920 px), every other frame through the
  model above 24 fps and the ones between blended, each frame fitted to the previous one (scale and offset by least
  squares) so it doesn't flicker. About 0.5 s per picture and 0.4 s per video frame on 20 threads.
- The map is attached like an upload, with `meta.generated = { model, fromRevision }` (near = light). Greenlit's own
  maps are remade when the picture gets a new file; uploaded ones are kept unless `replace`.
- Setting `depth.auto` (`{ enabled, kinds: all | images }`, permission `depth.manage`): on `media.processed` of a
  format, make its map. Brand kits are left out everywhere.
- `POST /media/{id}/depth/generate {formatId?, replace?}`, `POST /depth/generate {ids | missing, replace?}`,
  `GET /depth/status`, `PATCH /depth/auto`; MCP `depth_generate`. Progress goes to the realtime topic
  `depth:<media id>` (`depth.progress`), and `Media.depthJobs` lists what is being made.

## Data flow

- The web app calls the API with `lib/api.ts`, caches with TanStack Query, and listens to WebSocket topics
  (`useTopic`, `useLiveQuery`) to refresh what changed — including changes made by Claude through MCP.
- Uploads use tus (resumable, 48 MB chunks). Each upload names a _purpose_ (`media.upload`,
  `comment.attachment`…) registered by a module, which decides what the finished file becomes.
- Files are stored once in `DATA_DIR/blobs`, never modified; derived files (thumbnails, previews, sprites,
  waveforms) live in `DATA_DIR/derived/<blob>/`. Old versions stay restorable as long as a revision refers to them.
