import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judge, localOnly, parseSite, plan, saveSite } from 'api-anything'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const dir = join(import.meta.dirname, 'sites')

/** The platform specs API Anything runs (one file per platform). */
describe('API Anything site specs', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    it(`${file} is a valid spec`, () => {
      const site = parseSite(JSON.parse(readFileSync(join(dir, file), 'utf8')))
      expect(site.operations.length).toBeGreaterThan(0)
      for (const op of site.operations) {
        // Every slot names a param the op declares (or is a cookie/session ref or generated).
        const names = new Set(op.params.map((p) => p.name))
        for (const s of op.slots) if (s.param) expect(names.has(s.param), `${op.name}: ${s.param}`).toBe(true)
        // Signed-in operations make their SAPISIDHASH locally and are never shared.
        if (op.slots.some((s) => s.gen === 'sapisidhash')) expect(localOnly(op)).toBe(true)
      }
    })
  }

  it('the specs hold no session values', () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text).not.toMatch(/SAPISIDHASH \d|"(SID|SAPISID|c_user|xs|sessionid)"\s*:\s*"[^"]{8,}"/)
    }
  })
})

/** TikTok's sound search, planned from the spec: a plain read with the words typed. */
describe('TikTok sound search', () => {
  it('asks TikTok Studio’s search for the words, as its Sounds panel does', () => {
    const home = mkdtempSync(join(tmpdir(), 'gl-aa-tt-'))
    process.env.API_ANYTHING_HOME = home
    try {
      saveSite({ ...JSON.parse(readFileSync(join(dir, 'tiktok.json'), 'utf8')), name: 'tt-plan-test' })
      const u = new URL(plan('tt-plan-test', 'musicSearch', { query: 'lofi chill' }).request.url)
      expect(u.pathname).toBe('/api/search/music/full/')
      expect(u.searchParams.get('keyword')).toBe('lofi chill')
      expect(u.searchParams.get('search_channel')).toBe('tiktok_music_create')
    } finally {
      delete process.env.API_ANYTHING_HOME
      rmSync(home, { recursive: true, force: true })
    }
  })
})

/** Facebook's reel Share through Business Suite, planned from the spec: the sound and the volumes in their place. */
describe('Facebook reel requests', () => {
  const spec = JSON.parse(readFileSync(join(dir, 'facebook.json'), 'utf8'))
  let home = ''
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'gl-aa-fb-'))
    process.env.API_ANYTHING_HOME = home
    saveSite({ ...spec, name: 'fb-plan-test' })
  })
  afterAll(() => {
    delete process.env.API_ANYTHING_HOME
    rmSync(home, { recursive: true, force: true })
  })
  const vars = (op: string, args: Record<string, unknown>) => {
    const r = plan('fb-plan-test', op, args).request
    expect(r.url.startsWith('https://business.facebook.com/')).toBe(true)
    return JSON.parse(new URLSearchParams(r.body!).get('variables')!)
  }
  const reel = {
    pageId: '108477347434387',
    identities: ['108477347434387'],
    text: 'Villa',
    videoId: '1000000000000001',
    lengthMs: 8021,
    coverId: '1000000000000003',
    seconds: 8,
    width: 1080,
    height: 1920,
    musicVolume: 0.8,
    originalVolume: 0.3,
  }
  const edits = (v: {
    input: {
      base: {
        attachments: {
          video: { video_generation_params: { web_reels_composer_video_edits: Record<string, unknown> } }
        }[]
      }
    }
  }) => v.input.base.attachments[0]!.video.video_generation_params.web_reels_composer_video_edits

  it('a reel with a sound names it, where it starts and both volumes, for Facebook only', () => {
    const v = vars('createReel', { ...reel, music: { id: '912937830269606', offset: 49, duration: 8 } })
    expect(v.input).toMatchObject({
      channels: ['FACEBOOK_NEWS_FEED'],
      identities: ['108477347434387'],
      base: { actor_id: '108477347434387', message: { text: 'Villa' } },
    })
    expect(v.input.base.attachments[0].video).toMatchObject({
      id: '1000000000000001',
      estimated_video_length_in_ms: 8021,
      additional_video_metadata: { thumbnailFileID: '1000000000000003' },
    })
    expect(edits(v)).toMatchObject({
      source_video_id: '1000000000000001',
      trim_timestamps: { start_time_in_sec: 0, end_time_in_sec: 8 },
      music_overlay: { id: '912937830269606', offset: 49, duration: 8 },
      audio_mixing: { music_volume: 0.8, original_volume: 0.3 },
      main_track: [{ video_id: '1000000000000001', original_resolution: { width: 1080, height: 1920 } }],
    })
  })

  it('a reel names its place as the composer does, empty without one', () => {
    expect(vars('createReel', { ...reel, placeId: '112431795438176' }).input.base.explicit_place_id).toBe(
      '112431795438176',
    )
    expect(vars('createReel', reel).input.base.explicit_place_id).toBe('')
  })

  it('a reel without a sound has no music overlay', () => {
    expect(edits(vars('createReel', reel))).not.toHaveProperty('music_overlay')
  })

  it('the byte upload carries the session’s token in its address, as the composer sends it', () => {
    process.env.API_ANYTHING_FILE_ROOTS = home
    writeFileSync(join(home, 'reel.mp4'), Buffer.alloc(64))
    try {
      const r = plan('fb-plan-test', 'videoUploadBytes', {
        entityName: 'a'.repeat(32),
        size: '64',
        waterfallId: '6f33ed7f-7534-40b8-9988-d0b8f12c32f8',
        endOffset: '64',
        sessionId: '1000000000000002',
        videoId: '1000000000000001',
        path: join(home, 'reel.mp4'),
      }).request
      const u = new URL(r.url)
      expect(u.host).toBe('rupload.facebook.com')
      expect(u.searchParams.has('__user')).toBe(true)
      expect(u.searchParams.has('fb_dtsg')).toBe(true)
      expect(r.headers).toMatchObject({ product_media_id: '1000000000000001', id: '1000000000000002' })
    } finally {
      delete process.env.API_ANYTHING_FILE_ROOTS
    }
  })

  it('a story names its picture four times, shares to Facebook only, as the Page', () => {
    const v = vars('createStory', {
      pageId: '108477347434387',
      identities: ['108477347434387'],
      photoId: '1000000000000009',
    })
    type Photo = { photo: { id: string } }
    const input = (
      v as {
        input: {
          channels: string[]
          INSTAGRAM_STORY: unknown
          identities: string[]
          base: {
            actor_id: string
            attachments: Photo[]
            story_original_attachments_data: { original_photo_id: string; burned_photo: { id: string } }[]
          }
          FACEBOOK_STORY: { attachments: Photo[] }
        }
      }
    ).input
    expect(input.channels).toEqual(['FACEBOOK_STORY'])
    expect(input.INSTAGRAM_STORY).toBeNull()
    expect(input.identities).toEqual(['108477347434387'])
    expect(input.base.actor_id).toBe('108477347434387')
    expect(input.base.attachments[0]?.photo.id).toBe('1000000000000009')
    expect(input.base.story_original_attachments_data[0]).toMatchObject({
      original_photo_id: '1000000000000009',
      burned_photo: { id: '1000000000000009' },
    })
    expect(input.FACEBOOK_STORY.attachments[0]?.photo.id).toBe('1000000000000009')
    // nothing of the recording's picture or Instagram account is left in the template
    expect(JSON.stringify(v)).not.toMatch(/"INSTAGRAM_STORY":\{/)
  })

  it('a post names its place only when it has one; the check-in search asks as the actor', () => {
    const fb = (op: string, args: Record<string, unknown>) => {
      const r = plan('fb-plan-test', op, args).request
      expect(r.url).toBe('https://www.facebook.com/api/graphql/')
      return {
        form: new URLSearchParams(r.body!),
        vars: JSON.parse(new URLSearchParams(r.body!).get('variables')!),
      }
    }
    const post = {
      actorId: '100000000000001',
      text: 'Villa',
      audience: 'EVERYONE',
      token: '59f2f442-07a4-45ff-bab6-1e00b04fdd21_FEED',
      attachments: [],
    }
    const placed = fb('createPost', { ...post, placeId: '112431795438176', placeShow: 'SHOW_ATTACHMENT' })
      .vars.input
    expect(placed).toMatchObject({
      explicit_place_id: '112431795438176',
      place_attachment_setting: 'SHOW_ATTACHMENT',
    })
    const plain = fb('createPost', post).vars.input
    expect(plain).not.toHaveProperty('explicit_place_id')
    expect(plain).not.toHaveProperty('place_attachment_setting')
    const search = fb('placeSearch', { actorId: '100000000000001', query: 'Ostuni' })
    expect(search.form.get('av')).toBe('100000000000001')
    expect(search.form.get('doc_id')).toBe('26544272061837065')
    expect(search.vars.query_data).toMatchObject({ caller_platform: 'FB_COMPOSER_CHECKIN', query: 'Ostuni' })
  })

  it('a video story is encoded as the Page, then shared with the video, Facebook only', () => {
    const enc = vars('encodeVideo', { pageId: '108477347434387', videoId: '1000000000000001' })
    expect(enc.input).toMatchObject({
      video_id: '1000000000000001',
      actor_id: '108477347434387',
      source: 'biz_composer',
    })
    const v = vars('createVideoStory', {
      pageId: '108477347434387',
      identities: ['108477347434387'],
      videoId: '1000000000000001',
    })
    expect(v.input.channels).toEqual(['FACEBOOK_STORY'])
    expect(v.input.base.attachments[0].video.id).toBe('1000000000000001')
    expect(v.input.FACEBOOK_STORY.attachments[0].video.id).toBe('1000000000000001')
    expect(v.input.base.story_original_attachments_data).toEqual([])
    expect(v.input.identities).toEqual(['108477347434387'])
  })

  it('the Page’s token and its comment are plain requests: the planner page, then Graph', () => {
    const planner = plan('fb-plan-test', 'plannerToken', { pageId: '108477347434387' }).request
    expect(planner.method).toBe('GET')
    expect(new URL(planner.url).searchParams.get('asset_id')).toBe('108477347434387')
    const token = 'EAAG'.padEnd(60, 'x')
    const pt = plan('fb-plan-test', 'pageToken', { pageId: '108477347434387', token }).request
    const u = new URL(pt.url)
    expect(u.host).toBe('graph.facebook.com')
    expect(u.pathname).toBe('/v21.0/108477347434387')
    expect(u.searchParams.get('fields')).toBe('access_token')
    expect(u.searchParams.get('access_token')).toBe(token)
    const c = plan('fb-plan-test', 'pageComment', {
      target: '108477347434387_1000000000000006',
      text: 'Scrivi per info',
      token: 'EAAP'.padEnd(60, 'y'),
    }).request
    expect(c.url).toBe('https://graph.facebook.com/v21.0/108477347434387_1000000000000006/comments')
    const f = new URLSearchParams(c.body!)
    expect(f.get('message')).toBe('Scrivi per info')
    expect(f.get('access_token')).toBe('EAAP'.padEnd(60, 'y'))
  })

  it('the music search asks as the Page, with the words typed', () => {
    const v = vars('musicSearch', { pageId: '108477347434387', query: 'lofi' })
    expect(v.params).toMatchObject({
      creation_tools_actor_id: '108477347434387',
      search_text: 'lofi',
      product: 'META_BUSINESS_SUITE',
    })
  })
})

/** Instagram's reel Share, planned from the spec as a driver calls it: every part of the sound in its place. */
describe('Instagram reel requests', () => {
  const spec = JSON.parse(readFileSync(join(dir, 'instagram.json'), 'utf8'))
  let home = ''
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'gl-aa-'))
    process.env.API_ANYTHING_HOME = home
    process.env.API_ANYTHING_FILE_ROOTS = home
    writeFileSync(join(home, 'reel.mp4'), Buffer.alloc(64))
    saveSite({ ...spec, name: 'ig-plan-test' })
  })
  afterAll(() => {
    delete process.env.API_ANYTHING_HOME
    delete process.env.API_ANYTHING_FILE_ROOTS
    rmSync(home, { recursive: true, force: true })
  })

  const shared = {
    uploadId: '1795359918280',
    caption: 'Trullo a Ostuni',
    seconds: 8.021,
    durationMs: 8021,
    widthText: '1080',
    heightText: '1920',
    width: 1080,
    height: 1920,
    originalVolume: 0.3,
    disableComments: '0',
    shareToFeed: '0',
  }
  const body = (op: string, args: Record<string, unknown>) => {
    const r = plan('ig-plan-test', op, args).request
    const signed = new URLSearchParams(r.body!).get('signed_body')!
    expect(signed.startsWith('SIGNATURE.')).toBe(true)
    return JSON.parse(signed.slice(10))
  }

  it('a reel with a sound names it everywhere the app does, the recorded sound gone', () => {
    const j = body('configureReelWithSound', {
      ...shared,
      assetId: '28740766638859492',
      clusterId: '2130199641208387',
      startMs: 12500,
      trackMs: 64563,
      songName: 'Gentle Resolve',
      artist: 'Fellow Travelers',
      songVolume: 0.8,
      volumeData: 'Dc3MTD8=',
      cover: 'https://instagram.fbri1-1.fna.fbcdn.net/c.jpg',
    })
    expect(j).toMatchObject({
      upload_id: '1795359918280',
      caption: 'Trullo a Ostuni',
      length: 8.021,
      original_width: '1080',
      clips_share_preview_to_feed: '0',
      clips: [{ length: 8.021 }],
      music_params: {
        audio_asset_id: '28740766638859492',
        audio_cluster_id: '2130199641208387',
        audio_asset_start_time_in_ms: 12500,
        overlap_duration_in_ms: 8021,
        song_name: 'Gentle Resolve',
        artist_name: 'Fellow Travelers',
      },
      volume_data: { volume: 'Dc3MTD8=' },
      clips_audio_metadata: {
        original: { volume_level: 0.3 },
        song: { volume_level: 0.8, audio_asset_id: '28740766638859492', track_name: 'Gentle Resolve' },
      },
    })
    const [tap] = JSON.parse(j.tap_models)
    expect(tap).toMatchObject({
      type: 'music',
      audio_asset_id: '28740766638859492',
      audio_cluster_id: '2130199641208387',
      audio_asset_start_time_in_ms: 12500,
      duration_in_ms: 64563,
      overlap_duration_in_ms: 8021,
      title: 'Gentle Resolve',
      display_artist: 'Fellow Travelers',
      cover_artwork_uri: 'https://instagram.fbri1-1.fna.fbcdn.net/c.jpg',
      dash_manifest: '',
    })
    // nothing of the recording's own sound or device is left
    const text = JSON.stringify(j)
    expect(text).not.toMatch(/2026264874069825|448134955652651|Man DeLorean|oh=00_/)
    expect(j).not.toHaveProperty('device_id')
  })

  it('a reel without a sound keeps its own audio at its volume and names no sound', () => {
    const j = body('configureReel', shared)
    expect(j).toMatchObject({
      upload_id: '1795359918280',
      clips_audio_metadata: { original: { volume_level: 0.3 } },
    })
    expect(j).not.toHaveProperty('music_params')
    expect(j).not.toHaveProperty('tap_models')
    expect(j.clips_audio_metadata).not.toHaveProperty('song')
  })

  it('a delete names the post in its address and in its body', () => {
    const r = plan('ig-plan-test', 'deleteMedia', { mediaId: '4036097084961735334_31505689963' }).request
    expect(r.url).toBe('https://i.instagram.com/api/v1/media/4036097084961735334_31505689963/delete/')
    expect(JSON.parse(new URLSearchParams(r.body!).get('signed_body')!.slice(10))).toMatchObject({
      media_id: '4036097084961735334_31505689963',
    })
  })

  it('no publish request cross-posts to Facebook, as the app does by itself', () => {
    for (const op of spec.operations as { name: string; request: { body?: string } }[])
      expect(op.request.body ?? '', op.name).not.toMatch(
        /share_to_facebook|share_to_fb_destination|xpost_surface/,
      )
  })

  it('a feed picture names its upload and size; the AI label goes only when asked', () => {
    const args = {
      uploadId: '1795361236259',
      caption: 'Villa',
      widthText: '1080',
      heightText: '1350',
      width: 1080,
      height: 1350,
    }
    const plain = body('configurePhoto', args)
    expect(plain).toMatchObject({
      upload_id: '1795361236259',
      caption: 'Villa',
      original_height: '1350',
      extra: { source_height: 1350 },
    })
    expect(plain.edits.crop_original_size).toEqual([1080, 1350])
    expect(plain).not.toHaveProperty('gen_ai_detection_method')
    expect(body('configurePhoto', { ...args, aiLabel: 'SELF_DISCLOSURE_FLOW' }).gen_ai_detection_method).toBe(
      'SELF_DISCLOSURE_FLOW',
    )
  })

  it('a carousel sends its items as the list the driver makes, under the carousel’s id', () => {
    const children = [
      { upload_id: '1795361236260', original_width: '1080' },
      { upload_id: '1795361236261', length: '8.021' },
    ]
    const j = body('configureSidecar', { sidecarId: '1795361236259', caption: 'Villa', children })
    expect(j).toMatchObject({
      upload_id: '1795361236259',
      client_sidecar_id: '1795361236259',
      children_metadata: children,
    })
  })

  it('a story names its upload, its size and when it is shared', () => {
    const j = body('configureStoryVideo', {
      uploadId: '1795361236259',
      seconds: 8.021,
      widthText: '720',
      heightText: '1280',
      width: 720,
      height: 1280,
      nowSec: '1795361236',
    })
    expect(j).toMatchObject({
      upload_id: '1795361236259',
      length: 8.021,
      clips: [{ length: 8.021 }],
      client_shared_at: '1795361236',
    })
    expect(JSON.parse(j.media_transformation_info)).toMatchObject({ width: '720', height: '1280' })
    expect(j).not.toHaveProperty('caption')
  })

  it('a picture story’s upload carries its sound for Instagram to burn in; without one it is as before', () => {
    const args = {
      entityName: '1795361236259_0_123456',
      size: '300',
      uploadId: '1795361236259',
      sessionId: '1795361236259',
      mediaType: '1',
      shareType: 'stories',
      width: 1080,
      height: 1350,
      path: join(home, 'reel.mp4'),
    }
    const params = (extra: Record<string, unknown>) =>
      JSON.parse(
        plan('ig-plan-test', 'uploadPhoto', { ...args, ...extra }).request.headers[
          'x-instagram-rupload-params'
        ]!,
      )
    const sound = params({
      photoToVideoMs: '20000',
      musicBurnin: '{"asset_fbid":"28740766638859492","offset_ms":1500}',
      stickerBurnin: '[]',
      forAlbum: '1',
    })
    expect(sound).toMatchObject({
      share_type: 'stories',
      photo_to_video_duration_ms: '20000',
      music_burnin_params: '{"asset_fbid":"28740766638859492","offset_ms":1500}',
      sticker_burnin_params: '[]',
      for_album: '1',
    })
    const plain = params({})
    for (const k of [
      'photo_to_video_duration_ms',
      'music_burnin_params',
      'sticker_burnin_params',
      'for_album',
    ])
      expect(plain).not.toHaveProperty(k)
  })

  it('the place search asks as the app does, with the words typed; a feed Share names the place or leaves it out', () => {
    const r = plan('ig-plan-test', 'placeSearch', { query: 'Ostuni' }).request
    expect(r.url).toBe('https://i.instagram.com/graphql_www')
    expect(r.headers['x-fb-friendly-name']).toBe('IGPlaceSearchQuery')
    const form = new URLSearchParams(r.body!)
    expect(form.get('client_doc_id')).toBe('182496963816957186458261742509')
    const v = JSON.parse(form.get('variables')!)
    expect(v.request).toMatchObject({ search_query: 'Ostuni', latitude: null, longitude: null })
    expect(v.request.rank_token).toMatch(/^[0-9a-f-]{36}$/)
    const place =
      '{"name":"Ostuni","address":"0.9mi","lat":40.72,"lng":17.58,"external_source":"meta_place","meta_place_id":"529415319299814"}'
    const withPlace = body('configurePhoto', {
      uploadId: '1795361236259',
      caption: 'x',
      widthText: '1080',
      heightText: '1350',
      width: 1080,
      height: 1350,
      location: place,
    })
    expect(withPlace.location).toBe(place)
    const without = body('configurePhoto', {
      uploadId: '1795361236259',
      caption: 'x',
      widthText: '1080',
      heightText: '1350',
      width: 1080,
      height: 1350,
      location: '',
    })
    expect(without).not.toHaveProperty('location')
  })

  it('a comment names its post twice, its text and one attempt id; nothing of the app’s behavior token', () => {
    const r = plan('ig-plan-test', 'postComment', {
      mediaId: '4040123456789012345_31505689963',
      numericId: '4040123456789012345',
      text: 'Scrivi per info',
      token: '718c80e7-a60f-43da-9537-034ea3a7f454',
    }).request
    expect(r.url).toBe('https://i.instagram.com/api/v1/media/4040123456789012345_31505689963/comment/')
    const j = JSON.parse(new URLSearchParams(r.body!).get('signed_body')!.slice(10))
    expect(j).toMatchObject({
      comment_text: 'Scrivi per info',
      starting_clips_media_id: '4040123456789012345',
      chaining_seed_media_id: '4040123456789012345',
      comment_creation_key: '718c80e7-a60f-43da-9537-034ea3a7f454',
      idempotence_token: '718c80e7-a60f-43da-9537-034ea3a7f454',
      delivery_class: 'organic',
    })
    expect(j).not.toHaveProperty('user_breadcrumb')
    expect(j).not.toHaveProperty('nav_chain')
  })

  it('a pin names the post and the comment in its address; nothing of the app’s ids', () => {
    const r = plan('ig-plan-test', 'pinComment', {
      mediaId: '4040123456789012345_31505689963',
      commentId: '18137299927790260',
    }).request
    expect(r.url).toBe(
      'https://i.instagram.com/api/v1/media/4040123456789012345_31505689963/pin_comment/18137299927790260/',
    )
    const j = JSON.parse(new URLSearchParams(r.body!).get('signed_body')!.slice(10))
    expect(Object.keys(j).sort()).toEqual(['_uid', '_uuid'])
    expect(j._uid).toBe('0')
  })

  it('a reel names its cover frame and says when it is made with AI', () => {
    for (const op of ['configureReel', 'configureReelWithSound']) {
      const extra =
        op === 'configureReel'
          ? {}
          : {
              assetId: '28740766638859492',
              clusterId: '2130199641208387',
              startMs: 0,
              trackMs: 64563,
              songName: 'x',
              artist: 'y',
              songVolume: 1,
              volumeData: 'DQAAgD8=',
              cover: '',
              audioUrl: 'https://instagram.fbri1-1.fna.fbcdn.net/a.mp4',
            }
      const j = body(op, {
        ...shared,
        ...extra,
        coverMs: '6657',
        posterIndex: 82,
        aiLabel: 'SELF_DISCLOSURE_FLOW',
      })
      expect(j).toMatchObject({
        cover_frame_time_ms: '6657',
        poster_frame_index: 82,
        gen_ai_detection_method: 'SELF_DISCLOSURE_FLOW',
      })
      const plain = body(op, { ...shared, ...extra })
      expect(plain).toMatchObject({ cover_frame_time_ms: '0', poster_frame_index: 0 })
      expect(plain).not.toHaveProperty('gen_ai_detection_method')
    }
  })

  it('an edit names the post in its address, the new caption and the AI label as it is', () => {
    const r = plan('ig-plan-test', 'editMedia', {
      mediaId: '4040123456789012345_31505689963',
      caption: 'Nuovo testo',
      aiMethod: 'SELF_DISCLOSURE_FLOW',
    }).request
    expect(r.url).toBe('https://i.instagram.com/api/v1/media/4040123456789012345_31505689963/edit_media/')
    const j = JSON.parse(new URLSearchParams(r.body!).get('signed_body')!.slice(10))
    expect(j).toMatchObject({
      caption_text: 'Nuovo testo',
      gen_ai_detection_method: 'SELF_DISCLOSURE_FLOW',
      container_module: 'edit_media_info',
    })
    expect(j).not.toHaveProperty('device_id')
    expect(j).not.toHaveProperty('nav_chain')
    const none = JSON.parse(
      new URLSearchParams(
        plan('ig-plan-test', 'editMedia', { mediaId: '4040123456789012345_31505689963', caption: 'x' })
          .request.body!,
      )
        .get('signed_body')!
        .slice(10),
    )
    expect(none.gen_ai_detection_method).toBe('NONE')
  })

  it('instagram.com’s own Edit: a web request by the post’s pk, its JSON body as the page sends it', () => {
    const items = '{"4040123456789000001_31000000001":"{\\"added\\":[],\\"in\\":[],\\"removed\\":[]}"}'
    const r = plan('ig-plan-test', 'editMediaWeb', {
      pk: '4040123456789012345',
      code: 'DCa1xyz',
      caption: 'Nuovo testo',
      childrenUsertags: items,
    }).request
    expect(r.method).toBe('POST')
    expect(r.url).toBe('https://www.instagram.com/api/v1/media/4040123456789012345/edit_media/')
    expect(r.headers).toMatchObject({
      'content-type': 'application/json',
      origin: 'https://www.instagram.com',
      referer: 'https://www.instagram.com/p/DCa1xyz/',
      'x-ig-app-id': '936619743392459',
      'x-requested-with': 'XMLHttpRequest',
      'sec-fetch-site': 'same-origin',
    })
    // the web sign-in as the page uses it: no app authorization, no app user agent
    expect(r.headers).not.toHaveProperty('authorization')
    expect(r.headers['user-agent'] ?? '').not.toMatch(/Instagram \d/)
    const j = JSON.parse(r.body!)
    expect(Object.keys(j)).toEqual([
      'caption_text',
      'coauthor_invites',
      'children_usertags',
      'jazoest',
      'fb_dtsg',
    ])
    expect(j).toMatchObject({
      caption_text: 'Nuovo testo',
      coauthor_invites: '{"added":[],"in":[],"removed":[]}',
      children_usertags: items,
    })
    // jazoest is made from the form token the request holds ("x" in a plan; the page's token when sent)
    expect(j.jazoest).toBe(`2${'x'.charCodeAt(0)}`)
    // a single picture or a reel names its own tags; the AI label goes in while it is on, after the caption
    const one = JSON.parse(
      plan('ig-plan-test', 'editMediaWeb', {
        pk: '4040123456789012346',
        code: 'DRe5xyz',
        caption: 'x',
        aiMethod: 'SELF_DISCLOSURE_FLOW',
        usertags: '{"added":[],"in":[],"removed":[]}',
      }).request.body!,
    )
    expect(Object.keys(one)).toEqual([
      'caption_text',
      'gen_ai_detection_method',
      'coauthor_invites',
      'usertags',
      'jazoest',
      'fb_dtsg',
    ])
    expect(one).toMatchObject({
      gen_ai_detection_method: 'SELF_DISCLOSURE_FLOW',
      usertags: '{"added":[],"in":[],"removed":[]}',
    })
    const op = parseSite({ ...spec, name: 'ig-web' }).operations.find((o) => o.name === 'editMediaWeb')!
    expect(op.slots.find((s) => s.at.join() === 'body,json:/fb_dtsg')?.from?.request.url).toBe(
      'https://www.instagram.com/',
    )
    expect(op.secFetch).toBeUndefined()
    expect(op.cookies).toBeUndefined()
  })

  it('the grid names a carousel’s items and a post’s AI label', () => {
    const op = parseSite({ ...spec, name: 'ig-grid' }).operations.find((o) => o.name === 'posts')!
    const node = (n: object) => ({
      node: { caption: { text: 'x' }, ai_label_info: { gen_ai_detection_method: 'NONE' }, ...n },
    })
    const answer = {
      data: {
        xdt_api__v1__feed__user_timeline_graphql_connection: {
          edges: [
            node({
              id: '4040123456789012345_31000000001',
              code: 'DCa1xyz',
              media_type: 8,
              location: null,
              carousel_media: [
                { id: '4040123456789000001_31000000001' },
                { id: '4040123456789000002_31000000001' },
              ],
            }),
            node({
              id: '4040123456789012346_31000000001',
              code: 'DPh1xyz',
              media_type: 1,
              location: { pk: 238580062 },
            }),
          ],
        },
      },
    }
    const got = judge(op, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(answer),
    })
    expect(got.data).toEqual([
      expect.objectContaining({
        code: 'DCa1xyz',
        items: ['4040123456789000001_31000000001', '4040123456789000002_31000000001'],
        aiMethod: 'NONE',
      }),
      expect.objectContaining({ code: 'DPh1xyz', aiMethod: 'NONE' }),
    ])
    expect((got.data as object[])[1]).not.toHaveProperty('items')
  })

  it('comments are turned off or on by the post’s address; an edit and a reel name their place', () => {
    for (const [op, path] of [
      ['disableComments', 'disable_comments'],
      ['enableComments', 'enable_comments'],
    ] as const) {
      const r = plan('ig-plan-test', op, { mediaId: '4040123456789012345_31505689963' }).request
      expect(r.url).toBe(`https://i.instagram.com/api/v1/media/4040123456789012345_31505689963/${path}/`)
      expect(new URLSearchParams(r.body!).get('_uuid')).toMatch(/^[0-9a-f-]{36}$/)
    }
    const place = '{"name":"Ostuni","meta_place_id":"529415319299814","external_source":"meta_place"}'
    const ed = JSON.parse(
      new URLSearchParams(
        plan('ig-plan-test', 'editMedia', {
          mediaId: '4040123456789012345_31505689963',
          caption: 'x',
          location: place,
        }).request.body!,
      )
        .get('signed_body')!
        .slice(10),
    )
    expect(ed.location).toBe(place)
    expect(body('configureReel', { ...shared, location: place }).location).toBe(place)
    expect(body('configureReel', shared)).not.toHaveProperty('location')
  })

  it('a story names its stickers when it has them; a video story with a sound carries the music sticker', () => {
    const story = {
      uploadId: '1795361236259',
      seconds: 8.021,
      widthText: '720',
      heightText: '1280',
      width: 720,
      height: 1280,
      nowSec: '1795361236',
    }
    const plain = body('configureStoryVideo', story)
    expect(plain).not.toHaveProperty('tap_models')
    expect(plain).not.toHaveProperty('story_sticker_ids')
    const sticker = body('configureStoryVideo', {
      ...story,
      tapModels: '[{"type":"location"}]',
      stickerIds: 'location_sticker',
    })
    expect(sticker).toMatchObject({
      tap_models: '[{"type":"location"}]',
      story_sticker_ids: 'location_sticker',
    })
    const music = body('configureStoryVideoWithSound', {
      ...story,
      assetId: '28740766638859492',
      clusterId: '2130199641208387',
      startMs: 1500,
      lengthMs: 8021,
      trackMs: 64563,
      dashManifest: '<MPD>m</MPD>',
      audioUrl: 'https://instagram.fbri1-1.fna.fbcdn.net/a.mp4',
      title: 'Gentle Resolve',
      artist: 'Fellow Travelers',
    })
    expect(music).toMatchObject({
      audio_muted: true,
      story_sticker_ids: 'music_overlay_sticker_hidden',
      length: 8.021,
    })
    expect(JSON.parse(music.tap_models)[0]).toMatchObject({
      type: 'music',
      audio_asset_id: '28740766638859492',
      overlap_duration_in_ms: 8021,
      dash_manifest: '<MPD>m</MPD>',
    })
  })

  it('a feed picture and a carousel say whether comments are off', () => {
    const photo = (extra: Record<string, unknown>) =>
      body('configurePhoto', {
        uploadId: '1795361236259',
        caption: 'x',
        widthText: '1080',
        heightText: '1350',
        width: 1080,
        height: 1350,
        ...extra,
      })
    expect(photo({ disableComments: '1' })).toMatchObject({ disable_comments: '1' })
    expect(photo({})).toMatchObject({ disable_comments: '0' })
    const side = body('configureSidecar', {
      sidecarId: '1795361236259',
      caption: 'x',
      children: [],
      disableComments: '1',
    })
    expect(side).toMatchObject({ disable_comments: '1' })
  })

  it('a picture story with a sound carries it as the app’s hidden music sticker, the recorded sound gone', () => {
    const j = body('configureStoryPhotoWithSound', {
      uploadId: '1795361236259',
      widthText: '1080',
      heightText: '1350',
      width: 1080,
      height: 1350,
      nowSec: '1795361236',
      assetId: '28740766638859492',
      clusterId: '2130199641208387',
      startMs: 1500,
      lengthMs: 20000,
      trackMs: 64563,
      dashManifest: '<MPD>manifest</MPD>',
      monetization: 'ROYALTY_FREE',
      highlights: [1500, 16500, 31500],
      audioUrl: 'https://instagram.fbri1-1.fna.fbcdn.net/o1/v/t2/a.mp4?oe=6B08F24B',
      cover: 'https://static.xx.fbcdn.net/c.webp',
      title: 'Gentle Resolve',
      artist: 'Fellow Travelers',
    })
    const taps = JSON.parse(j.tap_models)
    expect(taps).toHaveLength(1)
    expect(taps[0]).toMatchObject({
      type: 'music',
      display_type: 'music_hidden',
      audio_asset_id: '28740766638859492',
      audio_cluster_id: '2130199641208387',
      audio_asset_start_time_in_ms: 1500,
      audio_asset_suggested_start_time_in_ms: 1500,
      overlap_duration_in_ms: 20000,
      duration_in_ms: 64563,
      dash_manifest: '<MPD>manifest</MPD>',
      song_monetization_info: 'ROYALTY_FREE',
      highlight_start_times_in_ms: [1500, 16500, 31500],
      title: 'Gentle Resolve',
      display_artist: 'Fellow Travelers',
      progressive_download_url: 'https://instagram.fbri1-1.fna.fbcdn.net/o1/v/t2/a.mp4?oe=6B08F24B',
    })
    expect(JSON.parse(j.story_music_metadata)).toMatchObject({
      audio_asset_id: '28740766638859492',
      audio_cluster_id: '2130199641208387',
      song_name: 'Gentle Resolve',
      artist_name: 'Fellow Travelers',
    })
    expect(j).toMatchObject({
      upload_id: '1795361236259',
      story_sticker_ids: 'music_overlay_sticker_hidden',
      story_media_attribution_link_types: ['music'],
    })
    // nothing of the recording's session or account is left in it
    expect(JSON.stringify(j)).not.toMatch(/0bKkahBT9|0733dc42|da8228ba|31505689963|108477347434387/)
  })

  it('a carousel item’s upload says so; a picture of its own does not', () => {
    const args = {
      entityName: '1795361236260_0_123456',
      size: '300',
      uploadId: '1795361236260',
      sessionId: '1795361236259',
      mediaType: '1',
      shareType: 'feed',
      width: 1080,
      height: 1350,
      path: join(home, 'reel.mp4'),
    }
    const params = (over: Record<string, unknown>) =>
      JSON.parse(
        plan('ig-plan-test', 'uploadPhoto', { ...args, ...over }).request.headers[
          'x-instagram-rupload-params'
        ]!,
      )
    expect(params({ sidecar: '1' })).toMatchObject({
      is_sidecar: '1',
      session_id: '1795361236259',
      upload_id: '1795361236260',
    })
    const own = params({})
    expect(own).not.toHaveProperty('is_sidecar')
    expect(own).not.toHaveProperty('cover_photo_type')
    expect(JSON.parse(own.image_compression)).toMatchObject({ original_width: 1080, original_height: 1350 })
    expect(own).not.toHaveProperty('p_profile')
  })

  it('the upload goes to the address named after the file, with its upload id', () => {
    const name = `${'a'.repeat(32)}-0-8600808-1795359918280-1795359918280`
    const r = plan('ig-plan-test', 'uploadReelVideo', {
      entityName: name,
      size: '8600808',
      uploadId: '1795359918280',
      durationMs: 8021,
      width: 1080,
      height: 1920,
      path: join(home, 'reel.mp4'),
    }).request
    expect(r.url).toBe(`https://i.instagram.com/rupload_igvideo/${name}`)
    expect(r.headers['x-entity-name']).toBe(name)
    expect(JSON.parse(r.headers['x-instagram-rupload-params']!)).toMatchObject({
      upload_id: '1795359918280',
      upload_media_duration_ms: 8021,
      is_clips_video: '1',
    })
  })
})
