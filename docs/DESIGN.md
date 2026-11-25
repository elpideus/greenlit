# Greenlit design system

Greenlit is a quiet screening room: the work fills the screen, the chrome steps back, and every decision is a light
that turns green. This page is the brand kit and the rules every screen follows. Tokens live in
`apps/web/src/styles/tokens.css`, the type scale and surfaces in `styles/index.css`, the React kit in `apps/web/src/ui/`.

## The signal

The mark (`brand/`) is a signal with two lamps in one capsule: the **upper lamp holds**, the **lower lamp lights
green**. The same lamp runs through the product, so it is never decoration — wherever it appears it tells the state
of something.

| State     | Lamps           | Used for                                                                 |
| --------- | --------------- | ------------------------------------------------------------------------ |
| draft     | two empty rings | new work, nothing asked yet                                              |
| review    | upper amber     | waiting for a decision, work in progress (queued, uploading, publishing) |
| changes   | upper red       | changes asked, failures, signed-out accounts                             |
| greenlit  | lower green     | approved, done, connected, published                                     |
| scheduled | lower blue      | cued up on a platform                                                    |

- `Signal` (`ui/Signal.tsx`) — the full mark, 14–64 px. Its lamp lights with a spring when the state changes
  (the only overshoot in the product).
- `Tally` — the lamp alone, for rows, tiles and chips. `toneFor(status)` maps any Greenlit status to a lamp.
- `Toggle` — **toggles are semaphores**: two sockets in a capsule; off = the lamp sits unlit on the left, on = it
  slides right and lights green. The mark lying on its side.

Only lamps, their housings and avatars are round. Nothing else is a pill.

### Logo files

`brand/greenlit-mark-*.svg` (mark on dark / on light / black / white), `greenlit-wordmark-*.svg` (the _i_'s dot is the
green lamp), `greenlit-lockup-*.svg`, `greenlit-app-icon.svg` (graphite tile, 22% radius). Minimum mark size 14 px;
clear space = the lamp's diameter on every side. Never recolour the housing with the signal colour, outline, stretch or
rotate the mark (except the semaphore, which is the mark on its side by design).

### The composition

The brand's graphic language (sign-in page, empty hero areas, social cards about Greenlit): flat blocks of the signal
colours on graphite — a tall green column holding two signals in graphite, a pale panel holding one, an amber tile with
one rounded corner, a small blue square — with "Greenlit" set huge in Geist 650 at −0.055 em. Flat colour, no
gradients, no glows except a lit lamp's.

## Colour

Every colour is a role. Components never use raw colours; a theme pack (`themes/<id>/theme.json`) sets the roles.

| Role (theme)                | Token / Tailwind                         | Dark                          | Light                         | Use                                                                                      |
| --------------------------- | ---------------------------------------- | ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| bg                          | `canvas`                                 | `#0C0D0C`                     | `#F5F7F6`                     | pages, the top bar                                                                       |
| bgSubtle                    | `well`                                   | `#080908`                     | `#EAEDEB`                     | inputs, search, segmented tracks (they receive content)                                  |
| surface                     | `panel`                                  | `#131413`                     | `#FFFFFF`                     | side panels, cards, settings groups                                                      |
| surfaceRaised               | `raised`                                 | `#1A1C1A`                     | `#FFFFFF`                     | menus, dialogs, toasts, secondary buttons                                                |
| —                           | `hover` / `press`                        | ink 6% / 10%                  | ink 6% / 10%                  | rows, ghost buttons, menu items                                                          |
| —                           | `stage`                                  | `#050605`                     | `#050605`                     | behind footage, always dark                                                              |
| border / borderStrong       | `line` / `line-strong`                   | ink 8% / 15%                  | ink 9% / 17%                  | hairlines; spacing separates groups first                                                |
| text, textMuted, textSubtle | `ink`, `ink-2`, `ink-3` (+ `ink-4`)      | `#EDEFED` `#A8ACA9` `#828683` | `#141715` `#525753` `#686D69` | primary, secondary, meta, disabled                                                       |
| accent                      | `signal` (+ `signal-ink`, `signal-soft`) | `#42D77B`                     | `#007F3D`                     | the one commit action, selection, playhead, focus, lit lamps — a few percent of a screen |
| warning                     | `review`                                 | `#F9B73F`                     | `#A35F00`                     | waiting for a decision                                                                   |
| danger                      | `cut`                                    | `#F75D59`                     | `#C52C2A`                     | changes asked, errors, destructive                                                       |
| info                        | `cue`                                    | `#6AA7F4`                     | `#1C65C8`                     | scheduled, cued up                                                                       |

Neutrals carry a faint green tint. Green is a signal, not decoration: if a screen looks green, something is wrong.
Platform colours (Instagram pink, YouTube red…) appear only on their own glyphs (`components/PlatformIcon`).

## Type

**Geist** for everything, **Geist Mono** for numbers that change (timecodes, sizes, counts, shortcuts). Weights 400,
450, 500, 550, 600 (650 only in the brand composition). Sentence case everywhere; no tracked capitals in the UI.
Tracking and leading move with size:

| Class        | Size / leading   | Tracking  | Use                                             |
| ------------ | ---------------- | --------- | ----------------------------------------------- |
| `t-display`  | 34–56 / 1.02     | −0.036 em | once per screen at most (empty heroes, sign-in) |
| `t-title-1`  | 26 / 1.12        | −0.024 em | page titles (theme display face)                |
| `t-title-2`  | 19 / 1.22        | −0.017 em | dialog titles, section heroes                   |
| `t-headline` | 14.5 / 1.35, 600 | −0.011 em | group titles, card titles                       |
| `t-body`     | 14 / 1.55        | −0.006 em | reading text (notes, descriptions)              |
| `t-callout`  | 13 / 1.4, 450    | −0.003 em | UI text: buttons, rows, menus                   |
| `t-caption`  | 12 / 1.35        | 0         | meta lines, hints (in `ink-3`)                  |
| `t-micro`    | 11 / 1.3, 500    | +0.01 em  | group labels in menus, badges                   |
| `t-meta`     | 11.5 mono        | −0.01 em  | timecodes, sizes, counts                        |
| `t-label`    | 12.5, 550        | —         | form labels                                     |

A theme can change the display face (e.g. Cinzel, uppercase, +0.03 em) — `t-display` and `t-title-1` follow it, the
UI face stays readable.

## Shape and depth

Radii scale from the theme's base radius (Greenlit 12 px): `rounded-tag` 4 · `rounded-control` 7 (buttons, inputs,
clips) · `rounded-tile` 8 (media frames) · `rounded-panel` 12 (cards, menus, popovers) · `rounded-sheet` 16 (dialogs).

One depth cue per surface: hairlines (`inset 0 0 0 1px var(--line)`) on the canvas; `floating` (translucent material +
`--shadow-float` + a light top edge) on menus, popovers, toasts, the bulk bar; `--shadow-sheet` on dialogs. Translucent
chrome (`material-bar`) lets content scroll under the top bar; its edge shadow appears only once something is under it.
Never stack a translucent surface on another.

## Motion

Motion explains where things come from and go; it never makes anyone wait.

- Respond on pointer-down: buttons scale to 0.97 in 90 ms (`press`). Hover 140 ms. Lamps 220 ms.
- Springs without bounce for anything that moves (`spring.move` 0.38 s, `spring.snap` 0.26 s); a little bounce only
  after a gesture with momentum (`spring.sheet`) and when a lamp lights (`spring.lamp`).
- Popovers and menus grow from their trigger (`gl-pop`, Base UI's `--transform-origin`) and leave the way they came,
  faster than they arrived.
- Pages rise 6 px while fading in (`rise`); lists stagger the first 12 items by 25 ms, never more.
- A media tile morphs into the viewer through a view transition (`view-transition-name: gl-frame`).
- Animate only `transform`, `opacity`, `filter`. Everything is interruptible. Repeated actions don't animate.
- `prefers-reduced-motion` → cross-fades only; `prefers-reduced-transparency` → solid materials.

## Layout

- **Top bar, no sidebar**: brand left, places centre (Library · Projects · Review · Posts · Map), search (⌘K or /),
  activity, notifications, settings and account right. Phones: a bottom tab bar.
- The viewer, the review room and the editor are full-window: the work gets the room.
- Media tiles run edge to edge with no card around them; one meta row under the frame (tally, title, note count).
  Selection is a 2 px signal ring; checkboxes show on hover and while anything is selected; a floating bulk bar acts
  on the selection.
- Page gutters 24 px (16 on phones), max width 1680 px; text pages 880 px.

## Interaction rules

- **Everything that can be right-clicked has a menu** (`useContextMenu`), and the same items sit behind its ⋯ button.
  Order: open / rename, workflow actions, file actions, Delete last (danger). On a selection it says so ("Delete 3
  items"). Long press opens it on touch screens.
- Drop files anywhere on a project or the library to upload; paste pictures into notes.
- Rename in place (double-click, or F2 / Enter on a selected tile).
- Search understands tokens (`status:`, `kind:`, `tag:` / `#tag`, `project:`, `-word`) with suggestions as you type;
  tokens sit in the field as chips.
- Notes are pinned by clicking the frame (drag = mark an area). No "Pin" button. Notes carry the timecode and show on
  the scrubber. "Ask for changes" turns the new notes into a checklist and cannot be sent empty.
- Confirm only destructive, irreversible actions (`confirm()`); everything else is undoable or versioned.
- Every screen has a loading state with the page's rhythm (skeletons after 250 ms), an empty state that says what
  appears here and how to add the first one (no illustrations), and an error state that says what to do.

## Copy

Plain, short, specific, in English and Italian (`features/<id>/locales/{en,it}.json`, always both). Say what happens
with the real nouns ("Sent to Giulia for review", "2 changes sent to Sam"). Buttons are verbs, sentence case, no
trailing period. No exclamation marks, no emoji, no sparkles. Errors say what went wrong and what to do next.

## Themes for other brands

A theme pack is `themes/<id>/theme.json`: light and dark palettes (the roles above), fonts (ui, display, mono),
display style (uppercase, tracking, weight), base radius and default mode. Logos, the mark, favicon and sign-in picture
are set per instance in **Settings → Branding** and stored with the instance's data, so no trademark has to live in
this repository.
