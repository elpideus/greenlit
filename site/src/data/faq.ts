/** Questions people ask about Greenlit: shown on the home page and published as schema.org FAQPage. */
export const faq: { q: string; a: string }[] = [
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
    q: 'How does Greenlit work with Claude and other AI agents?',
    a: 'Greenlit has an MCP server with 67 tools and a documented REST API. Claude Code can search the library, cut a video in the live editor while you watch, leave notes and prepare posts, with the permissions of the token you give it.',
  },
  {
    q: 'What do I need to run Greenlit?',
    a: 'A computer with Docker. One Docker Compose project runs the app, its Postgres database and an Android emulator; an optional Cloudflare Tunnel makes it reachable from anywhere without opening a port.',
  },
  {
    q: 'Does Greenlit replace a video review tool and a social media scheduler?',
    a: 'For many studios, yes. Teams often combine a review tool such as Frame.io, a scheduler such as Later or Buffer and a shared drive. Greenlit keeps the footage, the review, the edit and the schedule in one self-hosted app, so approved work goes out from the same place it was reviewed.',
  },
]
