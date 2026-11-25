import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Asset, applyOps, emptyComposition, FORMAT_SIZES, type Op } from '@greenlit/composition'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../core/actor.ts'
import type { ModuleContext } from '../../core/module.ts'
import { ffmpeg } from '../../lib/ffmpeg.ts'
import type { MediaService } from '../media/service.ts'
import { assetFile, keepVersionOps, versionKeyOf } from './assets.ts'
import { Renderer } from './render.ts'
import { CompositionsService } from './service.ts'

const actor: Actor = { kind: 'system', source: 'system' }
const VIDEO = '00000000-0000-0000-0000-00000000000a'
const MUSIC = '00000000-0000-0000-0000-00000000000b'

/**
 * A stand-in for the library's format rows, answering `formatsOf` as MediaService does: the formats of the version
 * asked for ('' = the main one), the main version's when the item has no such version, the version's main first.
 */
class Library {
  rows: {
    mediaId: string
    version: string
    key: string
    isPrimary: boolean
    blobId: string
    derived: string[]
  }[] = []
  /** blob id → path of its file */
  paths = new Map<string, string>()

  add(mediaId: string, version: string, key: string, path: string) {
    const blobId = `blob-${this.rows.length + 1}`
    const isPrimary = !this.rows.some((r) => r.mediaId === mediaId && r.version === version)
    this.rows.push({ mediaId, version, key, isPrimary, blobId, derived: [] })
    this.paths.set(blobId, path)
    return blobId
  }

  formatsOf = async (mediaId: string, opts: { version?: string | null } = {}) => {
    const wanted = opts.version ?? ''
    const of = (v: string) =>
      this.rows
        .filter((r) => r.mediaId === mediaId && r.version === v)
        .sort((a, b) => +b.isPrimary - +a.isPrimary)
    const own = of(wanted)
    return own.length || !wanted ? own : of('')
  }

  get media() {
    return this as unknown as Pick<MediaService, 'formatsOf'>
  }
}

const asset = (a: Partial<Asset> & Pick<Asset, 'id' | 'mediaId' | 'kind'>): Asset => ({
  name: '',
  duration: 1,
  width: 320,
  height: 180,
  hasAudio: false,
  ...a,
})

describe('the version an asset asks for', () => {
  const m = {
    versions: [
      { key: '', label: 'Original' },
      { key: 'social-master', label: 'Social master (-15 LUFS)' },
    ],
  }

  it('is a version key or a version name; nothing, "" and main are the main version', () => {
    expect(versionKeyOf(m, 'social-master')).toBe('social-master')
    expect(versionKeyOf(m, 'social master (-15 lufs)')).toBe('social-master')
    for (const main of [undefined, null, '', 'main', 'Main', 'Original'])
      expect(versionKeyOf(m, main)).toBe('')
  })

  it('is null when the item has no such version', () => {
    expect(versionKeyOf(m, 'english')).toBeNull()
    expect(versionKeyOf({ versions: [] }, 'social-master')).toBeNull()
    expect(versionKeyOf({ versions: [] }, 'main')).toBe('')
  })
})

describe('the file an asset plays', () => {
  const lib = new Library()
  lib.add(MUSIC, '', 'main', '/original.wav')
  lib.add(MUSIC, 'social-master', 'main', '/master.wav')
  lib.add(MUSIC, 'social-master', 'vertical', '/master-vertical.wav')

  it('is the format of its version', async () => {
    const f = await assetFile(lib.media, { mediaId: MUSIC, version: 'social-master', formatKey: 'main' })
    expect(lib.paths.get(f!.blobId)).toBe('/master.wav')
    const v = await assetFile(lib.media, { mediaId: MUSIC, version: 'social-master', formatKey: 'vertical' })
    expect(lib.paths.get(v!.blobId)).toBe('/master-vertical.wav')
  })

  it('is the main version’s without a version, as before versions', async () => {
    const f = await assetFile(lib.media, { mediaId: MUSIC, formatKey: 'main' })
    expect(lib.paths.get(f!.blobId)).toBe('/original.wav')
    const empty = await assetFile(lib.media, { mediaId: MUSIC, version: '', formatKey: 'main' })
    expect(lib.paths.get(empty!.blobId)).toBe('/original.wav')
  })

  it('is the version’s main format when the version lacks the key, and the main version’s when it is gone', async () => {
    const square = await assetFile(lib.media, {
      mediaId: MUSIC,
      version: 'social-master',
      formatKey: 'square',
    })
    expect(lib.paths.get(square!.blobId)).toBe('/master.wav')
    const gone = await assetFile(lib.media, { mediaId: MUSIC, version: 'deleted', formatKey: 'main' })
    expect(lib.paths.get(gone!.blobId)).toBe('/original.wav')
  })
})

describe('a new asset', () => {
  const format = (key: string, duration: number, isPrimary = key === 'main') => ({
    key,
    isPrimary,
    kind: 'audio',
    duration,
    width: null,
    height: null,
    hasAudio: true,
  })
  const media = {
    id: MUSIC,
    title: 'Hopeful Dreams',
    formats: [format('main', 120)],
    versions: [
      { key: '', label: 'Original', formats: [format('main', 120)] },
      { key: 'social-master', label: 'Social master (-15 LUFS)', formats: [format('main', 119.5)] },
    ],
  }
  const svc = new CompositionsService({
    services: { media: { get: async () => media } },
  } as unknown as ModuleContext)

  it('names the version it was asked for, by key or name, with that version’s file details', async () => {
    const a = await svc.assetFor({ mediaId: MUSIC, version: 'social-master' }, actor)
    expect(a).toMatchObject({ mediaId: MUSIC, version: 'social-master', formatKey: 'main', duration: 119.5 })
    const byName = await svc.assetFor({ mediaId: MUSIC, version: 'Social master (-15 LUFS)' }, actor)
    expect(byName.version).toBe('social-master')
  })

  it('names no version for the main one, so documents look as they did', async () => {
    for (const version of [undefined, '', 'main']) {
      const a = await svc.assetFor({ mediaId: MUSIC, version }, actor)
      expect(a).not.toHaveProperty('version')
      expect(a.duration).toBe(120)
    }
  })

  it('is refused for a version the item does not have, listing the ones it has', async () => {
    await expect(svc.assetFor({ mediaId: MUSIC, version: 'english' }, actor)).rejects.toThrow(
      /no version "english".*"social-master" \(Social master/,
    )
  })
})

describe('a new main version', () => {
  const doc = applyOps(emptyComposition(), [
    { op: 'add_asset', asset: asset({ id: 'main', mediaId: MUSIC, kind: 'audio' }) },
    {
      op: 'add_asset',
      asset: asset({ id: 'master', mediaId: MUSIC, kind: 'audio', version: 'social-master' }),
    },
    { op: 'add_asset', asset: asset({ id: 'pitch', mediaId: MUSIC, kind: 'audio', version: 'pitch-up' }) },
    { op: 'add_asset', asset: asset({ id: 'other', mediaId: VIDEO, kind: 'video' }) },
  ])

  it('leaves the edit’s assets on the files they played', () => {
    const ops = keepVersionOps(doc, MUSIC, 'social-master', 'original')
    const next = applyOps(doc, ops)
    expect(next.assets.main!.version).toBe('original')
    expect(next.assets.master).not.toHaveProperty('version')
    expect(next.assets.pitch!.version).toBe('pitch-up')
    expect(next.assets.other).toEqual(doc.assets.other)
    expect(ops.map((o) => (o as Extract<Op, { op: 'add_asset' }>).asset.id).sort()).toEqual([
      'main',
      'master',
    ])
  })

  it('changes nothing in an edit that doesn’t use the item', () => {
    expect(keepVersionOps(doc, '00000000-0000-0000-0000-0000000000ff', 'x', 'y')).toEqual([])
  })
})

/**
 * Two versions of a video with different pictures (red: the main one, blue: another version) and of a piece of music,
 * drawn the way an export and editor_frame draw them. Needs ffmpeg on the PATH (the app's image has it; CI's
 * runner does not), so it is skipped without one.
 */
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
describe.skipIf(!hasFfmpeg)('drawing an edit', () => {
  let dir: string
  const lib = new Library()
  let masterBlob: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'greenlit-asset-versions-'))
    const clip = async (name: string, color: string) => {
      const path = join(dir, name)
      await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=30:d=1`, '-pix_fmt', 'yuv420p', path])
      return path
    }
    lib.add(VIDEO, '', 'main', await clip('red.mp4', 'red'))
    lib.add(VIDEO, 'english', 'main', await clip('blue.mp4', 'blue'))
    lib.add(MUSIC, '', 'main', join(dir, 'original.wav'))
    masterBlob = lib.add(MUSIC, 'social-master', 'main', join(dir, 'master.wav'))
    await mkdir(join(dir, 'data'), { recursive: true })
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const renderer = () =>
    new Renderer({
      config: { dataDir: join(dir, 'data') },
      services: {
        media: lib.media,
        files: {
          get: async (id: string) => ({ id }),
          readablePath: async (blob: { id: string }) => lib.paths.get(blob.id)!,
          sign: (url: string) => `${url}?signed`,
        },
      },
    } as unknown as ModuleContext)

  const edit = (version?: string) =>
    applyOps(emptyComposition([{ ...FORMAT_SIZES.landscape }], 30, 1), [
      {
        op: 'add_asset',
        asset: asset({ id: 'v', mediaId: VIDEO, kind: 'video', ...(version ? { version } : {}) }),
      },
      { op: 'add_asset', asset: asset({ id: 'm', mediaId: MUSIC, kind: 'audio', version: 'social-master' }) },
      {
        op: 'add_clip',
        trackId: 'v1',
        clip: { id: 'shot', type: 'video', assetId: 'v', start: 0, duration: 1 },
      },
      {
        op: 'add_clip',
        trackId: 'a1',
        clip: { id: 'song', type: 'audio', assetId: 'm', start: 0, duration: 1 },
      },
    ])

  /** The colour of the frame the renderer extracted for the video clip at 0.5 s. */
  const frameColour = async (version?: string) => {
    const r = renderer()
    const doc = edit(version)
    const s = await r.createSession('c', doc, doc.formats[0]!, actor, [0.5])
    try {
      const path = r.framePath(s, 'shot', 15)
      expect(path).not.toBeNull()
      const [red, green, blue] = await sharp(path!).resize(1, 1).raw().toBuffer()
      return { red: red!, green: green!, blue: blue!, session: s }
    } finally {
      await r.dropSession(s)
    }
  }

  it('takes the video frames of a non-main version from that version’s file', async () => {
    const c = await frameColour('english')
    expect(c.blue).toBeGreaterThan(180)
    expect(c.red).toBeLessThan(80)
  })

  it('takes them from the main version’s file when the asset names no version', async () => {
    const c = await frameColour()
    expect(c.red).toBeGreaterThan(180)
    expect(c.blue).toBeLessThan(80)
  })

  it('plays and mixes the music from its version’s file', async () => {
    const r = renderer()
    const doc = edit('english')
    const s = await r.createSession('c', doc, doc.formats[0]!, actor, [0.5])
    try {
      expect(s.assets.m!.src).toBe(`/api/files/${masterBlob}?signed`)
      // The export's sound: every audible clip is an ffmpeg input.
      const audio = await (
        r as unknown as { audioArgs: (d: typeof doc) => Promise<{ inputs: string[] }> }
      ).audioArgs(doc)
      expect(audio.inputs).toContain(join(dir, 'master.wav'))
      expect(audio.inputs).not.toContain(join(dir, 'original.wav'))
    } finally {
      await r.dropSession(s)
    }
  })
})
