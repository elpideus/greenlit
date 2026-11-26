import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  COMMENT_RETRY,
  commentTargetOf,
  FIND_REEL as FB_FIND_REEL,
  facebookApi,
  fbSoundToTrack,
  postWithPhotos,
  storyIdOf,
} from './facebook-api.ts'
import {
  APP_ONLY_WRITES,
  carouselChild,
  editPost,
  FIND_REEL,
  igSoundToTrack,
  instagramApi,
  publishCarousel,
  SHARE_RETRY,
  stillSigned,
  volumeData,
} from './instagram-api.ts'
import { coverFirst, volumeDb } from './tiktok.ts'
import { tiktokApi, ttSoundToTrack } from './tiktok-api.ts'
import type { DriverAccount, DriverRun, PublishRequest } from './types.ts'
import { clockSeconds, countOf, inStudioAs, soundToTrack, youtubeApi } from './youtube-api.ts'

const mixes: string[][] = []
vi.mock('../../../lib/ffmpeg.ts', () => ({
  probe: async () => ({ durationSec: 8.5, hasAudio: true, width: 1080, height: 1920 }),
  // The mix: records its arguments and writes the output file it names last.
  ffmpeg: async (args: string[]) => {
    mixes.push(args)
    await writeFile(args.at(-1)!, 'mixed')
    return { stdout: Buffer.alloc(0), stderr: '' }
  },
}))

/** A run whose API Anything calls answer from `answers` (by operation), recording what was asked. */
function fakeRun(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: { op: string; args: Record<string, unknown> }[] = []
  const callOpts: ({ asActor?: boolean } | undefined)[] = []
  const warnings: string[] = []
  const run = {
    warn: (m: string) => warnings.push(m),
    step: () => {},
    api: {
      site: 'gl-test',
      call: async (op: string, args: Record<string, unknown> = {}, opts?: { asActor?: boolean }) => {
        calls.push({ op, args })
        callOpts.push(opts)
        const a = answers[op]
        if (!a) throw new Error(`unexpected ${op}`)
        return a(args)
      },
      cookies: async () => [],
    },
  } as unknown as DriverRun
  return { run, calls, callOpts, warnings }
}

describe('YouTube through API Anything', () => {
  const channels = [
    { name: 'Alex', hasChannel: false },
    {
      name: 'Viral Maniac',
      handle: '@Viral_Maniac',
      hasChannel: true,
      pageId: '116684877487889621524',
      photo: 'https://yt3.ggpht.com/a=s40-c-k',
    },
    { name: 'Acme', handle: '@example', hasChannel: true, pageId: '100000000000000000001' },
  ]
  const ids: Record<string, string> = {
    '@Viral_Maniac': 'UC2B3kSwohC18hCpd50H6QcQ',
    '@example': 'UCxxxxxxxxxxxxxxxxxxxxxx',
  }

  it('connects every channel of the sign-in, with its pageId and channel id', async () => {
    const { run } = fakeRun({ channels: () => channels, resolveHandle: (a) => ids[a.handle as string] })
    const found = await youtubeApi.discover(run)
    expect(found.map((f) => [f.name, f.externalId, f.platformIds.pageId])).toEqual([
      ['Viral Maniac', 'UC2B3kSwohC18hCpd50H6QcQ', '116684877487889621524'],
      ['Acme', 'UCxxxxxxxxxxxxxxxxxxxxxx', '100000000000000000001'],
    ])
    expect(found[0]!.avatarUrl).toBe('https://yt3.ggpht.com/a=s240-c-k')
    expect(found[0]!.profileUrl).toBe('https://www.youtube.com/@Viral_Maniac')
  })

  it('leaves out a channel whose id cannot be read, and says so', async () => {
    const { run, warnings } = fakeRun({ channels: () => channels, resolveHandle: () => 'not-an-id' })
    expect(await youtubeApi.discover(run)).toEqual([])
    expect(warnings).toHaveLength(2)
  })

  it('reads a channel’s uploads as posts, without drafts', async () => {
    const account: DriverAccount = {
      id: 'a',
      platform: 'youtube',
      externalId: 'UCxxxxxxxxxxxxxxxxxxxxxx',
      name: 'Acme',
      handle: '@example',
      platformIds: { channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx', pageId: '100000000000000000001' },
    }
    const { run, calls } = fakeRun({
      videos: () => [
        {
          videoId: 'aaaaaaaaaaa',
          title: 'Trullo',
          contentType: 'CREATOR_CONTENT_TYPE_VIDEO',
          published: '1795000000',
          draft: 'DRAFT_STATUS_NONE',
          likes: '1',
        },
        {
          videoId: 'bbbbbbbbbbb',
          title: 'Short',
          contentType: 'CREATOR_CONTENT_TYPE_SHORTS',
          published: '1795100000',
          draft: 'DRAFT_STATUS_NONE',
        },
        { videoId: 'ccccccccccc', title: 'Untitled', draft: 'DRAFT_STATUS_PUBLIC', published: '0' },
      ],
    })
    const posts = await youtubeApi.list(run, account, {})
    expect(calls[0]).toEqual({
      op: 'videos',
      args: { pageId: '100000000000000000001', channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx' },
    })
    expect(posts.map((p) => [p.remoteId, p.placement, p.state])).toEqual([
      ['aaaaaaaaaaa', 'video', 'published'],
      ['bbbbbbbbbbb', 'short', 'published'],
    ])
    expect(posts[0]!.stats).toEqual({ likes: 1 })
    expect(posts[0]!.url).toBe('https://youtu.be/aaaaaaaaaaa')
  })

  it('runs writes in Studio as the account’s channel (switched by its pageId first)', async () => {
    const visited: string[] = []
    const steps: string[] = []
    const pageRun = {
      page: async () => ({
        goto: async (u: string) => void visited.push(u),
        url: () => 'https://studio.youtube.com/',
      }),
      step: (m: string) => steps.push(m),
    } as unknown as DriverRun
    const { run } = fakeRun({})
    ;(
      run.api as unknown as { browser: (fn: (r: DriverRun) => Promise<unknown>) => Promise<unknown> }
    ).browser = (fn) => fn(pageRun)
    const account: DriverAccount = {
      id: 'a',
      platform: 'youtube',
      externalId: 'UC2B3kSwohC18hCpd50H6QcQ',
      name: 'Viral Maniac',
      handle: '@Viral_Maniac',
      platformIds: { channelId: 'UC2B3kSwohC18hCpd50H6QcQ', pageId: '116684877487889621524' },
    }
    const out = await inStudioAs(run, account, async () => 'done')
    expect(out).toBe('done')
    expect(visited[0]).toContain('pageid=116684877487889621524')
    expect(steps).toEqual(['Acting as @Viral_Maniac'])
  })
})

describe('YouTube Shorts with a sound (the YouTube app’s requests)', () => {
  const account: DriverAccount = {
    id: 'a',
    platform: 'youtube',
    externalId: 'UC2B3kSwohC18hCpd50H6QcQ',
    name: 'Viral Maniac',
    handle: '@Viral_Maniac',
    platformIds: { channelId: 'UC2B3kSwohC18hCpd50H6QcQ', pageId: '116684877487889621524' },
  }
  const music = {
    trackId: 'n61ULEU7CO0',
    title: 'lofi',
    artist: 'Lofi Girl',
    coverUrl: null,
    previewUrl: null,
    startAt: 5,
    duration: 60,
  }
  let dir = ''
  let video = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gl-yt-'))
    video = join(dir, 'short.mp4')
    await writeFile(video, Buffer.alloc(1234))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  const request = (over: Partial<PublishRequest> = {}): PublishRequest => ({
    accountId: 'a',
    placement: 'short',
    files: [{ path: video, mime: 'video/mp4', kind: 'video' }],
    thumbnailPath: null,
    title: 'A title',
    caption: 'A description',
    tags: [],
    firstComment: '',
    location: null,
    translations: {},
    music,
    audio: { original: 1, music: 1 },
    options: { privacy: 'private' },
    scheduleAt: null,
    timeZone: 'Europe/Rome',
    ...over,
  })

  /** A run whose Android app calls answer from `answers`, recording them; Studio pages are refused. */
  function appRun(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
    const calls: { op: string; args: Record<string, unknown>; key?: string }[] = []
    const studio: string[] = []
    const run = {
      locale: 'it-IT',
      dataDir: dir,
      warn: () => {},
      step: () => {},
      api: {
        site: 'gl-test',
        dryRun: false,
        planned: [],
        call: async (op: string) => {
          throw new Error(`unexpected web call ${op}`)
        },
        app: async (op: string, args: Record<string, unknown> = {}, opts?: { key?: string }) => {
          calls.push({ op, args, key: opts?.key })
          const a = answers[op]
          if (!a) throw new Error(`unexpected ${op}`)
          return a(args)
        },
        browser: async () => {
          studio.push('opened')
          throw new Error('Studio is not open in this test')
        },
        cookies: async () => [],
      },
    } as unknown as DriverRun
    return { run, calls, studio }
  }

  const made = {
    soundPlayer: () => ({
      status: 'OK',
      url: 'https://rr1---sn-x.googlevideo.com/videoplayback?id=1',
      lengthMs: '200000',
    }),
    uploadStart: () => ({
      'x-goog-upload-url':
        'https://upload.youtube.com/?upload_id=AUPLOADID0123456789abc&upload_protocol=resumable&origin=CihodHRwczovL3VwbG9hZA',
      'x-goog-upload-header-scotty-resource-id': 'ABUX7uBSxAbbha0Av4j0I8k0',
    }),
    uploadBytes: () => ({ 'x-goog-upload-status': 'final' }),
    createVideo: () => 'BwtwgRLasfo',
    metadataUpdate: () => ({}),
  }

  it('reads the sound picker’s sounds as tracks: length, uses, cover', async () => {
    const { run, calls } = appRun({
      soundSearch: () => [
        {
          trackId: 'n61ULEU7CO0',
          title: 'lofi',
          artist: 'Lofi Girl',
          duration: '1:00',
          usage: '112K',
          cover: 'c',
        },
        { trackId: 'not an id', title: 'broken' },
      ],
    })
    const tracks = await youtubeApi.searchMusic(run, account, ' lofi ', 'short')
    expect(tracks).toEqual([
      {
        trackId: 'n61ULEU7CO0',
        title: 'lofi',
        artist: 'Lofi Girl',
        coverUrl: 'c',
        previewUrl: null,
        duration: 60,
        usage: 112000,
      },
    ])
    expect(calls[0]!.args).toEqual({ query: 'lofi', pageId: '116684877487889621524', hl: 'it' })
    expect(await youtubeApi.searchMusic(run, account, 'lofi', 'video')).toEqual([])
    expect(clockSeconds('1:02:03')).toBe(3723)
    expect(countOf('1.2M')).toBe(1_200_000)
    expect(soundToTrack({ trackId: 'short' })).toBeNull()
  })

  it('uploads, makes the Short with the sound as the channel, then titles it; private needs no Studio', async () => {
    const { run, calls, studio } = appRun(made)
    mixes.length = 0
    const out = await youtubeApi.publish(run, account, request({ audio: { original: 0.4, music: 0.8 } }))
    expect(calls.map((c) => c.op)).toEqual([
      'soundPlayer',
      'uploadStart',
      'uploadBytes',
      'createVideo',
      'metadataUpdate',
    ])
    calls.shift()
    // the sound is mixed in as the app does: from its start, both volumes, the video stream copied
    const mix = mixes[0]!
    expect(mix.slice(mix.indexOf('-ss'), mix.indexOf('-ss') + 2)).toEqual(['-ss', '5'])
    expect(mix.join(' ')).toContain('volume=0.8')
    expect(mix.join(' ')).toContain('[0:a]volume=0.4')
    expect(mix[mix.indexOf('-c:v') + 1]).toBe('copy')
    const mixed = mix.at(-1)!
    expect(mixed.startsWith(join(dir, 'tmp', 'connectors', 'youtube-sounds'))).toBe(true)
    expect(calls[0]!.args).toMatchObject({ size: 5 })
    const uploadId = calls[0]!.args.frontendUploadId as string
    expect(uploadId).toMatch(/^innertube_android:[0-9a-f-]{36}:0:v=3,api=1,cf=3$/)
    expect(calls[1]!.args).toEqual({
      uploadId: 'AUPLOADID0123456789abc',
      origin: 'CihodHRwczovL3VwbG9hZA',
      path: mixed,
    })
    // and deleted once sent
    expect(existsSync(mixed)).toBe(false)
    expect(calls[2]!.args).toEqual({
      resourceId: 'ABUX7uBSxAbbha0Av4j0I8k0',
      frontendUploadId: uploadId,
      pageId: '116684877487889621524',
      soundId: 'n61ULEU7CO0',
      soundStartMs: 5000,
      seconds: 8,
      nanos: 500_000_000,
      soundVolume: 0.8,
      originalVolume: 0.4,
    })
    expect(calls[3]!.args).toEqual({
      videoId: 'BwtwgRLasfo',
      pageId: '116684877487889621524',
      title: 'A title',
      description: 'A description',
    })
    // every write keyed to this attempt, each its own
    expect(new Set(calls.map((c) => c.key)).size).toBe(4)
    expect(calls.every((c) => c.key)).toBe(true)
    expect(studio).toEqual([])
    expect(out).toMatchObject({ remoteId: 'BwtwgRLasfo', url: 'https://www.youtube.com/shorts/BwtwgRLasfo' })
  })

  it('a public Short is finished in Studio; a failure there is not retried (the Short exists)', async () => {
    const { run, studio } = appRun(made)
    const err = await youtubeApi
      .publish(run, account, request({ options: { privacy: 'public' } }))
      .catch((e: unknown) => e as Error & { retriable?: boolean })
    expect(studio).toEqual(['opened'])
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('BwtwgRLasfo')
    expect((err as { retriable?: boolean }).retriable).toBe(false)
  })

  it('sends a video with a sound through Studio (sounds are for Shorts); refuses an upload address elsewhere', async () => {
    const { run, calls, studio } = appRun(made)
    await expect(youtubeApi.publish(run, account, request({ placement: 'video' }))).rejects.toThrow(
      /Studio is not open/,
    )
    expect(studio).toEqual(['opened'])
    expect(calls).toEqual([])
    const moved = appRun({
      ...made,
      uploadStart: () => ({
        'x-goog-upload-url': 'https://elsewhere.example/?upload_id=x',
        'x-goog-upload-header-scotty-resource-id': 'r',
      }),
    })
    await expect(youtubeApi.publish(moved.run, account, request())).rejects.toThrow(/upload address/)
    expect(moved.calls.map((c) => c.op)).toEqual(['soundPlayer', 'uploadStart'])
  })
})

describe('Facebook through API Anything', () => {
  it('connects the login’s profile and every Page it can act as', async () => {
    const { run } = fakeRun({
      me: () => ({ id: '61000000000001', name: 'Alex Doe', kind: 'User', picture: 'https://x/me.jpg' }),
      profiles: () => [{ id: '100000000000001', name: 'Acme Studio', picture: 'https://x/p.jpg' }],
    })
    const found = await facebookApi.discover(run)
    expect(found.map((f) => [f.name, f.externalId, f.platformIds.kind, f.platformIds.actorId])).toEqual([
      ['Alex Doe', '61000000000001', 'profile', '61000000000001'],
      ['Acme Studio', '100000000000001', 'page', '100000000000001'],
    ])
  })

  it('reads a Page’s timeline back as posts (reels told apart)', async () => {
    const { run, calls } = fakeRun({
      posts: () => [
        {
          postId: '1',
          created: 1794063663,
          text: 'Villa',
          url: 'https://www.facebook.com/reel/9/',
          mediaType: 'Video',
        },
        {
          postId: '2',
          created: 1793365213,
          text: 'Trulli',
          url: 'https://www.facebook.com/x/posts/2',
          image: 'https://img',
        },
        { created: 1 },
      ],
    })
    const page: DriverAccount = {
      id: 'a',
      platform: 'facebook',
      externalId: '100000000000001',
      name: 'Acme',
      handle: '',
      platformIds: { kind: 'page', actorId: '100000000000001' },
    }
    const posts = await facebookApi.list(run, page, {})
    expect(calls[0]).toEqual({ op: 'posts', args: { profileId: '100000000000001', count: 20 } })
    expect(posts.map((p) => [p.remoteId, p.placement, p.thumbnailUrl])).toEqual([
      ['1', 'reel', null],
      ['2', 'feed', 'https://img'],
    ])
    expect(posts[0]!.publishedAt).toBe(new Date(1794063663000).toISOString())
  })

  it('a Page the login can no longer act as fails the check', async () => {
    const { run } = fakeRun({ me: () => ({ id: '61000000000001' }), profiles: () => [] })
    const r = await facebookApi.check(run, {
      id: 'a',
      platform: 'facebook',
      externalId: '100000000000001',
      name: 'Acme',
      handle: '',
      platformIds: { kind: 'page', actorId: '100000000000001' },
    })
    expect(r.ok).toBe(false)
  })
})

describe('Facebook posting through API Anything (switched off until tested for real)', () => {
  const page: DriverAccount = {
    id: 'acc',
    platform: 'facebook',
    externalId: '100000000000001',
    name: 'Acme',
    handle: '',
    platformIds: { kind: 'page', actorId: '100000000000001' },
  }
  const req = (over: Record<string, unknown> = {}) =>
    ({
      accountId: 'acc',
      placement: 'feed',
      files: [
        { path: '/data/a.jpg', mime: 'image/jpeg', kind: 'image' },
        { path: '/data/b.jpg', mime: 'image/jpeg', kind: 'image' },
      ],
      caption: 'Trullo in vendita',
      options: { audience: 'only_me' },
      scheduleAt: null,
      ...over,
    }) as never

  it('uploads each picture, then posts them with the caption as the Page', async () => {
    let n = 0
    const { run, calls, callOpts } = fakeRun({
      uploadPhoto: () => ({ photoID: `p${++n}` }),
      createPost: () => ({
        story: { post_id: '100000000000001_555', url: 'https://www.facebook.com/x/posts/555' },
      }),
    })
    const out = await postWithPhotos(run, page, req())
    expect(calls.map((c) => c.op)).toEqual(['uploadPhoto', 'uploadPhoto', 'createPost'])
    expect(calls[0]!.args).toMatchObject({ actorId: '100000000000001', path: '/data/a.jpg' })
    expect(callOpts.every((o) => o?.asActor)).toBe(true)
    const create = calls[2]!.args
    expect(create).toMatchObject({
      actorId: '100000000000001',
      text: 'Trullo in vendita',
      // a Page posts publicly whatever the option says
      audience: 'EVERYONE',
      attachments: [{ photo: { id: 'p1' } }, { photo: { id: 'p2' } }],
    })
    expect(create.token).toMatch(/^[0-9a-f-]{36}_FEED$/)
    expect(out).toEqual({
      remoteId: '100000000000001_555',
      url: 'https://www.facebook.com/x/posts/555',
      state: 'published',
    })
  })

  it('in a dry run plans the uploads and the post, with placeholder ids, and reports nothing as posted', async () => {
    const { run, calls } = fakeRun({ uploadPhoto: () => ({}), createPost: () => ({}) })
    ;(run.api as unknown as { dryRun: boolean }).dryRun = true
    const out = await facebookApi.publish(run, page, req())
    expect(calls.map((c) => c.op)).toEqual(['uploadPhoto', 'uploadPhoto', 'createPost'])
    expect(calls[2]!.args.attachments).toEqual([
      { photo: { id: '<photo 1>' } },
      { photo: { id: '<photo 2>' } },
    ])
    expect(out).toEqual({ remoteId: 'dry-run', url: null, state: 'published' })
  })

  it('posts as the login profile with the audience asked for, not as an actor session', async () => {
    const profile: DriverAccount = {
      ...page,
      externalId: '61000000000001',
      platformIds: { kind: 'profile', actorId: '61000000000001' },
    }
    const { run, calls } = fakeRun({ createPost: () => ({ story: { post_id: '1_2' } }) })
    await postWithPhotos(run, profile, req({ files: [] }))
    expect(calls[0]!.args).toMatchObject({ actorId: '61000000000001', audience: 'SELF', attachments: [] })
    expect(facebookApi.actorSite?.(profile, 'gl-x')).toBeNull()
    expect(facebookApi.actorSite?.(page, 'gl-x')).toEqual({
      site: 'gl-x-p100000000000001',
      cookies: [{ name: 'i_user', value: '100000000000001' }],
    })
  })

  it('deletes a post by the story id facebook.com uses, as the Page', async () => {
    // as recorded from facebook.com's own "Delete post" (request aborted)
    const recorded = 'UzpfSTEwMDAwMDAwMDAwMDAwMTo3NTY4NDU4OTk3ODAzNjE6NzU2ODQ1ODk5NzgwMzYx'
    expect(storyIdOf('100000000000001', '756845899780361')).toBe(recorded)
    expect(storyIdOf('100000000000001', '108477347434387_756845899780361')).toBe(recorded)
    expect(storyIdOf('100000000000001', recorded)).toBe(recorded)
    expect(() => storyIdOf('1', 'https://x')).toThrow()
    const { run, calls, callOpts } = fakeRun({ deletePost: () => ({}) })
    await facebookApi.remove(run, page, '756845899780361')
    expect(calls).toEqual([{ op: 'deletePost', args: { actorId: '100000000000001', storyId: recorded } }])
    expect(callOpts[0]?.asActor).toBe(true)
  })

  it('publishes feed posts and reels; stories come later', async () => {
    const { run, calls } = fakeRun({})
    await expect(facebookApi.publish(run, page, req({ placement: 'story' }))).rejects.toThrow(
      /stories are for a Page/,
    )
    await expect(facebookApi.publish(run, page, req({ placement: 'photo' }))).rejects.toThrow(
      /photos through facebook.com come later/,
    )
    expect(calls).toHaveLength(0)
  })

  it('schedules a Page post on Facebook itself, as recorded from its composer', async () => {
    const at = new Date(Date.now() + 2 * 3600_000)
    const { run, calls } = fakeRun({ schedulePost: () => ({ story: { post_id: '9' } }) })
    const out = await postWithPhotos(run, page, req({ files: [], scheduleAt: at }))
    expect(calls[0]).toMatchObject({
      op: 'schedulePost',
      args: { publishAt: Math.floor(at.getTime() / 1000) },
    })
    expect(out.state).toBe('scheduled')
  })

  it('refuses videos, profile schedules and schedules under 10 minutes or past 28 days, sending nothing', async () => {
    const { run, calls } = fakeRun({})
    const profile: DriverAccount = { ...page, platformIds: { kind: 'profile', actorId: '61000000000001' } }
    await expect(
      postWithPhotos(run, page, req({ files: [{ path: '/v.mp4', mime: 'video/mp4', kind: 'video' }] })),
    ).rejects.toThrow(/Videos/)
    await expect(postWithPhotos(run, page, req({ scheduleAt: new Date() }))).rejects.toThrow(/10 minutes/)
    // 25 Nov → 30 Dec came back "field_exception" from Facebook: Greenlit keeps such a post itself.
    await expect(
      postWithPhotos(run, page, req({ scheduleAt: new Date(Date.now() + 35 * 86_400_000) })),
    ).rejects.toThrow(/at most 28 days/)
    await expect(
      postWithPhotos(run, profile, req({ scheduleAt: new Date(Date.now() + 3600_000) })),
    ).rejects.toThrow(/profile cannot schedule/)
    expect(calls).toHaveLength(0)
  })
})

describe('Facebook Page reels with a sound (Business Suite’s requests)', () => {
  const page: DriverAccount = {
    id: 'p',
    platform: 'facebook',
    externalId: '100000000000001',
    name: 'Acme Studio',
    handle: '',
    platformIds: {
      kind: 'page',
      actorId: '100000000000001',
      pageId: '108477347434387',
      loginId: '61000000000001',
    },
  }
  let dir = ''
  let video = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gl-fbr-'))
    video = join(dir, 'reel.mp4')
    await writeFile(video, Buffer.alloc(2048))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))
  const music = {
    trackId: '912937830269606',
    title: 'Lofi Return',
    artist: 'half.cool',
    coverUrl: null,
    previewUrl: null,
    startAt: 49.4,
    duration: 118.86,
  }
  const request = (over: Partial<PublishRequest> = {}): PublishRequest => ({
    accountId: 'p',
    placement: 'reel',
    files: [{ path: video, mime: 'video/mp4', kind: 'video' }],
    thumbnailPath: null,
    title: '',
    caption: 'Trullo a Ostuni',
    tags: [],
    firstComment: '',
    location: null,
    translations: {},
    music,
    audio: { original: 0.3, music: 0.8 },
    options: {},
    scheduleAt: null,
    timeZone: 'Europe/Rome',
    ...over,
  })
  function fbRun(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
    const calls: { op: string; args: Record<string, unknown>; key?: string; asActor?: boolean }[] = []
    const warnings: string[] = []
    const run = {
      locale: 'it-IT',
      dataDir: dir,
      warn: (m: string) => warnings.push(m),
      step: () => {},
      api: {
        site: 'gl-test',
        dryRun: false,
        planned: [],
        call: async (
          op: string,
          args: Record<string, unknown> = {},
          opts?: { key?: string; asActor?: boolean },
        ) => {
          calls.push({ op, args, key: opts?.key, asActor: opts?.asActor })
          const a = answers[op]
          if (!a) throw new Error(`unexpected ${op}`)
          return a(args)
        },
        cookies: async () => [],
      },
    } as unknown as DriverRun
    return { run, calls, warnings }
  }
  const shared = {
    videoUploadStart: () => ({
      videoId: '1000000000000001',
      sessionId: '1000000000000002',
      startOffset: 0,
      endOffset: 1048576,
    }),
    videoUploadBytes: () => ({ handle: '1:cmVlbC5tcDQ=:video/mp4:abc' }),
    videoUploadReceive: () => ({ start_offset: 2048, end_offset: 2048 }),
    uploadPhoto: () => ({ photoID: '1000000000000003' }),
    createReel: () => ({
      story_create: { story: { post_id: '757001', url: 'https://www.facebook.com/reel/1000000000000001' } },
    }),
  }

  it('reads the music library’s search as tracks; headers and others are left out', async () => {
    const { run, calls } = fbRun({
      musicSearch: () => [
        { kind: 'MusicPickerHeaderItem', title: 'Only showing music tracks available for business use.' },
        {
          kind: 'AudioAsset',
          assetId: '912937830269606',
          title: 'Lofi Return',
          artist: 'half.cool',
          cover: 'https://scontent.fbri1-1.fna.fbcdn.net/c.jpg',
          preview: 'https://video.fbri1-1.fna.fbcdn.net/o1/a.mp4',
          durationMs: 118860,
          tags: ['49000', '1500'],
        },
      ],
    })
    expect(await facebookApi.searchMusic(run, page, 'lofi', 'feed')).toEqual([])
    expect(
      await facebookApi.searchMusic(run, { ...page, platformIds: { kind: 'profile' } }, 'lofi', 'reel'),
    ).toEqual([])
    const tracks = await facebookApi.searchMusic(run, page, ' lofi ', 'reel')
    expect(calls).toEqual([
      {
        op: 'musicSearch',
        args: { pageId: '108477347434387', query: 'lofi' },
        key: undefined,
        asActor: undefined,
      },
    ])
    expect(tracks).toEqual([
      {
        trackId: '912937830269606',
        title: 'Lofi Return',
        artist: 'half.cool',
        coverUrl: 'https://scontent.fbri1-1.fna.fbcdn.net/c.jpg',
        previewUrl: 'https://video.fbri1-1.fna.fbcdn.net/o1/a.mp4',
        duration: 118.86,
        usage: null,
      },
    ])
    expect(
      fbSoundToTrack({ kind: 'AudioAsset', assetId: '12345', preview: 'https://evil.example/a.mp4' })
        ?.previewUrl,
    ).toBeNull()
  })

  it('uploads the video in three steps, its first frame as cover, then Shares the reel with the sound and both volumes', async () => {
    mixes.length = 0
    const { run, calls } = fbRun(shared)
    const out = await facebookApi.publish(run, page, request())
    expect(out).toEqual({
      remoteId: '757001',
      url: 'https://www.facebook.com/reel/1000000000000001',
      state: 'published',
    })
    expect(calls.map((c) => c.op)).toEqual([
      'videoUploadStart',
      'videoUploadBytes',
      'videoUploadReceive',
      'uploadPhoto',
      'createReel',
    ])
    const [start, bytes, receive, cover, create] = calls
    const waterfall = start!.args.waterfallId
    expect(start!.args).toMatchObject({ pageId: '108477347434387', size: '2048' })
    expect(bytes!.args).toMatchObject({
      waterfallId: waterfall,
      sessionId: '1000000000000002',
      videoId: '1000000000000001',
      endOffset: '1048576',
      size: '2048',
      path: video,
    })
    expect(String(bytes!.args.entityName)).toMatch(/^[0-9a-f]{32}$/)
    expect(receive!.args).toMatchObject({
      waterfallId: waterfall,
      videoId: '1000000000000001',
      handle: '1:cmVlbC5tcDQ=:video/mp4:abc',
    })
    // the cover is the video's first frame, uploaded as the Page, then removed
    expect(cover!.asActor).toBe(true)
    expect(mixes[0]).toEqual(expect.arrayContaining(['-frames:v', '1']))
    expect(existsSync(String(cover!.args.path))).toBe(false)
    // the Share goes as the login (Business Suite), not as the Page's profile
    expect(create!.asActor).toBeUndefined()
    expect(create!.args).toEqual({
      pageId: '108477347434387',
      identities: ['108477347434387'],
      text: 'Trullo a Ostuni',
      placeId: '',
      videoId: '1000000000000001',
      lengthMs: 8500,
      coverId: '1000000000000003',
      seconds: 8,
      width: 1080,
      height: 1920,
      music: { id: '912937830269606', offset: 49, duration: 8 },
      musicVolume: 0.8,
      originalVolume: 0.3,
    })
  })

  it('tags a Page post with the place facebook.com finds, then posts its first comment as the Page', async () => {
    const picture = join(dir, 'feed.jpg')
    await writeFile(picture, Buffer.alloc(300))
    const { run, calls, warnings } = fbRun({
      uploadPhoto: () => ({ photoID: '1000000000000005' }),
      placeSearch: () => [
        { placeId: '101096845055205', name: 'Ostuni - La Città Bianca' },
        { placeId: '112431795438176', name: 'Ostuni', geohub: true },
      ],
      createPost: () => ({ story: { post_id: '108477347434387_1000000000000006' } }),
      plannerToken: () => 'EAAG'.padEnd(60, 'x'),
      pageToken: () => ({ token: 'EAAP'.padEnd(60, 'y'), id: '108477347434387' }),
      pageComment: () => ({ id: '108477347434387_1000000000000006_77' }),
    })
    const out = await facebookApi.publish(
      run,
      page,
      request({
        placement: 'feed',
        files: [{ path: picture, mime: 'image/jpeg', kind: 'image' }],
        music: null,
        location: { name: 'ostuni', platformId: null },
        firstComment: ' Scrivi per info ',
      }),
    )
    expect(calls.map((c) => c.op)).toEqual([
      'uploadPhoto',
      'placeSearch',
      'createPost',
      'plannerToken',
      'pageToken',
      'pageComment',
    ])
    expect(calls[3]!.args).toEqual({ pageId: '108477347434387' })
    expect(calls[4]!.args).toMatchObject({ pageId: '108477347434387', token: 'EAAG'.padEnd(60, 'x') })
    expect(calls[5]!.args).toEqual({
      target: '108477347434387_1000000000000006',
      text: 'Scrivi per info',
      token: 'EAAP'.padEnd(60, 'y'),
    })
    expect(calls[1]).toMatchObject({ args: { actorId: '100000000000001', query: 'ostuni' }, asActor: true })
    expect(calls[2]!.args).toMatchObject({ placeId: '112431795438176', placeShow: 'SHOW_ATTACHMENT' })
    expect(out.remoteId).toBe('108477347434387_1000000000000006')
    expect(warnings).toEqual([])
  })

  it('posts without a place when Facebook has none or the search fails, and keeps the post when the comment fails', async () => {
    const picture = join(dir, 'feed.jpg')
    await writeFile(picture, Buffer.alloc(300))
    const answers = {
      uploadPhoto: () => ({ photoID: '1000000000000005' }),
      createPost: () => ({ story: { post_id: '1000000000000006' } }),
      plannerToken: () => 'EAAG'.padEnd(60, 'x'),
      pageToken: () => ({ token: 'EAAP'.padEnd(60, 'y'), id: '108477347434387' }),
      pageComment: () => ({ error: '(#200) Permissions error' }),
    }
    const feed = (extra: Partial<PublishRequest>) =>
      request({
        placement: 'feed',
        files: [{ path: picture, mime: 'image/jpeg', kind: 'image' }],
        music: null,
        ...extra,
      })
    const none = fbRun({ ...answers, placeSearch: () => [] })
    const out = await facebookApi.publish(
      none.run,
      page,
      feed({ location: { name: 'Nowhere', platformId: null }, firstComment: 'Ciao' }),
    )
    expect(none.calls.find((c) => c.op === 'createPost')!.args).toMatchObject({ placeId: '', placeShow: '' })
    expect(none.warnings.join(' ')).toMatch(/no place called Nowhere/)
    expect(out.state).toBe('published')
    expect(none.warnings.join(' ')).toMatch(/first comment was not posted: \(#200\) Permissions error/)
    const failed = fbRun({
      ...answers,
      placeSearch: () => {
        throw new Error('HTTP 500')
      },
    })
    await facebookApi.publish(failed.run, page, feed({ location: { name: 'Ostuni', platformId: null } }))
    expect(failed.warnings.join(' ')).toMatch(/place search failed/)
    expect(failed.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'placeSearch', 'createPost'])
  })

  it('tries the first comment again while Facebook still publishes the post, and only then', async () => {
    const picture = join(dir, 'feed.jpg')
    await writeFile(picture, Buffer.alloc(300))
    const was = COMMENT_RETRY.waitMs
    COMMENT_RETRY.waitMs = 0
    try {
      let n = 0
      const feed = () =>
        request({
          placement: 'feed',
          files: [{ path: picture, mime: 'image/jpeg', kind: 'image' }],
          music: null,
          firstComment: 'Ciao',
        })
      const base = {
        uploadPhoto: () => ({ photoID: '1000000000000005' }),
        createPost: () => ({ post_id: '1000000000000006', publishing_flow: 'ASYNC_SILENT', story: null }),
        plannerToken: () => 'EAAG'.padEnd(60, 'x'),
        pageToken: () => ({ token: 'EAAP'.padEnd(60, 'y') }),
      }
      const { run, calls, warnings } = fbRun({
        ...base,
        pageComment: () =>
          ++n < 3
            ? { error: 'Unsupported post request. Object with ID does not exist' }
            : { id: '108477347434387_1000000000000006_77' },
      })
      await facebookApi.publish(run, page, feed())
      const tries = calls.filter((c) => c.op === 'pageComment')
      expect(tries).toHaveLength(3)
      // the tokens are read once
      expect(calls.filter((c) => c.op === 'pageToken')).toHaveLength(1)
      expect(warnings).toEqual([])
      // another refusal is not waited for
      const other = fbRun({ ...base, pageComment: () => ({ error: '(#200) Permissions error' }) })
      await facebookApi.publish(other.run, page, feed())
      expect(other.calls.filter((c) => c.op === 'pageComment')).toHaveLength(1)
      expect(other.warnings.join(' ')).toMatch(/Permissions error/)
      // no planner token: said, nothing sent
      const none = fbRun({ ...base, plannerToken: () => null })
      await facebookApi.publish(none.run, page, feed())
      expect(none.calls.map((c) => c.op)).not.toContain('pageComment')
      expect(none.warnings.join(' ')).toMatch(/no planner token/)
    } finally {
      COMMENT_RETRY.waitMs = was
    }
  })

  it('comments under the Page post, or the reel’s video when Facebook named no post; none for an unnamed post', () => {
    expect(commentTargetOf('108477347434387', '1000000000000006')).toBe('108477347434387_1000000000000006')
    expect(commentTargetOf('108477347434387', '108477347434387_1000000000000006')).toBe(
      '108477347434387_1000000000000006',
    )
    expect(commentTargetOf('108477347434387', 'video:1000000000000001')).toBe('1000000000000001')
    expect(commentTargetOf('108477347434387', 'pending:1795373844416')).toBeNull()
    expect(commentTargetOf('108477347434387', 'photo:1000000000000009')).toBeNull()
  })

  it('tags a reel with the place facebook.com finds, as the reel composer does', async () => {
    const { run, calls } = fbRun({
      ...shared,
      placeSearch: () => [{ placeId: '112431795438176', name: 'Ostuni', geohub: true }],
    })
    await facebookApi.publish(run, page, request({ location: { name: 'Ostuni', platformId: null } }))
    expect(calls.find((c) => c.op === 'placeSearch')).toMatchObject({
      args: { query: 'Ostuni' },
      asActor: true,
    })
    expect(calls.find((c) => c.op === 'createReel')!.args).toMatchObject({ placeId: '112431795438176' })
  })

  it('uploads the post’s own cover in place of the first frame, and keeps it for Greenlit to clear', async () => {
    mixes.length = 0
    const own = join(dir, 'chosen-cover.jpg')
    await writeFile(own, Buffer.alloc(100))
    const { run, calls, warnings } = fbRun(shared)
    await facebookApi.publish(run, page, request({ thumbnailPath: own }))
    const cover = calls.find((c) => c.op === 'uploadPhoto')!
    expect(cover.args).toMatchObject({ path: own, filename: 'cover.jpg' })
    // no frame was taken, and the post's cover is not deleted by the driver
    expect(mixes.some((a) => a.includes('-frames:v'))).toBe(false)
    expect(existsSync(own)).toBe(true)
    expect(warnings.join(' ')).not.toMatch(/cover/)
  })

  it('a reel without a sound names none; one Facebook names no post for is read back from the timeline', async () => {
    FB_FIND_REEL.waitMs = 1
    try {
      const { run, calls } = fbRun({
        ...shared,
        createReel: () => ({}),
        posts: () => [
          {
            postId: '757002',
            created: Math.floor(Date.now() / 1000),
            text: 'Trullo a Ostuni',
            url: 'https://www.facebook.com/reel/1',
          },
        ],
      })
      const out = await facebookApi.publish(run, page, request({ music: null }))
      expect(calls.find((c) => c.op === 'createReel')!.args).not.toHaveProperty('music')
      expect(out).toMatchObject({ remoteId: '757002', url: 'https://www.facebook.com/reel/1' })
    } finally {
      FB_FIND_REEL.waitMs = 5000
    }
  })

  it('a failed Share is final; a profile, a schedule and a sound that is not Facebook’s are refused, sending nothing', async () => {
    const broken = fbRun({
      ...shared,
      createReel: () => {
        throw new Error('HTTP 500')
      },
    })
    const err = await facebookApi.publish(broken.run, page, request()).catch((e) => e)
    expect(err.retriable).toBe(false)
    const { run, calls } = fbRun(shared)
    await expect(
      facebookApi.publish(run, { ...page, platformIds: { kind: 'profile', actorId: '1' } }, request()),
    ).rejects.toThrow(/Facebook Page/)
    await expect(
      facebookApi.publish(run, page, request({ scheduleAt: new Date(Date.now() + 3600_000) })),
    ).rejects.toThrow(/go out now/)
    await expect(
      facebookApi.publish(run, page, request({ music: { ...music, trackId: '1-2' } })),
    ).rejects.toThrow(/not one of Facebook/)
    await expect(facebookApi.remove(run, page, 'video:1000000000000001')).rejects.toThrow(
      /delete it on the Page/,
    )
    expect(calls).toEqual([])
  })

  it('shares a picture to the Page’s story as the Page, Facebook only; says what a story leaves out', async () => {
    const picture = join(dir, 'story.jpg')
    await writeFile(picture, Buffer.alloc(300))
    const { run, calls, warnings } = fbRun({
      uploadPhoto: () => ({ photoID: '1000000000000009' }),
      createStory: () => ({ data: { story_create: { story: { id: '777' } } } }),
    })
    const out = await facebookApi.publish(
      run,
      page,
      request({
        placement: 'story',
        files: [{ path: picture, mime: 'image/jpeg', kind: 'image' }],
        caption: 'ignored',
        music,
        firstComment: 'hi',
      }),
    )
    expect(calls.map((c) => c.op)).toEqual(['uploadPhoto', 'createStory'])
    expect(calls[0]).toMatchObject({ args: { actorId: '100000000000001' }, asActor: true })
    expect(calls[1]!.args).toEqual({
      pageId: '108477347434387',
      identities: ['108477347434387'],
      photoId: '1000000000000009',
    })
    expect(out.state).toBe('published')
    expect(out.remoteId).toBe('story:1000000000000009')
    expect(warnings.join(' ')).toMatch(/no caption/)
    expect(warnings.join(' ')).toMatch(/story sounds are not set yet/)
    expect(warnings.join(' ')).toMatch(/first comment was left out/)
    // a video story: uploaded, encoded, shared; a time is refused; a story cannot be deleted from Greenlit
    const vid = fbRun({
      videoUploadStart: () => ({
        videoId: '1000000000000001',
        sessionId: '1000000000000002',
        endOffset: 2048,
      }),
      videoUploadBytes: () => ({ handle: '1:abc' }),
      videoUploadReceive: () => ({}),
      encodeVideo: () => ({}),
      createVideoStory: () => ({}),
    })
    const vout = await facebookApi.publish(
      vid.run,
      page,
      request({ placement: 'story', music: null, caption: '' }),
    )
    expect(vid.calls.map((c) => c.op)).toEqual([
      'videoUploadStart',
      'videoUploadBytes',
      'videoUploadReceive',
      'encodeVideo',
      'createVideoStory',
    ])
    expect(vid.calls[3]!.args).toEqual({ pageId: '108477347434387', videoId: '1000000000000001' })
    expect(vid.calls[4]!.args).toEqual({
      pageId: '108477347434387',
      identities: ['108477347434387'],
      videoId: '1000000000000001',
    })
    expect(vout.remoteId).toBe('story:1000000000000001')
    await expect(
      facebookApi.publish(
        run,
        page,
        request({
          placement: 'story',
          files: [{ path: picture, mime: 'image/jpeg', kind: 'image' }],
          scheduleAt: new Date(Date.now() + 3600_000),
        }),
      ),
    ).rejects.toThrow(/goes out now/)
    await expect(facebookApi.remove(run, page, out.remoteId)).rejects.toThrow(/cannot delete a story/)
  })
})

describe('Instagram through API Anything', () => {
  const withCookie = (answers: Record<string, (args: Record<string, unknown>) => unknown>) => {
    const f = fakeRun(answers)
    ;(f.run.api as unknown as { cookies: () => Promise<unknown[]> }).cookies = async () => [
      { name: 'ds_user_id', value: '31000000001', domain: '.instagram.com' },
    ]
    return f
  }

  it('connects the signed-in account, read by its id', async () => {
    const { run, calls } = withCookie({
      profile: () => ({
        id: '31000000001',
        username: 'acme_studio',
        name: 'Acme Studio',
        picture: 'https://p',
        fbId: '17841431498898211',
      }),
    })
    const [a] = await instagramApi.discover(run)
    expect(calls[0]).toEqual({ op: 'profile', args: { userId: '31000000001' } })
    expect(a).toMatchObject({
      externalId: '31000000001',
      handle: '@acme_studio',
      name: 'Acme Studio',
      // the id Business Suite knows it by: how the two connectors' accounts are told to be one
      platformIds: { userId: '31000000001', username: 'acme_studio', igUserId: '17841431498898211' },
    })
  })

  it('reads the grid back as posts, reels told apart', async () => {
    const { run, calls } = withCookie({
      posts: () => [
        {
          id: '1_31000000001',
          code: 'AbC',
          created: 1794063682,
          text: 'Villa',
          kind: 'clips',
          likes: 3,
          comments: 0,
        },
        {
          id: '2_31000000001',
          code: 'DeF',
          created: 1794000000,
          text: null,
          kind: 'feed',
          image: 'https://i',
        },
      ],
    })
    const posts = await instagramApi.list(
      run,
      {
        id: 'a',
        platform: 'instagram',
        externalId: '31000000001',
        name: 'Acme',
        handle: '',
        platformIds: { username: 'acme_studio' },
      },
      {},
    )
    expect(calls[0]).toEqual({ op: 'posts', args: { username: 'acme_studio', count: 24 } })
    expect(posts.map((p) => [p.placement, p.url, p.stats])).toEqual([
      ['reel', 'https://www.instagram.com/reel/AbC/', { likes: 3, comments: 0 }],
      ['feed', 'https://www.instagram.com/p/DeF/', null],
    ])
  })

  it('still connects the account by its id when the read fails, so the sign-in is kept', async () => {
    const { run, warnings } = withCookie({
      profile: () => {
        throw new Error('drift')
      },
    })
    const [a] = await instagramApi.discover(run)
    expect(a).toMatchObject({ externalId: '31000000001', name: 'Instagram account' })
    expect(warnings).toHaveLength(1)
  })
})

describe('Instagram sounds and reels (the Instagram app’s requests)', () => {
  const account: DriverAccount = {
    id: 'a',
    platform: 'instagram',
    externalId: '31000000001',
    name: 'Acme Studio',
    handle: '@acme_studio',
    platformIds: { userId: '31000000001', username: 'acme_studio' },
  }
  const signed = (oe: string) => `https://instagram.fbri1-1.fna.fbcdn.net/o1/v/t2/a.mp4?oe=${oe}&oh=00_x`
  const music = {
    trackId: '28740766638859492-2130199641208387',
    title: 'Gentle Resolve',
    artist: 'Fellow Travelers',
    coverUrl: 'https://instagram.fbri1-1.fna.fbcdn.net/c.jpg',
    previewUrl: signed('7FFFFFFF'),
    startAt: 12.5,
    duration: 64.563,
  }
  let dir = ''
  let video = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gl-ig-'))
    video = join(dir, 'reel.mp4')
    await writeFile(video, Buffer.alloc(4321))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  const request = (over: Partial<PublishRequest> = {}): PublishRequest => ({
    accountId: 'a',
    placement: 'reel',
    files: [{ path: video, mime: 'video/mp4', kind: 'video' }],
    thumbnailPath: null,
    title: '',
    caption: 'Trullo a Ostuni',
    tags: [],
    firstComment: '',
    location: null,
    translations: {},
    music,
    audio: { original: 0.3, music: 0.8 },
    options: { shareToFeed: true, allowComments: false },
    scheduleAt: null,
    timeZone: 'Europe/Rome',
    ...over,
  })

  function igRun(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
    const calls: { op: string; args: Record<string, unknown>; key?: string }[] = []
    const warnings: string[] = []
    const run = {
      locale: 'it-IT',
      dataDir: dir,
      warn: (m: string) => warnings.push(m),
      step: () => {},
      api: {
        site: 'gl-test',
        dryRun: false,
        planned: [],
        call: async (op: string, args: Record<string, unknown> = {}, opts?: { key?: string }) => {
          calls.push({ op, args, key: opts?.key })
          const a = answers[op]
          if (!a) throw new Error(`unexpected ${op}`)
          return a(args)
        },
        cookies: async () => [],
      },
    } as unknown as DriverRun
    return { run, calls, warnings }
  }
  const shared = {
    uploadReelVideo: () => ({ media_id: 1878668539804931, status: 'ok' }),
    configureReelWithSound: () => ({ status: 'ok', pk: '3757', code: 'DRe1', id: '3757_31000000001' }),
    configureReel: () => ({ status: 'ok', pk: '3758', code: 'DRe2', id: '3758_31000000001' }),
  }

  it('reads the app’s sound search as tracks, both ids in the track id; other items are left out', async () => {
    const { run, calls } = igRun({
      musicSearch: () => [
        null,
        {
          assetId: '28740766638859492',
          clusterId: '2130199641208387',
          title: 'Gentle Resolve',
          artist: 'Fellow Travelers',
          cover: 'https://instagram.fbri1-1.fna.fbcdn.net/c.jpg',
          preview: signed('6B08DE21'),
          durationMs: 64563,
        },
        { assetId: 'x', clusterId: '1' },
      ],
    })
    expect(await instagramApi.searchMusic(run, account, 'lofi', 'short')).toEqual([])
    const tracks = await instagramApi.searchMusic(run, account, ' lofi ', 'reel')
    expect(calls).toEqual([{ op: 'musicSearch', args: { query: 'lofi' }, key: undefined }])
    expect(tracks).toEqual([
      {
        trackId: '28740766638859492-2130199641208387',
        title: 'Gentle Resolve',
        artist: 'Fellow Travelers',
        coverUrl: 'https://instagram.fbri1-1.fna.fbcdn.net/c.jpg',
        previewUrl: signed('6B08DE21'),
        duration: 64.563,
        usage: null,
      },
    ])
    expect(
      igSoundToTrack({ assetId: '12345', clusterId: '67890', preview: 'https://evil.example/a.mp4' })
        ?.previewUrl,
    ).toBeNull()
  })

  it('encodes the sound’s volume as the app does, and tells a signed address that still works', () => {
    expect(volumeData(0.8)).toBe('Dc3MTD8=')
    expect(volumeData(1)).toBe('DQAAgD8=')
    expect(stillSigned(signed('7FFFFFFF'))).toBe(true)
    expect(stillSigned(signed('5F000000'))).toBe(false)
    expect(stillSigned('https://evil.example/a.mp4?oe=7FFFFFFF')).toBe(false)
  })

  it('mixes the sound in, uploads the file, then shares the reel with the sound and both volumes', async () => {
    mixes.length = 0
    const { run, calls } = igRun(shared)
    const out = await instagramApi.publish(run, account, request())
    expect(out).toEqual({
      remoteId: '3757_31000000001',
      url: 'https://www.instagram.com/reel/DRe1/',
      state: 'published',
    })
    // the mix: the sound's whole track from 12.5 s at 0.8, the video's own audio at 0.3
    const mix = mixes[0]!
    expect(mix[mix.indexOf('-ss') + 1]).toBe('12.5')
    expect(mix[mix.indexOf('-i', mix.indexOf('-ss')) + 1]).toBe(music.previewUrl)
    expect(mix[mix.indexOf('-filter_complex') + 1]).toContain('volume=0.8')
    expect(mix[mix.indexOf('-filter_complex') + 1]).toContain('[0:a]volume=0.3')
    const [up, share] = calls
    expect(up!.op).toBe('uploadReelVideo')
    expect(up!.args).toMatchObject({ size: '5', durationMs: 8500, width: 1080, height: 1920 })
    expect(up!.args.path).toBe(mix.at(-1))
    expect(String(up!.args.entityName)).toMatch(
      new RegExp(`^[0-9a-f]{32}-0-5-${up!.args.uploadId}-${up!.args.uploadId}$`),
    )
    expect(share!.op).toBe('configureReelWithSound')
    expect(share!.args).toMatchObject({
      uploadId: up!.args.uploadId,
      caption: 'Trullo a Ostuni',
      seconds: 8.5,
      durationMs: 8500,
      assetId: '28740766638859492',
      clusterId: '2130199641208387',
      startMs: 12500,
      trackMs: 64563,
      songName: 'Gentle Resolve',
      songVolume: 0.8,
      volumeData: 'Dc3MTD8=',
      originalVolume: 0.3,
      disableComments: '1',
      shareToFeed: '1',
    })
    // the mixed file is gone once it is sent
    expect(existsSync(mix.at(-1)!)).toBe(false)
  })

  it('finds the sound again when the address the post kept has expired', async () => {
    mixes.length = 0
    const fresh = signed('7FFFFFF0')
    const { run, calls } = igRun({
      ...shared,
      musicSearch: () => [
        {
          assetId: '28740766638859492',
          clusterId: '2130199641208387',
          preview: fresh,
          title: 'Gentle Resolve',
        },
      ],
    })
    await instagramApi.publish(run, account, request({ music: { ...music, previewUrl: signed('5F000000') } }))
    expect(calls[0]).toMatchObject({ op: 'musicSearch', args: { query: 'Gentle Resolve Fellow Travelers' } })
    expect(mixes[0]).toContain(fresh)
  })

  it('a reel without a sound keeps its own audio, at its volume', async () => {
    mixes.length = 0
    const { run, calls } = igRun(shared)
    const out = await instagramApi.publish(run, account, request({ music: null }))
    expect(out.url).toBe('https://www.instagram.com/reel/DRe2/')
    expect(mixes[0]).toContain('volume=0.3')
    expect(calls.map((c) => c.op)).toEqual(['uploadReelVideo', 'configureReel'])
    expect(calls[1]!.args).not.toHaveProperty('assetId')
  })

  it('shares again while Instagram processes the video; any other failure of Share is final', async () => {
    SHARE_RETRY.waitMs = 1
    try {
      let n = 0
      const { run, calls } = igRun({
        ...shared,
        configureReelWithSound: () =>
          ++n < 3
            ? { status: 'fail', message: 'Transcode not finished yet.' }
            : shared.configureReelWithSound(),
      })
      expect((await instagramApi.publish(run, account, request())).remoteId).toBe('3757_31000000001')
      expect(
        calls.filter((c) => c.op === 'configureReelWithSound').map((c) => c.key?.split(':').at(-1)),
      ).toEqual(['0', '1', '2'])
    } finally {
      SHARE_RETRY.waitMs = 5000
    }
    const broken = igRun({
      ...shared,
      configureReelWithSound: () => {
        throw new Error('socket hang up')
      },
    })
    const err = await instagramApi.publish(broken.run, account, request()).catch((e) => e)
    expect(err.retriable).toBe(false)
    expect(err.message).toMatch(/may be there/)
  })

  it('finds a reel Instagram publishes in the background in the grid, by its caption', async () => {
    FIND_REEL.waitMs = 1
    try {
      let reads = 0
      const { run, calls } = igRun({
        ...shared,
        // what the test reel's Share answered (Nov 2026): ok, no reel
        configureReelWithSound: () => ({ status: 'ok' }),
        posts: () =>
          ++reads < 2
            ? []
            : [
                {
                  id: '4025220147794798582_31000000001',
                  code: 'Old',
                  kind: 'clips',
                  created: 1794063682,
                  text: 'Trullo a Ostuni',
                },
                {
                  id: '4036097084961735334_31000000001',
                  code: 'DRe9',
                  kind: 'clips',
                  created: Math.floor(Date.now() / 1000),
                  text: 'Trullo a Ostuni',
                },
              ],
      })
      const out = await instagramApi.publish(run, account, request())
      expect(out).toMatchObject({
        remoteId: '4036097084961735334_31000000001',
        url: 'https://www.instagram.com/reel/DRe9/',
      })
      expect(calls.filter((c) => c.op === 'posts')[0]!.args).toEqual({
        username: 'acme_studio',
        count: 12,
      })

      // kept to the Reels tab: not in the grid, so it keeps the upload's id and says so
      const hidden = igRun({ ...shared, configureReelWithSound: () => ({ status: 'ok' }) })
      const kept = await instagramApi.publish(
        hidden.run,
        account,
        request({ options: { shareToFeed: false } }),
      )
      expect(kept.remoteId).toMatch(/^upload:\d{13}$/)
      expect(kept.url).toBeNull()
      expect(hidden.calls.map((c) => c.op)).not.toContain('posts')
      expect(hidden.warnings.join(' ')).toMatch(/cannot link to it or delete it/)
    } finally {
      FIND_REEL.waitMs = 5000
    }
  })

  it('deletes a post by its id as the app does; one it has no id for is left to the app', async () => {
    const { run, calls } = igRun({ deleteMedia: () => ({ status: 'ok', deleted: true }) })
    await instagramApi.remove(run, account, '4036097084961735334_31000000001')
    expect(calls).toEqual([
      {
        op: 'deleteMedia',
        args: { mediaId: '4036097084961735334_31000000001' },
        key: 'ig-delete-4036097084961735334_31000000001',
      },
    ])
    await expect(instagramApi.remove(run, account, 'upload:1795360286914')).rejects.toThrow(
      /in the Instagram app/,
    )
    await expect(instagramApi.remove(run, account, '4036097084961735334_999')).rejects.toThrow(
      /another Instagram account/,
    )
    const refused = igRun({ deleteMedia: () => ({ status: 'fail', message: 'Media not found' }) })
    await expect(
      instagramApi.remove(refused.run, account, '4036097084961735334_31000000001'),
    ).rejects.toThrow(/Media not found/)
  })

  it('refuses a schedule, a second file and a sound that is not Instagram’s, sending nothing', async () => {
    const { run, calls } = igRun(shared)
    await expect(
      instagramApi.publish(run, account, request({ scheduleAt: new Date(Date.now() + 3600_000) })),
    ).rejects.toThrow(/go out now/)
    await expect(
      instagramApi.publish(run, account, request({ files: [...request().files, ...request().files] })),
    ).rejects.toThrow(/one video/)
    await expect(
      instagramApi.publish(run, account, request({ music: { ...music, trackId: 'n61ULEU7CO0' } })),
    ).rejects.toThrow(/not one of Instagram/)
    await expect(instagramApi.publish(run, account, request({ placement: 'video' }))).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

describe('Instagram feed posts and stories (the Instagram app’s requests)', () => {
  const account: DriverAccount = {
    id: 'a',
    platform: 'instagram',
    externalId: '31000000001',
    name: 'Acme Studio',
    handle: '@acme_studio',
    platformIds: { userId: '31000000001', username: 'acme_studio' },
  }
  let dir = ''
  let picture = ''
  let video = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gl-igf-'))
    picture = join(dir, 'feed.jpg')
    video = join(dir, 'clip.mp4')
    await writeFile(picture, Buffer.alloc(300))
    await writeFile(video, Buffer.alloc(900))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  const request = (over: Partial<PublishRequest> = {}): PublishRequest => ({
    accountId: 'a',
    placement: 'feed',
    files: [{ path: picture, mime: 'image/jpeg', kind: 'image' }],
    thumbnailPath: null,
    title: '',
    caption: 'Trullo a Ostuni',
    tags: [],
    firstComment: '',
    location: null,
    translations: {},
    music: null,
    audio: { original: 1, music: 1 },
    options: {},
    scheduleAt: null,
    timeZone: 'Europe/Rome',
    ...over,
  })
  function igRun(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
    const calls: { op: string; args: Record<string, unknown>; key?: string }[] = []
    const warnings: string[] = []
    const run = {
      locale: 'it-IT',
      dataDir: dir,
      warn: (m: string) => warnings.push(m),
      step: () => {},
      api: {
        site: 'gl-test',
        dryRun: false,
        planned: [],
        call: async (op: string, args: Record<string, unknown> = {}, opts?: { key?: string }) => {
          calls.push({ op, args, key: opts?.key })
          const a = answers[op]
          if (!a) throw new Error(`unexpected ${op}`)
          return a(args)
        },
        cookies: async () => [],
      },
    } as unknown as DriverRun
    return { run, calls, warnings }
  }
  const ok = () => ({ status: 'ok' })
  const shared = {
    uploadPhoto: ok,
    uploadVideo: ok,
    configurePhoto: () => ({ status: 'ok', pk: '4040', code: 'DPh1' }),
    configureSidecar: () => ({ status: 'ok', id: '4041_31000000001', code: 'DCa1' }),
    configureStoryPhoto: ok,
    configureStoryPhotoWithSound: ok,
    configureStoryVideo: ok,
  }

  it('posts one picture: uploaded, then shared with its size, the caption and the AI label when asked', async () => {
    const { run, calls } = igRun(shared)
    const out = await instagramApi.publish(run, account, request({ options: { aiGenerated: true } }))
    expect(out).toEqual({
      remoteId: '4040_31000000001',
      url: 'https://www.instagram.com/p/DPh1/',
      state: 'published',
    })
    const [up, share] = calls
    expect(up).toMatchObject({
      op: 'uploadPhoto',
      args: {
        mediaType: '1',
        shareType: 'feed',
        sidecar: '',
        cover: '',
        width: 1080,
        height: 1920,
        size: '300',
      },
    })
    expect(up!.args.sessionId).toBe(up!.args.uploadId)
    expect(String(up!.args.entityName)).toMatch(new RegExp(`^${up!.args.uploadId}_0_\\d+$`))
    expect(share).toMatchObject({
      op: 'configurePhoto',
      args: {
        uploadId: up!.args.uploadId,
        caption: 'Trullo a Ostuni',
        widthText: '1080',
        aiLabel: 'SELF_DISCLOSURE_FLOW',
      },
    })
    // no AI label asked: the field is left out (an empty value)
    const plain = igRun(shared)
    await instagramApi.publish(plain.run, account, request())
    expect(plain.calls[1]!.args.aiLabel).toBe('')
  })

  it('refuses a carousel before anything is uploaded: its Share ends the sign-in’s session', async () => {
    const { run, calls } = igRun(shared)
    const carousel = request({
      files: [
        { path: picture, mime: 'image/jpeg', kind: 'image' },
        { path: video, mime: 'video/mp4', kind: 'video' },
      ],
    })
    const refused = instagramApi.publish(run, account, carousel)
    await expect(refused).rejects.toThrow(APP_ONLY_WRITES.configureSidecar)
    await expect(refused).rejects.toMatchObject({ name: 'ConnectorUnsupported', retriable: false })
    // a dry run says the same
    const dry = igRun(shared)
    ;(dry.run.api as { dryRun: boolean }).dryRun = true
    await expect(instagramApi.publish(dry.run, account, carousel)).rejects.toThrow(
      /share the carousel in the Instagram app/,
    )
    expect([...calls, ...dry.calls]).toEqual([])
  })

  it('builds a carousel as the app does (not sent): every item uploaded into it (a video with its first frame as cover), then shared in order', async () => {
    mixes.length = 0
    const { run, calls } = igRun(shared)
    const out = await publishCarousel(
      run,
      account,
      request({
        files: [
          { path: picture, mime: 'image/jpeg', kind: 'image' },
          { path: video, mime: 'video/mp4', kind: 'video' },
        ],
      }),
    )
    expect(out.url).toBe('https://www.instagram.com/p/DCa1/')
    expect(calls.map((c) => c.op)).toEqual(['uploadPhoto', 'uploadVideo', 'uploadPhoto', 'configureSidecar'])
    const [pic, vid, cover, share] = calls
    const sidecarId = share!.args.sidecarId
    for (const c of [pic, vid, cover]) expect(c!.args.sessionId).toBe(sidecarId)
    expect(pic!.args).toMatchObject({ sidecar: '1', mediaType: '1', shareType: 'feed' })
    expect(vid!.args).toMatchObject({
      sidecar: '1',
      forAlbum: '',
      extractCover: '',
      durationMsText: '8500',
      shareType: 'feed',
    })
    expect(cover!.args).toMatchObject({
      uploadId: vid!.args.uploadId,
      mediaType: '2',
      cover: 'first_frame',
      sidecar: '1',
    })
    // the cover is the video's first frame, made with ffmpeg, and removed afterwards
    expect(mixes[0]).toEqual(expect.arrayContaining(['-frames:v', '1']))
    expect(existsSync(String(cover!.args.path))).toBe(false)
    expect(share!.args.children).toEqual([
      carouselChild({ uploadId: String(pic!.args.uploadId), width: 1080, height: 1920 }),
      carouselChild({ uploadId: String(vid!.args.uploadId), width: 1080, height: 1920, length: 8.5 }),
    ])
    expect((share!.args.children as Record<string, string>[])[1]).toMatchObject({
      length: '8.5',
      audio_muted: 'false',
    })
    // upload ids grow, as the app makes them
    const idsInOrder = [sidecarId, pic!.args.uploadId, vid!.args.uploadId].map(Number)
    expect([...idsInOrder].sort((x, y) => x - y)).toEqual(idsInOrder)
  })

  it('a single video in the feed goes up as a reel shown in the grid', async () => {
    const { run, calls } = igRun({
      uploadReelVideo: ok,
      configureReel: () => ({ status: 'ok', id: '4042_31000000001', code: 'DRe5' }),
    })
    const out = await instagramApi.publish(
      run,
      account,
      request({
        files: [{ path: video, mime: 'video/mp4', kind: 'video' }],
        options: { shareToFeed: false },
      }),
    )
    expect(out.url).toBe('https://www.instagram.com/reel/DRe5/')
    expect(calls[1]!.args).toMatchObject({ shareToFeed: '1' })
  })

  it('shares a picture story and a video story; a story without an id links to the account’s stories', async () => {
    const pic = igRun(shared)
    const out = await instagramApi.publish(pic.run, account, request({ placement: 'story', caption: '' }))
    expect(pic.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'configureStoryPhoto'])
    expect(pic.calls[0]!.args).toMatchObject({ shareType: 'stories', sidecar: '' })
    expect(pic.calls[1]!.args.nowSec).toMatch(/^\d{10}$/)
    expect(out.remoteId).toMatch(/^upload:\d{13}$/)
    expect(out.url).toBe('https://www.instagram.com/stories/acme_studio/')
    const vid = igRun(shared)
    await instagramApi.publish(
      vid.run,
      account,
      request({ placement: 'story', files: [{ path: video, mime: 'video/mp4', kind: 'video' }] }),
    )
    expect(vid.calls.map((c) => c.op)).toEqual(['uploadVideo', 'configureStoryVideo'])
    expect(vid.calls[0]!.args).toMatchObject({
      shareType: 'stories',
      forAlbum: '1',
      extractCover: '1',
      sidecar: '',
    })
    expect(vid.calls[1]!.args).toMatchObject({ seconds: 8.5, widthText: '1080' })
    // a story has no caption on Instagram: said, not sent
    expect(vid.warnings.join(' ')).toMatch(/no caption/)
  })

  it('makes a picture with a sound into a reel, as the app does', async () => {
    const song = {
      trackId: '28740766638859492-2130199641208387',
      title: 'Gentle Resolve',
      artist: 'Fellow Travelers',
      coverUrl: null,
      previewUrl: 'https://scontent.cdninstagram.com/a.m4a?oe=ffffffff&oh=x',
      startAt: 3,
      duration: 12,
    }
    mixes.length = 0
    const { run, calls } = igRun({
      uploadReelVideo: ok,
      configureReelWithSound: () => ({ status: 'ok', id: '4043_31000000001', code: 'DSt1' }),
    })
    const out = await instagramApi.publish(run, account, request({ music: song }))
    // the picture became a 10 s video first, then went out as a reel with the sound
    const still = mixes.find((a) => a.includes('anullsrc=channel_layout=stereo:sample_rate=44100'))!
    expect(still[still.indexOf('-t') + 1]).toBe('10')
    expect(calls.map((c) => c.op)).toEqual(['uploadReelVideo', 'configureReelWithSound'])
    expect(out.url).toBe('https://www.instagram.com/reel/DSt1/')
    // the post can ask for another length; a picture alone stays a picture
    mixes.length = 0
    const b = igRun({
      uploadReelVideo: ok,
      configureReelWithSound: () => ({ status: 'ok', id: '4043_31000000001', code: 'DSt2' }),
    })
    await instagramApi.publish(b.run, account, request({ music: song, options: { stillSeconds: 15 } }))
    const second = mixes.find((a) => a.includes('anullsrc=channel_layout=stereo:sample_rate=44100'))!
    expect(second[second.indexOf('-t') + 1]).toBe('15')
    const c = igRun(shared)
    await instagramApi.publish(c.run, account, request())
    expect(c.calls.map((x) => x.op)).toEqual(['uploadPhoto', 'configurePhoto'])
  })

  it('shares a picture story with a sound through the music sticker, the manifest from the search; without one it goes up silent and says so', async () => {
    const song = {
      trackId: '28740766638859492-2130199641208387',
      title: 'Gentle Resolve',
      artist: 'Fellow Travelers',
      coverUrl: null,
      previewUrl: null,
      startAt: 1.5,
      duration: null,
    }
    const found = (extra: Record<string, unknown>) => [
      {
        assetId: '28740766638859492',
        clusterId: '2130199641208387',
        title: 'Gentle Resolve',
        artist: 'Fellow Travelers',
        preview: 'https://instagram.fbri1-1.fna.fbcdn.net/o1/v/t2/a.mp4?oe=6B08DE21&oh=00_x',
        durationMs: 64563,
        ...extra,
      },
    ]
    const pic = igRun({ ...shared, musicSearch: () => found({ dashManifest: '<MPD>m</MPD>' }) })
    await instagramApi.publish(pic.run, account, request({ placement: 'story', caption: '', music: song }))
    // one search gives the sound's manifest, audio, cover and length
    expect(pic.calls.map((c) => c.op)).toEqual(['musicSearch', 'uploadPhoto', 'configureStoryPhotoWithSound'])
    expect(pic.calls[1]!.args).toMatchObject({
      shareType: 'stories',
      photoToVideoMs: '20000',
      musicBurnin: '{"asset_fbid":"28740766638859492","offset_ms":1500}',
      stickerBurnin: '[]',
      forAlbum: '1',
    })
    expect(pic.calls[2]!.args).toMatchObject({
      audioUrl: 'https://instagram.fbri1-1.fna.fbcdn.net/o1/v/t2/a.mp4?oe=6B08DE21&oh=00_x',
      assetId: '28740766638859492',
      clusterId: '2130199641208387',
      startMs: 1500,
      lengthMs: 20000,
      trackMs: 64563,
      dashManifest: '<MPD>m</MPD>',
      title: 'Gentle Resolve',
    })
    const bare = igRun({ ...shared, musicSearch: () => found({}) })
    await instagramApi.publish(bare.run, account, request({ placement: 'story', caption: '', music: song }))
    expect(bare.calls.map((c) => c.op).at(-1)).toBe('configureStoryPhoto')
    expect(bare.calls.find((c) => c.op === 'uploadPhoto')!.args).toMatchObject({
      photoToVideoMs: '',
      musicBurnin: '',
    })
    expect(bare.warnings.join(' ')).toMatch(/without the sound/)
    // a video story takes the sound the same way: burned in at upload, the video's own sound muted
    const vid = igRun({
      ...shared,
      configureStoryVideoWithSound: ok,
      musicSearch: () => found({ dashManifest: '<MPD>m</MPD>' }),
    })
    await instagramApi.publish(
      vid.run,
      account,
      request({
        placement: 'story',
        caption: '',
        music: song,
        files: [{ path: video, mime: 'video/mp4', kind: 'video' }],
      }),
    )
    expect(vid.calls.map((c) => c.op)).toEqual(['musicSearch', 'uploadVideo', 'configureStoryVideoWithSound'])
    expect(vid.calls[1]!.args).toMatchObject({
      shareType: 'stories',
      musicBurnin: '{"asset_fbid":"28740766638859492","offset_ms":1500}',
    })
    // the mocked probe says the video is 8.5 s long: the sound plays as long as the video
    expect(vid.calls[2]!.args).toMatchObject({ lengthMs: 8500, seconds: 8.5, dashManifest: '<MPD>m</MPD>' })
    expect(vid.warnings.join(' ')).toMatch(/video’s own sound is muted/)
  })

  it('turns comments off on a feed picture and a carousel when the post asks; on otherwise', async () => {
    const off = igRun(shared)
    await instagramApi.publish(off.run, account, request({ options: { allowComments: false } }))
    expect(off.calls[1]!.args).toMatchObject({ disableComments: '1' })
    const on = igRun(shared)
    await instagramApi.publish(on.run, account, request())
    expect(on.calls[1]!.args).toMatchObject({ disableComments: '0' })
    const car = igRun(shared)
    await publishCarousel(
      car.run,
      account,
      request({ files: [...request().files, ...request().files], options: { allowComments: false } }),
    )
    expect(car.calls.at(-1)!.args).toMatchObject({ disableComments: '1' })
    const story = igRun(shared)
    await instagramApi.publish(
      story.run,
      account,
      request({ placement: 'story', options: { allowComments: false } }),
    )
    expect(story.warnings.join(' ')).toMatch(/no comments switch/)
  })

  it('tags a feed picture with the place Instagram finds for the name; none found goes up without', async () => {
    const places = [
      {
        placeId: '1113854232593245',
        name: 'Ostuni - La Città Bianca',
        subtitle: '0.2mi',
        lat: 40.7329,
        lng: 17.5787,
      },
      { placeId: '529415319299814', name: 'Ostuni', subtitle: '0.9mi', lat: 40.7212, lng: 17.5857 },
    ]
    const exact = igRun({ ...shared, placeSearch: () => places })
    await instagramApi.publish(
      exact.run,
      account,
      request({ location: { name: 'ostuni', platformId: null } }),
    )
    expect(exact.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'placeSearch', 'configurePhoto'])
    expect(exact.calls[1]!.args).toEqual({ query: 'ostuni' })
    expect(JSON.parse(String(exact.calls[2]!.args.location))).toEqual({
      name: 'Ostuni',
      address: '0.9mi',
      lat: 40.7212,
      lng: 17.5857,
      external_source: 'meta_place',
      meta_place_id: '529415319299814',
    })
    const byId = igRun({ ...shared, placeSearch: () => places })
    await instagramApi.publish(
      byId.run,
      account,
      request({ location: { name: 'Ostuni', platformId: '1113854232593245' } }),
    )
    expect(JSON.parse(String(byId.calls[2]!.args.location)).meta_place_id).toBe('1113854232593245')
    const failed = igRun({
      ...shared,
      placeSearch: () => {
        throw new Error('HTTP 500')
      },
    })
    const kept = await instagramApi.publish(
      failed.run,
      account,
      request({ location: { name: 'Ostuni', platformId: null } }),
    )
    expect(kept.state).toBe('published')
    expect(failed.calls.at(-1)!.args.location).toBe('')
    expect(failed.warnings.join(' ')).toMatch(/place search failed/)
    const none = igRun({ ...shared, placeSearch: () => [] })
    await instagramApi.publish(
      none.run,
      account,
      request({ location: { name: 'Nowhere', platformId: null } }),
    )
    expect(none.calls[2]!.args.location).toBe('')
    expect(none.warnings.join(' ')).toMatch(/no place called Nowhere/)
    const plain = igRun(shared)
    await instagramApi.publish(plain.run, account, request())
    expect(plain.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'configurePhoto'])
    // a reel takes the place in its Share too
    const reel = igRun({
      uploadReelVideo: ok,
      placeSearch: () => places,
      configureReel: () => ({ status: 'ok', id: '4042_31000000001', code: 'DRe5' }),
    })
    await instagramApi.publish(
      reel.run,
      account,
      request({
        files: [{ path: video, mime: 'video/mp4', kind: 'video' }],
        location: { name: 'Ostuni', platformId: null },
      }),
    )
    const reelShare = reel.calls.find((c) => c.op === 'configureReel')!
    expect(JSON.parse(String(reelShare.args.location)).meta_place_id).toBe('529415319299814')
  })

  it('puts a story’s place on it as the app’s location sticker, drawn on the picture', async () => {
    const sharp = (await import('sharp')).default
    const real = join(dir, 'real-story.jpg')
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#203040' } })
      .jpeg()
      .toFile(real)
    const places = [{ placeId: '529415319299814', name: 'Ostuni', subtitle: '0.9mi', lat: 40.72, lng: 17.58 }]
    const st = igRun({ ...shared, placeSearch: () => places })
    await instagramApi.publish(
      st.run,
      account,
      request({
        placement: 'story',
        caption: '',
        files: [{ path: real, mime: 'image/jpeg', kind: 'image' }],
        location: { name: 'Ostuni', platformId: null },
      }),
    )
    expect(st.calls.map((c) => c.op)).toEqual(['placeSearch', 'uploadPhoto', 'configureStoryPhoto'])
    // the picture sent is a drawn copy (removed once sent), not the post's own file
    const sent = String(st.calls[1]!.args.path)
    expect(sent).not.toBe(real)
    expect(existsSync(sent)).toBe(false)
    const share = st.calls[2]!.args
    expect(share.stickerIds).toBe('location_sticker')
    const tap = JSON.parse(String(share.tapModels))[0]
    expect(tap).toMatchObject({
      type: 'location',
      meta_place_id: '529415319299814',
      x: 0.5,
      y: 0.5,
      is_sticker: true,
    })
    expect(tap.width).toBeGreaterThan(0.05)
    expect(tap.width).toBeLessThan(0.9)
    expect(st.warnings).toEqual([])
    // with a sound, the location is left out and said
    const both = igRun({
      ...shared,
      configureStoryPhotoWithSound: ok,
      musicSearch: () => [
        {
          assetId: '28740766638859492',
          clusterId: '2130199641208387',
          title: 'Gentle Resolve',
          artist: 'Fellow Travelers',
          preview: 'https://instagram.fbri1-1.fna.fbcdn.net/o1/v/t2/a.mp4?oe=6B08DE21&oh=00_x',
          durationMs: 64563,
          dashManifest: '<MPD>m</MPD>',
        },
      ],
    })
    await instagramApi.publish(
      both.run,
      account,
      request({
        placement: 'story',
        caption: '',
        files: [{ path: real, mime: 'image/jpeg', kind: 'image' }],
        location: { name: 'Ostuni', platformId: null },
        music: {
          trackId: '28740766638859492-2130199641208387',
          title: 'Gentle Resolve',
          artist: 'Fellow Travelers',
          coverUrl: null,
          previewUrl: null,
          startAt: 0,
          duration: null,
        },
      }),
    )
    expect(both.calls.map((c) => c.op)).not.toContain('placeSearch')
    expect(both.warnings.join(' ')).toMatch(/takes no location sticker here/)
  })

  it('posts the first comment on the new post; a failure leaves the post up and says so', async () => {
    const ok2 = igRun({ ...shared, postComment: () => ({ status: 'ok' }) })
    const out = await instagramApi.publish(ok2.run, account, request({ firstComment: ' Scrivi per info ' }))
    expect(ok2.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'configurePhoto', 'postComment'])
    expect(ok2.calls[2]!.args).toMatchObject({
      mediaId: '4040_31000000001',
      numericId: '4040',
      text: 'Scrivi per info',
    })
    expect(String(ok2.calls[2]!.args.token)).toMatch(/^[0-9a-f-]{36}$/)
    expect(out.state).toBe('published')
    const bad = igRun({ ...shared, postComment: () => ({ status: 'fail', message: 'Try again later' }) })
    const out2 = await instagramApi.publish(bad.run, account, request({ firstComment: 'Ciao' }))
    expect(out2.state).toBe('published')
    expect(bad.warnings.join(' ')).toMatch(/first comment was not posted: Try again later/)
    const none = igRun(shared)
    await instagramApi.publish(none.run, account, request())
    expect(none.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'configurePhoto'])
    const story = igRun(shared)
    await instagramApi.publish(story.run, account, request({ placement: 'story', firstComment: 'Ciao' }))
    expect(story.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'configureStoryPhoto'])
    expect(story.warnings.join(' ')).toMatch(/A story has no comments/)
  })

  it('pins the first comment when the post asks; a refusal leaves the comment up and says so', async () => {
    const pin = igRun({
      ...shared,
      postComment: () => ({ status: 'ok', id: '18137299927790260' }),
      pinComment: () => ({ status: 'ok' }),
    })
    await instagramApi.publish(
      pin.run,
      account,
      request({ firstComment: 'Ciao', options: { pinFirstComment: true } }),
    )
    expect(pin.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'configurePhoto', 'postComment', 'pinComment'])
    expect(pin.calls[3]!.args).toEqual({ mediaId: '4040_31000000001', commentId: '18137299927790260' })
    const noPin = igRun({ ...shared, postComment: () => ({ status: 'ok', id: '18137299927790260' }) })
    await instagramApi.publish(noPin.run, account, request({ firstComment: 'Ciao' }))
    expect(noPin.calls.map((c) => c.op)).toEqual(['uploadPhoto', 'configurePhoto', 'postComment'])
    const refused = igRun({
      ...shared,
      postComment: () => ({ status: 'ok', id: '18137299927790260' }),
      pinComment: () => ({ status: 'fail', message: 'Pinned comments are limited' }),
    })
    await instagramApi.publish(
      refused.run,
      account,
      request({ firstComment: 'Ciao', options: { pinFirstComment: true } }),
    )
    expect(refused.warnings.join(' ')).toMatch(/up but not pinned: Pinned comments are limited/)
    const unnamed = igRun({ ...shared, postComment: () => ({ status: 'ok' }) })
    await instagramApi.publish(
      unnamed.run,
      account,
      request({ firstComment: 'Ciao', options: { pinFirstComment: true } }),
    )
    expect(unnamed.calls.map((c) => c.op)).not.toContain('pinComment')
    expect(unnamed.warnings.join(' ')).toMatch(/did not name the comment/)
    const nothing = igRun(shared)
    await instagramApi.publish(nothing.run, account, request({ options: { pinFirstComment: true } }))
    expect(nothing.warnings.join(' ')).toMatch(/no first comment to pin/)
  })

  it('sets a reel’s cover frame and AI label as the app does; a picture cover is left out and said', async () => {
    const answers = {
      uploadReelVideo: ok,
      configureReel: () => ({ status: 'ok', id: '4042_31000000001', code: 'DRe5' }),
    }
    const reel = (extra: Partial<PublishRequest>) =>
      request({ files: [{ path: video, mime: 'video/mp4', kind: 'video' }], ...extra })
    const framed = igRun(answers)
    await instagramApi.publish(
      framed.run,
      account,
      reel({ thumbnailPath: '/tmp/cover.jpg', thumbnailAt: 6.657, options: { aiGenerated: true } }),
    )
    // the mocked probe says the video is 8.5 s long
    expect(framed.calls[1]!.args).toMatchObject({
      coverMs: '6657',
      posterIndex: 78,
      aiLabel: 'SELF_DISCLOSURE_FLOW',
    })
    expect(framed.warnings.join(' ')).not.toMatch(/cover/)
    expect(framed.warnings.join(' ')).not.toMatch(/AI label/)
    const plain = igRun(answers)
    await instagramApi.publish(plain.run, account, reel({}))
    expect(plain.calls[1]!.args).toMatchObject({ aiLabel: '' })
    expect(plain.calls[1]!.args).not.toHaveProperty('coverMs')
    const picture = igRun(answers)
    await instagramApi.publish(
      picture.run,
      account,
      reel({ thumbnailPath: '/tmp/cover.jpg', thumbnailAt: null }),
    )
    expect(picture.warnings.join(' ')).toMatch(/a picture of your own is not set/)
  })

  describe('a published post’s caption, as instagram.com’s own Edit changes it', () => {
    const mediaId = '4040123456789012345_31000000001'
    const items = ['4040123456789000001_31000000001', '4040123456789000002_31000000001']
    const carousel = {
      id: mediaId,
      code: 'DCa1xyz',
      text: 'Vecchio testo',
      kind: 'carousel_container',
      mediaType: 8,
      items,
      aiMethod: 'NONE',
    }
    const grid = (...posts: object[]) => ({
      posts: () => [{ id: '4040000000000000009_31000000001', code: 'DOther1', text: 'x' }, ...posts],
      editMediaWeb: () => ({ status: 'ok' }),
      editMedia: () => ({ status: 'ok' }),
    })

    it('a carousel: read from the grid, then the web Edit with its code, the caption and each item untouched', async () => {
      const ed = igRun(grid(carousel))
      await instagramApi.update(ed.run, account, mediaId, { caption: 'Nuovo testo', options: {} })
      expect(ed.calls.map((c) => c.op)).toEqual(['posts', 'editMediaWeb'])
      expect(ed.calls[0]!.args).toEqual({ username: 'acme_studio', count: 50 })
      const sent = ed.calls[1]!
      expect(sent.args).toMatchObject({ pk: '4040123456789012345', code: 'DCa1xyz', caption: 'Nuovo testo' })
      expect(JSON.parse(String(sent.args.childrenUsertags))).toEqual({
        [items[0]!]: '{"added":[],"in":[],"removed":[]}',
        [items[1]!]: '{"added":[],"in":[],"removed":[]}',
      })
      // the same caption twice is two edits (A, B, then A again must go out), each with its own key
      const again = igRun(grid(carousel))
      await instagramApi.update(again.run, account, mediaId, { caption: 'Nuovo testo' })
      expect(again.calls[1]!.key).not.toBe(sent.key)
      expect(instagramApi.capabilities('instagram').editAfterPublish).toBe(true)
    })

    it('never sends the app’s Edit, and nothing when Instagram already shows the caption', async () => {
      const same = igRun(grid({ ...carousel, text: 'Nuovo  testo\n' }))
      await instagramApi.update(same.run, account, mediaId, { caption: 'Nuovo testo' })
      expect(same.calls.map((c) => c.op)).toEqual(['posts'])
      const ed = igRun(grid(carousel))
      await instagramApi.update(ed.run, account, mediaId, { caption: 'Nuovo testo' })
      expect(ed.calls.map((c) => c.op)).not.toContain('editMedia')
    })

    it('refuses, with the reason and no edit sent, what instagram.com’s Edit was not recorded on', async () => {
      const cases: [object, RegExp][] = [
        [{ ...carousel, items: undefined, kind: 'feed', mediaType: 1 }, /a single picture or a reel/],
        [{ ...carousel, items: undefined, kind: 'clips', mediaType: 2 }, /a single picture or a reel/],
        [{ ...carousel, place: 238580062 }, /a post with a place/],
        [{ ...carousel, aiMethod: 'SELF_DISCLOSURE_FLOW' }, /a post with an AI label/],
      ]
      for (const [post, why] of cases) {
        const ed = igRun(grid(post))
        const refused = instagramApi.update(ed.run, account, mediaId, { caption: 'Nuovo testo' })
        await expect(refused).rejects.toThrow(why)
        await expect(refused).rejects.toMatchObject({ name: 'ConnectorUnsupported', retriable: false })
        expect(ed.calls.map((c) => c.op)).toEqual(['posts'])
      }
      // not among the latest 50: not edited
      const gone = igRun(grid())
      await expect(instagramApi.update(gone.run, account, mediaId, { caption: 'x' })).rejects.toThrow(
        /latest 50/,
      )
      // another account's post, an unnamed one, and no caption: nothing read or sent
      const none = igRun(grid(carousel))
      await expect(
        instagramApi.update(none.run, account, '4040123456789012345_31000000002', { caption: 'x' }),
      ).rejects.toThrow(/another Instagram account/)
      await expect(
        instagramApi.update(none.run, account, 'upload:1795373844416', { caption: 'x' }),
      ).rejects.toThrow(/did not name it/)
      await expect(instagramApi.update(none.run, account, mediaId, { title: 'x' })).rejects.toThrow(/caption/)
      expect(none.calls).toEqual([])
    })

    it('says so when Instagram does not take the edit', async () => {
      const ed = igRun({
        ...grid(carousel),
        editMediaWeb: () => ({ status: 'fail', message: 'Try again later' }),
      })
      await expect(instagramApi.update(ed.run, account, mediaId, { caption: 'Nuovo testo' })).rejects.toThrow(
        /did not change the caption: Try again later/,
      )
    })
  })

  it('builds the app’s Edit (not sent): the caption, keeping its AI label; stories and unnamed posts are refused', async () => {
    const mediaId = '4040123456789012345_31000000001'
    const ed = igRun({ editMedia: () => ({ status: 'ok' }) })
    await editPost(ed.run, mediaId, { caption: 'Nuovo testo', options: {} })
    expect(ed.calls[0]).toMatchObject({
      op: 'editMedia',
      args: { mediaId, caption: 'Nuovo testo', aiMethod: 'NONE' },
    })
    const ai = igRun({ editMedia: () => ({ status: 'ok' }) })
    await editPost(ai.run, mediaId, {
      caption: 'Nuovo testo',
      options: { aiGenerated: true },
    })
    expect(ai.calls[0]!.args).toMatchObject({ aiMethod: 'SELF_DISCLOSURE_FLOW' })
    const refused = igRun({ editMedia: () => ({ status: 'fail', message: 'Try again later' }) })
    await expect(editPost(refused.run, mediaId, { caption: 'x' })).rejects.toThrow(/Try again later/)
    await expect(editPost(ed.run, 'upload:1795373844416', { caption: 'x' })).rejects.toThrow(
      /did not name it/,
    )
    await expect(editPost(ed.run, mediaId, { title: 'x' })).rejects.toThrow(/caption, place and comments/)
    // the same caption twice is two edits (A, B, then A again must go out), each with its own key
    const twice = igRun({ editMedia: () => ({ status: 'ok' }) })
    await editPost(twice.run, mediaId, { caption: 'A' })
    await editPost(twice.run, mediaId, { caption: 'A' })
    expect(twice.calls[0]!.key).not.toBe(twice.calls[1]!.key)
  })

  it('builds the app’s Edit of a post’s place with its caption, and its comments switch (not sent)', async () => {
    const mediaId = '4040123456789012345_31000000001'
    const places = [{ placeId: '529415319299814', name: 'Ostuni', subtitle: '0.9mi', lat: 40.72, lng: 17.58 }]
    const ed = igRun({
      placeSearch: () => places,
      editMedia: () => ({ status: 'ok' }),
      disableComments: () => ({ status: 'ok' }),
      enableComments: () => ({ status: 'ok' }),
    })
    await editPost(ed.run, mediaId, {
      caption: 'Nuovo',
      location: { name: 'Ostuni', platformId: null },
      options: { allowComments: false },
    })
    expect(ed.calls.map((c) => c.op)).toEqual(['placeSearch', 'editMedia', 'disableComments'])
    expect(JSON.parse(String(ed.calls[1]!.args.location)).meta_place_id).toBe('529415319299814')
    expect(ed.calls[2]!.args).toEqual({ mediaId })
    const on = igRun({ editMedia: () => ({ status: 'ok' }), enableComments: () => ({ status: 'ok' }) })
    await editPost(on.run, mediaId, {
      caption: 'Nuovo',
      options: { allowComments: true },
    })
    expect(on.calls.map((c) => c.op)).toEqual(['editMedia', 'enableComments'])
    expect(on.calls[0]!.args.location).toBe('')
    // no comments choice: no switch sent
    const plain = igRun({ editMedia: () => ({ status: 'ok' }) })
    await editPost(plain.run, mediaId, { caption: 'Nuovo', options: {} })
    expect(plain.calls.map((c) => c.op)).toEqual(['editMedia'])
  })

  it('says what feed posts leave out, and refuses what Instagram takes no part of', async () => {
    const { run, warnings, calls } = igRun(shared)
    await publishCarousel(
      run,
      account,
      request({
        files: [...request().files, ...request().files],
        music: {
          trackId: '1-2',
          title: 'Song',
          artist: '',
          coverUrl: null,
          previewUrl: null,
          startAt: 0,
          duration: null,
        },
      }),
    )
    expect(warnings.join(' ')).toMatch(/sounds go on reels/)
    calls.length = 0
    const eleven = Array.from({ length: 11 }, () => ({
      path: picture,
      mime: 'image/jpeg',
      kind: 'image' as const,
    }))
    await expect(publishCarousel(run, account, request({ files: eleven }))).rejects.toThrow(/at most 10/)
    await expect(instagramApi.publish(run, account, request({ files: eleven }))).rejects.toThrow(
      /share the carousel/,
    )
    await expect(
      instagramApi.publish(
        run,
        account,
        request({ placement: 'story', files: [...request().files, ...request().files] }),
      ),
    ).rejects.toThrow(/one picture or one video/)
    await expect(
      instagramApi.publish(run, account, request({ scheduleAt: new Date(Date.now() + 3600_000) })),
    ).rejects.toThrow(/go out now/)
    expect(calls).toEqual([])
  })
})

describe('TikTok sounds and posts', () => {
  const account: DriverAccount = {
    id: 't',
    platform: 'tiktok',
    externalId: '7698640934871843873',
    name: 'Acme Studio',
    handle: '@example',
    platformIds: { userId: '7698640934871843873' },
  }

  it('reads TikTok Studio’s sound search as tracks, with how many videos use each', async () => {
    const { run, calls } = fakeRun({
      musicSearch: () => [
        {
          trackId: '6799585653702019073',
          title: 'Lofi',
          author: 'Domknowz',
          cover: 'https://p77-sg.tiktokcdn.com/aweme/200x200/c.jpeg',
          preview: 'https://sf16-music.tiktokcdn-eu.com/obj/tos-alisg-ve-2774/a',
          duration: 60,
          usage: 1545180,
        },
        { trackId: 'x', title: 'bad' },
      ],
    })
    expect(await tiktokApi.searchMusic(run, account, 'lofi', 'short')).toEqual([])
    const tracks = await tiktokApi.searchMusic(run, account, ' lofi ', 'video')
    expect(calls).toEqual([{ op: 'musicSearch', args: { query: 'lofi' } }])
    expect(tracks).toEqual([
      {
        trackId: '6799585653702019073',
        title: 'Lofi',
        artist: 'Domknowz',
        coverUrl: 'https://p77-sg.tiktokcdn.com/aweme/200x200/c.jpeg',
        previewUrl: 'https://sf16-music.tiktokcdn-eu.com/obj/tos-alisg-ve-2774/a',
        duration: 60,
        usage: 1545180,
      },
    ])
    // a photo post searches the same library
    expect(await tiktokApi.searchMusic(run, account, 'lofi', 'photo')).toHaveLength(1)
    expect(ttSoundToTrack({ trackId: '12345', preview: 'https://evil.example/a.mp3' })?.previewUrl).toBeNull()
  })

  it('puts a photo post’s chosen cover first, the others in their order', () => {
    expect(coverFirst(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b'])
    expect(coverFirst(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c'])
    expect(coverFirst(['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c'])
    expect(coverFirst(['a', 'b'], 5)).toEqual(['a', 'b'])
  })

  it('posts in TikTok Studio itself, in the account’s own browser profile; videos and photos', async () => {
    const opened: string[] = []
    const f = fakeRun({})
    ;(f.run.api as unknown as { browser: (fn: unknown) => Promise<unknown> }).browser = async () => {
      opened.push('studio')
      return { remoteId: '7400000000000000001', url: null, state: 'published' }
    }
    const req = {
      accountId: 't',
      placement: 'video',
      files: [{ path: '/x.mp4', mime: 'video/mp4', kind: 'video' }],
      thumbnailPath: null,
      title: '',
      caption: 'Trullo',
      tags: [],
      firstComment: '',
      location: null,
      translations: {},
      music: null,
      audio: { original: 1, music: 1 },
      options: {},
      scheduleAt: null,
      timeZone: 'Europe/Rome',
    } as PublishRequest
    expect(await tiktokApi.publish(f.run, account, req)).toMatchObject({ remoteId: '7400000000000000001' })
    expect(opened).toEqual(['studio'])
    // a photo post goes to Studio too; a story is no TikTok placement
    await tiktokApi.publish(f.run, account, { ...req, placement: 'photo' })
    expect(opened).toEqual(['studio', 'studio'])
    await expect(tiktokApi.publish(f.run, account, { ...req, placement: 'story' })).rejects.toThrow(
      /videos and photos/,
    )
    expect(tiktokApi.capabilities('tiktok').placements).toEqual(['video', 'photo'])
    expect(f.calls).toEqual([])
  })

  it('sets the editor’s volumes in dB: 1 is 0 dB, half is -6 dB, 0 is the floor', () => {
    expect(volumeDb(1)).toBe(0)
    expect(volumeDb(0.5)).toBe(-6)
    expect(volumeDb(0.1)).toBe(-20)
    expect(volumeDb(0)).toBe(-60)
    expect(volumeDb(4)).toBe(12)
  })
})

describe('TikTok through API Anything', () => {
  it('connects the signed-in account from the passport answer', async () => {
    const { run } = fakeRun({
      account: () => ({ id: '7000', handle: 'acme', name: 'Acme', picture: 'https://p', secUid: 'MS4' }),
    })
    const [a] = await tiktokApi.discover(run)
    expect(a).toMatchObject({
      externalId: '7000',
      handle: '@acme',
      profileUrl: 'https://www.tiktok.com/@acme',
    })
  })

  it('falls back to the session’s user cookie when the read fails', async () => {
    const f = fakeRun({
      account: () => {
        throw new Error('drift')
      },
    })
    ;(f.run.api as unknown as { cookies: () => Promise<unknown[]> }).cookies = async () => [
      { name: 'uid_tt', value: 'abc', domain: '.tiktok.com' },
    ]
    const [a] = await tiktokApi.discover(f.run)
    expect(a).toMatchObject({ externalId: 'uid:abc', name: 'TikTok account' })
  })
})
