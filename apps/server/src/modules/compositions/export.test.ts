import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Composition, FORMAT_SIZES, type OutputFormat } from '@greenlit/composition'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../../core/actor.ts'
import type { JobContext } from '../../core/jobs.ts'
import type { BlobRow } from '../files/service.ts'
import { type ExportDeps, exportFormats, exportKeys } from './export.ts'

const ids = (...xs: string[]) => xs.map((id) => ({ id }))

describe('the format keys of an export', () => {
  it('gives the format called main the main key wherever it is in the list', () => {
    expect(exportKeys(ids('vertical', 'portrait', 'square', 'main'))).toEqual([
      'vertical',
      'portrait',
      'square',
      'main',
    ])
    expect(exportKeys(ids('main', 'vertical', 'square'))).toEqual(['main', 'vertical', 'square'])
  })

  it('gives the main key to the design format when no format is called main', () => {
    expect(exportKeys(ids('vertical'))).toEqual(['main'])
    expect(exportKeys(ids('vertical', 'square', 'portrait'))).toEqual(['main', 'square', 'portrait'])
  })

  it('never gives two formats the same key', () => {
    expect(exportKeys(ids('vertical', 'main', 'main'))).toEqual(['vertical', 'main', 'main-2'])
    expect(exportKeys(ids('main', 'square', 'square', 'square-2'))).toEqual([
      'main',
      'square',
      'square-3',
      'square-2',
    ])
    for (const list of [ids('a', 'main', 'a', 'main', 'a-2'), ids('b', 'b', 'b'), ids('main', 'main')]) {
      const keys = exportKeys(list)
      expect(new Set(keys).size).toBe(list.length)
    }
  })
})

/**
 * A stand-in for the library: a media item's formats by key, where a file for a key it already has replaces that
 * format's file (a new file version), as MediaService does.
 */
class Library {
  items = new Map<string, { primary: string; formats: Map<string, { path: string; revision: number }> }>()
  private n = 0

  createFromBlob: ExportDeps['media']['createFromBlob'] = async (blob, opts) => {
    const id = `media-${++this.n}`
    const key = opts.formatKey ?? 'main'
    this.items.set(id, { primary: key, formats: new Map([[key, { path: blob.path, revision: 1 }]]) })
    return id
  }

  attachFile: ExportDeps['media']['attachFile'] = async (mediaId, blob, opts) => {
    const formats = this.items.get(mediaId)!.formats
    const existing = formats.get(opts.formatKey)
    formats.set(opts.formatKey, { path: blob.path, revision: (existing?.revision ?? 0) + 1 })
    return opts.formatKey
  }

  /** Each format of the item with the size of its file. */
  async sizes(mediaId: string) {
    const out: Record<string, { width: number; height: number; revision: number }> = {}
    for (const [key, f] of this.items.get(mediaId)!.formats) {
      const { width, height } = await sharp(f.path).metadata()
      out[key] = { width: width!, height: height!, revision: f.revision }
    }
    return out
  }
}

describe('exporting a composition', () => {
  let dir: string
  const actor: Actor = { kind: 'system', source: 'system' }
  const job = { progress: async () => {}, signal: new AbortController().signal } as unknown as JobContext
  const row = { name: 'Social cut', projectId: null, revision: 7 }
  // The design format is 9:16 and the 16:9 one (id main) comes last: the order the bug was found with.
  const doc = Composition.parse({
    formats: [FORMAT_SIZES.vertical, FORMAT_SIZES.portrait, FORMAT_SIZES.square, FORMAT_SIZES.landscape],
  })
  let renders: OutputFormat[] = []
  let library: Library
  let saved: string | null

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'greenlit-export-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  const deps = (): ExportDeps => ({
    // A frame of the format's size stands in for the video Chromium and ffmpeg would make.
    render: async (format) => {
      renders.push(format)
      const file = join(dir, `${renders.length}-${format.id}.png`)
      await sharp({
        create: { width: format.width, height: format.height, channels: 3, background: '#000' },
      }).toFile(file)
      return file
    },
    files: { ingest: async (path: string) => ({ id: path, path }) as unknown as BlobRow },
    media: library,
    setOutputMedia: async (id) => {
      saved = id
    },
  })

  const expectAllFormats = async (mediaId: string, revision: number) =>
    expect(await library.sizes(mediaId)).toEqual({
      vertical: { width: 1080, height: 1920, revision },
      portrait: { width: 1080, height: 1350, revision },
      square: { width: 1080, height: 1080, revision },
      main: { width: 1920, height: 1080, revision },
    })

  it('stores every format under its own key when the one called main is not the first', async () => {
    renders = []
    library = new Library()
    saved = null
    const mediaId = await exportFormats(deps(), row, doc, [], null, actor, job)
    expect(mediaId).not.toBeNull()
    expect(saved).toBe(mediaId)
    expect(renders.map((f) => f.id)).toEqual(['vertical', 'portrait', 'square', 'main'])
    await expectAllFormats(mediaId!, 1)
    // The item is made from the design format, which stays its primary one.
    expect(library.items.get(mediaId!)!.primary).toBe('vertical')
  })

  it('exports again into the same item, each format replacing only its own file', async () => {
    const mediaId = [...library.items.keys()][0]!
    await exportFormats(deps(), row, doc, [], mediaId, actor, job)
    await expectAllFormats(mediaId, 2)
    // One format alone: only that one gets a new file.
    await exportFormats(deps(), row, doc, ['main'], mediaId, actor, job)
    const sizes = await library.sizes(mediaId)
    expect(sizes.main).toEqual({ width: 1920, height: 1080, revision: 3 })
    expect(sizes.vertical).toEqual({ width: 1080, height: 1920, revision: 2 })
  })
})
