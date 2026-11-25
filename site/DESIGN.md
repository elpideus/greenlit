# The Greenlit website

An Astro site published to GitHub Pages at <https://elpideus.github.io/greenlit/> by
`.github/workflows/pages.yml`. It follows the product's own brand ([../docs/DESIGN.md](../docs/DESIGN.md)); this page
records what is specific to the site.

## Concept

```
Idea:        The page is one cut's journey through Greenlit: every chapter is a state the work passes through.
Metaphor:    the signal: two lamps in a capsule, the lower one lights green when work is approved.
Signature:   the i of "Greenlit" is a lamp. On the review recording the frame flips amber → green on the real
             Accept click; further down, the lamp lights and floods the screen green ("the greenlit moment").
Emotion:     a quiet screening room with the lights down; calm, sure, nothing shouting.
Motion verb: light up. Things come out of focus into place; lamps light with the one overshoot in the brand.
Screenshot:  the hero: "Greenlit" set huge beside the flat blocks of green, pale, amber and blue.
```

The chapters follow the work in order and carry its states: Library ("footage in") and Editor ("in the edit") are
**draft**, Review is **in review** (amber), the moment is **greenlit**, Publishing is **scheduled** (blue). The
header's mark follows the chapter you are reading, so the logo is never decoration.

Every large "Greenlit" (hero, the moment, footer) is the wordmark artwork from `brand/`, inlined by
`src/components/Wordmark.astro` from `src/data/wordmark.ts` (generated from `brand/greenlit-wordmark-on-dark.svg`), so
the letters and the i's lamp always match the logo. In the moment, a dark copy of the wordmark sits inside the green
field, which grows as a circle from the lamp, so the light reveals the word.

## System

- **Colour**: graphite `#0C0D0C` ground, ink `#EDEFED`, muted `#A8ACA9` / `#828683`, hairlines at 8–15 % ink, and the
  signal colours only as signals: green `#42D77B`, amber `#F9B73F`, red `#F75D59`, blue `#6AA7F4`. One light chapter
  (`.light`, pale `#F5F7F6`) for "everything around the work".
- **Type**: Geist (self-hosted variable woff2), 650 at −0.055 em for display, 640 at −0.045 em for section titles;
  Geist Mono for timecodes, tokens and code. Sentence case, no tracked capitals.
- **Shape**: windows 18 px, tiles 12 px, controls 10 px. Only lamps, state chips and avatars are round; buttons are
  never pills.
- **Motion**: `cubic-bezier(.16,1,.3,1)` for everything that moves, a `linear()` spring with overshoot only for lamps.
  Reveals are opacity + 28 px + blur 8 px on one curve. Lenis drives scroll on GSAP's ticker; ScrollTrigger scrubs
  the product stage, the statement and the greenlit moment. Under `prefers-reduced-motion` there is no smooth scroll,
  no scrub, no autoplay, and every element is visible.
- **Idle**: at rest the hero's signals keep cycling through states, slowly.

## Content

Everything on the site is real Greenlit, recorded from a demo instance with a fictional studio ("Acme Studio",
Giulia, Alex, Sam) and stock footage from Pexels. Nothing of any customer appears anywhere; the repository's
`scripts/public-release.test.ts` rule applies to this folder too.

Media lives in `public/media` (H.264 loops at 1600×1000, posters as WebP) and screenshots in `src/assets/shots`
(Astro makes the responsive sizes). The film and the ads are rendered from a Remotion project kept outside the
repository; only their outputs are committed.

## Two languages

English lives at the root, Italian under `/it/`. Every word is in `src/i18n/en.ts` and `src/i18n/it.ts` (the same
shape; `it.ts` is typed by `en.ts`, so a missing string fails the build), and the pages are thin: `src/pages/index.astro`
and `src/pages/it/index.astro` both render `src/views/Home.astro` with their language, the guide likewise. The Italian
page shows Italian footage too: the app recorded in Italian on an Italian copy of the demo, in `public/media/it` and
`src/assets/shots/it` (stock footage is shared). Server-written text in the app (history summaries, notifications) is
still English there, as it is in the app today.

The header switch shows the other language, keeps the section you were reading and remembers the choice
(`localStorage` `gl.lang`); an Italian browser opens the Italian page on its first visit. Search engines get
`hreflang` alternates (with `x-default` on English), `og:locale` and its alternate, `inLanguage` in the schema, and
the sitemap's `xhtml:link` pairs. The 404 page carries both languages and shows Italian under `/it/`.

## SEO

Unique titles and descriptions per page, canonical URLs, Open Graph and Twitter cards (with the film as `og:video`),
a web manifest, a sitemap with dates (`@astrojs/sitemap`), and one schema.org graph per page: `WebSite`, `Person`,
`SoftwareApplication` (features, screenshots, the film as `VideoObject`), plus `FAQPage` on the home page (from
the `faq` list in `src/i18n`, the same questions shown on the page) and `HowTo` + `BreadcrumbList` on the guide. Decorative copies
of text carry it in a `data-copy-of` attribute so each sentence appears once in the page text. Optional:
`PUBLIC_GOOGLE_SITE_VERIFICATION` adds the Search Console verification tag. GitHub project pages can't serve a
domain-root `robots.txt`, so submit `https://elpideus.github.io/greenlit/sitemap-index.xml` in Search Console.

## Contact

The contact email is not stored in the repository. Set a repository variable named `CONTACT_EMAIL` (Settings →
Secrets and variables → Actions → Variables); the Pages build passes it in as `PUBLIC_CONTACT_EMAIL`. Locally, put
`PUBLIC_CONTACT_EMAIL=…` in `site/.env` (git-ignored). Without it the site shows the other contact links.

## Run it

```bash
cd site
pnpm install --ignore-workspace
pnpm dev          # http://localhost:4321/greenlit/
pnpm build        # static output in site/dist
```
