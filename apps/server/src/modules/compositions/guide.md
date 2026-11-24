# Making videos in Greenlit (for Claude and other agents)

An **editing project** (composition) is a JSON document. You edit it with small **ops**; every open editor
shows the change instantly and plays it live — nothing is rendered until someone asks for an export. Look at
your work with `editor_frame` / `editor_frames` (they draw exactly what the export will contain) and export
with `editor_render`, which turns each output format into a format of one media item linked to the project.

## Document

- `fps`, `duration` (seconds), `background` (CSS colour/gradient).
- `formats`: the output shapes, e.g. `{id:"main",1920×1080}`, `{id:"vertical",1080×1920}`, `{id:"square",1080×1080}`.
  Positions and sizes are pixels of the format being drawn. The first format is the design format; others reuse
  it and can override per clip under `clip.formats[<formatId>]` (transform, keyframes, text, hidden, crop).
- `assets`: media from the library used in the edit `{id, mediaId, formatKey, kind, duration, width, height, hasAudio}`.
  Use `editor_add_media` to add a library item as an asset (and optionally a clip) in one step.
- `tracks`: listed **bottom → top**. `kind: visual | audio`. Each has `clips`.

## Clips

Common: `id, type, start, duration, name, hidden, locked`.

- `video` / `image` / `audio`: `assetId`, `in` (seconds into the source), `speed`, `fit` (cover|contain|fill|none),
  `focusX/focusY` (0..1, what stays in frame with cover — use it to reframe 16:9 footage for 9:16), `crop`.
- `text`: `text: {content, fontFamily, fontSize, fontWeight, color, align, verticalAlign, lineHeight,
  letterSpacing (em), textTransform, background, padding, strokeColor, strokeWidth, shadow,
  animateIn/animateOut: {preset: fade|rise|drop|pop|typewriter|blur|slide-left|slide-right|scale-up|wipe, by: block|line|word|char, duration, stagger, easing}}`.
  Bundled fonts: "Inter Variable", "Jost Variable", "Cinzel Variable", "JetBrains Mono Variable"; others can be
  listed in `fonts` (Google Fonts family names).
- `shape`: `shape: {kind: rect|ellipse|line|path|polygon, fill, stroke, strokeWidth, path (SVG d in the box), sides, trim (0..1, animate for draw-on)}`.
- `solid`: `fill` (any CSS background, gradients included).
- `html` — **code layer** for motion graphics: `html: {code, props, transparent}`. `code` is an HTML document or
  fragment, sandboxed. It must be able to draw any time `t`: every CSS animation/transition/Web Animation is paused
  and moved to `t` automatically (so plain CSS `@keyframes` just work), GSAP's global timeline is moved too, the
  CSS variable `--t` holds the time, and `window.greenlit.onFrame((t, props) => {...})` handlers run (return a
  Promise when drawing is async, e.g. canvas/WebGL). Never use real timers or `requestAnimationFrame` loops to
  advance time — derive everything from `t`. Size: the clip box (`greenlit.width/height`).

Every clip has `transform: {x, y, width, height, rotation, scale, anchorX, anchorY, opacity}` (width/height 0 =
full frame), `style: {radius, shadow, border, blendMode, filters: {blur, brightness, contrast, saturate, hue,
grayscale, sepia}, clipPath}`, `audio: {volume 0..2, muted, fadeIn, fadeOut}`,
`transitionIn` / `transitionOut`: `{type: fade|slide-left|slide-right|slide-up|slide-down|zoom-in|zoom-out|blur|wipe-left|wipe-right|iris, duration, easing}`.

**Keyframes**: `keyframes: {"transform.x": [{t: 0, value: 0, easing: "expo-out"}, {t: 1.2, value: 800}]}` — `t` is
seconds from the clip start; any numeric or colour property path works (`transform.opacity`, `transform.scale`,
`transform.rotation`, `style.filters.blur`, `text.fontSize`, `text.color`, `shape.trim`, `focusX`, `audio.volume`).
Easings: linear, ease, ease-in, ease-out, ease-in-out, expo-out, back-out, spring, hold, or `[x1,y1,x2,y2]`.

## Ops (editor_apply)

```
{op:"add_clip", trackId?, clip}            // no trackId → new track on top
{op:"update_clip", id, patch}              // deep merge, arrays replace, null deletes
{op:"remove_clip", id}
{op:"move_clip", id, start?, trackId?}
{op:"split_clip", id, at}                  // composition time
{op:"set_keyframes", id, prop, keyframes}  // [] removes the animation
{op:"add_track", track, index?} {op:"update_track", id, patch} {op:"remove_track", id} {op:"reorder_tracks", order}
{op:"add_asset", asset} {op:"remove_asset", id}
{op:"set", key: fps|duration|background|formats|markers|fonts, value}
{op:"replace", composition}                 // whole document
```

Ops in one call are applied together (all or nothing). The result includes a readable outline.

## Good practice

- Keep text inside platform safe areas (vertical: avoid the top ~12% and bottom ~20%, right ~15%).
- For a 16:9 → 9:16 cut, add a `vertical` format and set `formats.vertical.keyframes.focusX` on video clips to
  follow the subject, or override transform/fontSize for text.
- Check your work with `editor_frames` at the key moments before exporting.
- The user may be watching in the editor: `editor_state` tells you where their playhead and selection are, and
  `editor_control` can move their playhead to show them something.

## What an export is linked to

The exported item is linked to its editing project ("Rendered from") and to every library item it is made of:
the media whose clips are seen or heard in it, each linked as `source_of` the export ("Made from" on the item,
`links_list` shows them). Brand kit files (logos, fonts, templates) are left out, and so is what the export leaves
out: hidden clips and tracks, muted sound, clips after the end, media only in the bin. Greenlit keeps these links
itself: every export replaces them, so nothing is linked twice and a shot taken out of the edit loses its link on
the next export; links people add by hand are never touched. For an item exported before exports did this,
`POST /api/compositions/{id}/source-links` links it from the edit as it is now.
