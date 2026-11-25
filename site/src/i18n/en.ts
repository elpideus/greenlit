/**
 * Every word on the site, in English. `it.ts` has the same shape in Italian; pages read the one for their language.
 * Strings marked html may hold <span class="tok"> tokens or links and are set with set:html.
 */
export const en = {
  meta: {
    title: 'Greenlit · Self-hosted video review and social publishing for studios',
    description:
      'Open-source, self-hosted video review and social publishing for studios: notes on the frame, a live editor and posts to Instagram, TikTok, YouTube and Facebook.',
    ogAlt: 'Greenlit: the signal mark, flat blocks of green, amber and blue, and the wordmark.',
    twitterAlt: 'Greenlit: self-hosted video review and social publishing.',
    locale: 'en_US',
  },
  chrome: {
    skip: 'Skip to content',
    home: 'Greenlit, home',
    nav: [
      ['Library', 'library'],
      ['Editor', 'editor'],
      ['Review', 'review'],
      ['Publishing', 'publishing'],
      ['Agents', 'agents'],
      ['Self-host', 'self-host'],
    ],
    sections: 'Sections',
    site: 'Site',
    overview: 'Overview',
    start: 'Get started',
    docs: 'Docs',
    menu: 'Menu',
    github: 'Greenlit on GitHub',
    language: 'Language',
    /** the switch shows the other language */
    switchTo: { code: 'IT', name: 'Italiano', label: 'Leggi il sito in italiano' },
    foot: 'Greenlit is free software under the GPL-3.0-or-later. Made by',
    footNav: 'Footer',
    source: 'Source',
    licence: 'Licence',
    contact: 'Contact',
    film: 'The Greenlit film',
    filmClose: 'Close the film',
    soundOn: 'Sound on',
    copy: 'Copy',
    copied: 'Copied',
    selectCopy: 'Select and copy',
  },
  schema: {
    filmName: 'Greenlit: the film',
    filmDescription:
      'Fifty seconds through Greenlit: the library, formats, the live editor, notes on the frame, approval and publishing to four platforms.',
    subCategory: 'Video review and social media publishing',
    features: [
      'Media library with formats, versions and audio tracks',
      'Video review with notes pinned on the frame and timecodes',
      'Single-use share links for client review on a phone',
      'Browser video editor that plays live without rendering',
      'Publishing and scheduling to Instagram, Facebook, TikTok and YouTube',
      'MCP server with 67 tools for AI agents such as Claude Code, Codex and Cursor',
      'REST API with an OpenAPI document',
      'Brand kits, map and globe, production graph, version history',
    ],
  },
  home: {
    hero: {
      sr: 'Greenlit: footage, review and publishing for studios',
      lede: 'Footage, review and publishing for studios that film their work. Self-hosted, open source, and built so people and AI agents work side by side.',
      start: 'Get started',
      film: 'Watch the film · 0:50',
      facts: ['Free and open source', 'Runs on your own server', '67 MCP tools for AI agents'],
    },
    stage: {
      label: 'Greenlit’s library, recorded in the app',
      caption:
        'The library: projects, formats and hover-scrub previews. Recorded in Greenlit, nothing mocked up.',
    },
    statementLabel: 'Why Greenlit',
    statement:
      'Footage sits in one app. Notes arrive in a chat. Edits live somewhere else, and posts go out through four more. Greenlit puts the work, the decisions and the publishing in one quiet room, on your own server.',
    library: {
      state: 'Footage in',
      title: 'One shot. Every format.',
      lede: 'A media item holds every shape of the same content: the 16:9 film, the 9:16 reel, the 1:1 post. Versions combine, like English or Italian with or without the watermark, and extra audio tracks ride along for a voice-over in another language.',
      formats: ['Main', 'Vertical', 'Square'],
      points: [
        [
          'Formats travel together',
          'Each post picks the shape its platform wants, so nothing gets cropped by accident.',
        ],
        [
          'Search that understands you',
          'Type <span class="tok">status:approved</span>, <span class="tok">#drone</span> or <span class="tok">project:</span> and pick from suggestions.',
        ],
        ['Made for you on upload', 'Thumbnails, hover-scrub previews, waveforms, EXIF dates and places.'],
        ['Right-click everything', 'Drop files anywhere to upload, rename in place, act on a selection.'],
      ],
    },
    editor: {
      state: 'In the edit',
      title: 'Edits play live. Nothing to render.',
      lede: 'A timeline where compositions play in the browser as you build them: video, pictures, audio, text, shapes and code layers that run any HTML, CSS or JavaScript animation, frame by frame.',
      video: 'The editor plays a 15-second teaser, then switches between its 16:9, 9:16 and 1:1 formats.',
      term: 'An AI agent using Greenlit’s MCP tools',
      prompt: 'Make a vertical cut of the Coastline teaser.',
      tools: [
        'editor_get  Coastline · 15 s teaser',
        'editor_apply  4 ops · reframe for 9:16',
        'editor_frames  0:02  0:07  0:12',
      ],
      done: 'Done. The 9:16 format is ready to check.',
      points: [
        ['Agents edit with you', 'The same document through MCP. Every open editor updates instantly.'],
        ['Keyframes and transitions', 'On any property: position, scale, opacity, blur, colour, text size.'],
        ['One edit, every format', 'Reframe per format, or let it follow the subject from 16:9 to 9:16.'],
        ['Frame-exact exports', 'They land in the library as formats of one item, linked to their sources.'],
      ],
    },
    review: {
      state: 'In review',
      title: 'Notes land on the frame.',
      lede: 'Reviewers click the picture at the exact moment to leave a note, or drag to mark an area. They attach media, files or pasted pictures, and ask for changes as a checklist that can’t be sent empty.',
      video: 'Giulia sees her earlier notes done, pins a last note on the frame and accepts the cut.',
      waiting: 'Waiting for Giulia',
      greenlit: 'Greenlit by Giulia',
      meta: 'Coastline · Hero film · 0:12',
      points: [
        ['Timecoded, on the spot', 'Every note keeps its moment and its place, and shows on the scrubber.'],
        [
          'Changes as a checklist',
          'Admins tick notes off, send work back for review, or approve it themselves.',
        ],
        ['Review from a phone', 'A single-use link signs your client in to one item, with an expiry.'],
        [
          'Nothing gets lost',
          'Titles, notes, files, posts and edits keep a history you can compare and restore.',
        ],
      ],
    },
    moment: {
      line: 'One click from the reviewer, and the cut moves on to publishing. Everyone sees it, nobody chases it.',
      cue: 'Keep scrolling',
    },
    publishing: {
      state: 'Scheduled',
      title: 'Scheduled where your audience is.',
      lede: 'One post, four platforms, each with its own caption, title, cover, music and options. Schedules are held on the platforms themselves. Sign in with the accounts you already use: no developer apps.',
      phones: [
        ['ig', 'Instagram Reel', 'Dec 2 · 18:30'],
        ['fb', 'Facebook Reel', 'Dec 2 · 18:30'],
        ['tt', 'TikTok', 'Dec 2 · 19:00'],
        ['yt', 'YouTube', 'Dec 2 · 17:00'],
      ],
      calendar:
        'The posts calendar for November 2026: scheduled and published posts with their platform icons.',
      points: [
        [
          'Previews that look like the apps',
          'See the reel, the feed post and the short the way each app will show them.',
        ],
        ['Music from the platform', 'Pick tracks from each platform’s own library. They stay linked there.'],
        ['Encoded per placement', 'Every file is re-encoded with the settings that placement prefers.'],
        [
          'Edits flow both ways',
          'Change a scheduled post in Greenlit or on the platform; both stay in sync.',
        ],
      ],
    },
    more: {
      title: 'And everything around the work.',
      lede: 'The parts a studio reaches for every week, built in rather than bolted on.',
      map: [
        'Map and globe',
        'Projects and media where they were shot, read from GPS tags or placed by hand. Search understands <span class="tok">place:</span>.',
        'Greenlit’s globe view with photo pins on Europe, Africa and Asia.',
      ],
      phone: [
        'Review from a phone',
        'Your client opens one link and decides on the go.',
        'The review queue on a phone, five items waiting.',
      ],
      graph: [
        'The production graph',
        'Every photo, still, clip and film, laid out by process: what was shot, what was made from it, where it was posted.',
        'The production graph by process: drone shots and stills flow into the hero film, its 15-second teaser and the post.',
      ],
      brand: [
        'Brand kits',
        'Drop a kit’s folder. Greenlit reads its colours, fonts and logos, and shows it as a brand book.',
        'A brand kit for a ceramics studio: its mark on clay, five colours and its type.',
      ],
      history: [
        'History you can restore',
        'Who changed what, through the app or the API, and the way back.',
        'The history panel of a video: status and format changes by Giulia and Alex.',
      ],
      also: 'Also inside',
      list: [
        'Share links that sign one person in to one post, item or project, and expire',
        'Storage that archives old media by itself, one file at a time',
        'Code, Markdown, HTML and PDF in the viewer, and FigCraft designs, live',
        'Depth maps for pictures and video, made by Greenlit or brought along',
        'Theme packs, your own logos, English and Italian',
      ],
    },
    agents: {
      title: 'Built for people and AI agents.',
      lede: 'Every part of Greenlit is a documented REST API and an MCP server. Any agent that speaks MCP can search the library, cut a video in the editor while you watch, leave notes and prepare posts, with your permissions.',
      stats: [
        ['67', 'MCP tools'],
        ['REST', 'with an OpenAPI document'],
        ['Live', 'editor API for browser agents'],
      ],
      code: 'Connect any MCP client',
      asks: [
        'Make a 15-second vertical teaser from the drone shots in Coastline.',
        'Which cuts are still waiting for Giulia? Summarise her notes.',
        'Draft Friday’s posts for Instagram and TikTok from the approved reels.',
      ],
    },
    self: {
      title: 'Your server. Your footage.',
      lede: 'One Docker Compose project runs the app, its database, an Android device for what only a platform’s app can do, and an optional Cloudflare Tunnel. Nothing listens on a public port.',
      points: [
        ['GPL-3.0-or-later', 'Free software, yours to run, read and change.'],
        ['Built in modules', 'Add, change or remove a part without touching the rest.'],
      ],
      code: 'Quick start',
      envNote: '# set GREENLIT_SECRET and the public URL',
      /** html: {start} is the guide's address */
      after:
        'Then open Greenlit, create the first admin with the setup code and invite people in Settings → People. The <a class="link" href="{start}">getting started guide</a> has the details.',
    },
    faq: {
      title: 'Questions, answered.',
      lede: 'The short version: free, self-hosted, four platforms, and built to work with AI agents.',
    },
    contact: {
      title: 'Want it running for your studio?',
      lede: 'Greenlit is free and open source. If you’d like a hand setting it up, a feature built for your team, or just to say hello, write to me.',
    },
  },
  faq: [
    {
      q: 'What is Greenlit?',
      a: 'Greenlit is a self-hosted, open-source workspace for studios that film their work: a media library, a review room where notes are pinned on the frame, a browser video editor that plays without rendering, and a publishing desk for Instagram, Facebook, TikTok and YouTube.',
    },
    {
      q: 'Is Greenlit free?',
      a: 'Yes. Greenlit is free software under the GPL-3.0-or-later. You run it on your own server, with no subscription and no price per seat.',
    },
    {
      q: 'Can clients review videos without creating an account?',
      a: 'Yes. A single-use share link signs a person in to one item, post or project, with an expiry. It works on a phone: the reviewer clicks the frame to leave a note and accepts the cut or asks for changes.',
    },
    {
      q: 'Which social platforms can Greenlit publish to?',
      a: 'Instagram, Facebook, TikTok and YouTube: reels, feed posts, stories, carousels, shorts and videos, each with its own caption, title, cover, music and options. Schedules are held on the platforms themselves, and a calendar shows them all.',
    },
    {
      q: 'Do I need developer apps or API keys for the platforms?',
      a: 'No. You sign in with the accounts you already use. Greenlit sends the platforms’ own requests, and for what only a platform’s Android app can do it uses its own Android device in Docker.',
    },
    {
      q: 'How does Greenlit work with AI agents?',
      a: 'Greenlit has an MCP server with 67 tools and a documented REST API, so any MCP client (Claude Code, Codex, Cursor and others) can search the library, cut a video in the live editor while you watch, leave notes and prepare posts, with the permissions of the token you give it.',
    },
    {
      q: 'What do I need to run Greenlit?',
      a: 'A computer with Docker. One Docker Compose project runs the app, its Postgres database and an Android emulator; an optional Cloudflare Tunnel makes it reachable from anywhere without opening a port.',
    },
    {
      q: 'Does Greenlit replace a video review tool and a social media scheduler?',
      a: 'For many studios, yes. Teams often combine a review tool such as Frame.io, a scheduler such as Later or Buffer and a shared drive. Greenlit keeps the footage, the review, the edit and the schedule in one self-hosted app, so approved work goes out from the same place it was reviewed.',
    },
  ],
  start: {
    title: 'Self-host Greenlit with Docker · Get started',
    description:
      'Install Greenlit, the open-source video review and social publishing app, on your own server with Docker Compose, then connect your AI agent.',
    h1: 'Get started.',
    lede: 'Greenlit runs on a computer you control: a home server, a studio machine or a small VPS. One Docker Compose project brings up everything it needs.',
    terminal: 'Terminal',
    mcp: 'MCP client config',
    /** [heading, body (html), the HowTo step text for search engines] */
    steps: [
      [
        'Get the code and set two values',
        'You need Docker with Compose. The secret signs sessions and encrypts connected accounts; the public URL is the address people will use.',
        'Clone the repository, copy .env.example to .env and set GREENLIT_SECRET and GREENLIT_PUBLIC_URL.',
      ],
      [
        'Start it',
        'The app, its database and Greenlit’s own Android device start together and restart by themselves. Add a Cloudflare Tunnel token to <span class="tok">.env</span> to reach it from anywhere without opening a port.',
        'Run docker compose up -d --build. The app, its database and an Android device start together.',
      ],
      [
        'Create the first admin',
        'The server prints a one-time setup code until an admin exists. Open Greenlit, enter it, and invite your team and reviewers in Settings → People.',
        'Read the one-time setup code with docker compose logs app, open Greenlit and create the admin account.',
      ],
      [
        'Connect an AI agent',
        'Create a token in Settings → API &amp; MCP, then add Greenlit to your MCP client: Claude Code, Codex, Cursor or any other. Ask for a teaser and watch the editor.',
        'Create a token in Settings → API & MCP and add Greenlit to any MCP client as a Streamable HTTP server at /api/mcp.',
      ],
      [
        'Work on Greenlit itself',
        'Node 24 and pnpm. Postgres runs in Docker; the API and the web app run on your machine with hot reload.',
        '',
      ],
    ],
    again: 'Run the same command again after an update.',
    devComments: ['# Postgres on :54329', '# API :4310, web :4300'],
    howTo: {
      name: 'How to self-host Greenlit with Docker',
      description:
        'Run Greenlit on your own server with Docker Compose, create the first admin and connect an AI agent over MCP.',
      tool: 'Docker with Compose',
    },
    more: 'Read more',
    docsNote: '',
    docs: [
      ['DOCKER.md', 'Running it with Docker', 'Compose, the tunnel, updates and backups.'],
      [
        'CONNECTORS.md',
        'Connecting social accounts',
        'How Greenlit signs in to Instagram, Facebook, TikTok and YouTube.',
      ],
      ['MCP.md', 'AI agents and MCP', 'Tokens, the MCP server and what the tools can do.'],
      ['ARCHITECTURE.md', 'How it’s built', 'Modules, features, services, events and UI slots.'],
      ['DESIGN.md', 'Design system', 'The signal, colour roles, type, motion and copy.'],
    ],
    repo: 'Open the repository',
    help: 'Ask for help',
  },
  lost: {
    title: 'Nothing on this frame · Greenlit',
    description: 'This page doesn’t exist. Head back to Greenlit.',
    signal: 'A signal asking for changes',
    h1: 'Nothing on this frame.',
    lede: 'The page you were after isn’t here. It may have moved, or the link is missing a letter.',
    back: 'Back to Greenlit',
  },
}

export type Dict = typeof en
