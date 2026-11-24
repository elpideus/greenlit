import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobContext } from '../../core/jobs.ts'
import type { ModuleContext } from '../../core/module.ts'
import { SMALL } from './model.ts'
import { DepthService } from './service.ts'

/** The video model: what it was given, and a hook to run while it works. */
const made: string[] = []
let whileMaking: () => void = () => {}
vi.mock('./estimate.ts', () => ({
  depthOfPicture: vi.fn(),
  depthOfVideo: vi.fn(async (_model: unknown, src: string, out: string) => {
    made.push(src)
    whileMaking()
    await writeFile(out, `depth of ${src}`)
  }),
}))
vi.mock('../../lib/ffmpeg.ts', () => ({ probe: vi.fn(async () => ({ width: 1080, height: 1920, fps: 24 })) }))

describe('making the depth map of a video format', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'greenlit-depth-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  /** The format as the database has it now. */
  let row: Record<string, unknown>
  const attachFile = vi.fn(async () => 'depth-row')
  const job = { progress: async () => {}, signal: new AbortController().signal } as unknown as JobContext

  const service = () => {
    const quiet = { info() {}, warn() {}, error() {}, debug() {} }
    const ctx = {
      config: { dataDir: dir },
      log: quiet,
      settings: { define: () => ({ get: () => ({ enabled: true, kinds: 'all' }) }) },
      // The item (the only query run() makes itself).
      db: { select: () => ({ from: () => ({ where: async () => [{ id: 'item', deletedAt: null }] }) }) },
      realtime: { publish() {} },
      services: {
        files: {
          dir: () => dir,
          get: async (id: string) => ({ id }),
          readablePath: async (blob: { id: string }) => `/blobs/${blob.id}.mp4`,
          ingest: async (_file: string, info: { filename: string }) => ({
            id: 'map',
            filename: info.filename,
          }),
        },
        media: { attachFile },
      },
    } as unknown as ModuleContext
    const svc = new DepthService(ctx)
    const model = { spec: SMALL, installed: () => true, ensure: async () => {}, close: async () => {} }
    Object.assign(svc as unknown as Record<string, unknown>, {
      small: model,
      moge: { ...model, spec: { ...SMALL, id: 'moge' } },
      formatRow: async () => ({ ...row }),
      depthOf: async () => null,
    })
    return svc
  }

  beforeEach(() => {
    made.length = 0
    whileMaking = () => {}
    attachFile.mockClear()
    row = {
      id: 'format',
      mediaId: 'item',
      role: 'format',
      kind: 'video',
      key: 'main',
      version: '',
      blobId: 'cut-9x16',
      fileRevision: 1,
      filename: 'Cut (9:16).mp4',
      processingState: 'ready',
      meta: null,
    }
  })

  it('attaches the map of the file the format has', async () => {
    expect(await service().run({ formatId: 'format' }, job)).toEqual({ made: 'Cut (9:16)_depth.mp4' })
    expect(made).toEqual(['/blobs/cut-9x16.mp4'])
    expect(attachFile).toHaveBeenCalledTimes(1)
    expect(attachFile).toHaveBeenCalledWith(
      'item',
      { id: 'map', filename: 'Cut (9:16)_depth.mp4' },
      expect.objectContaining({
        formatKey: 'main',
        depth: true,
        meta: expect.objectContaining({ generated: expect.objectContaining({ fromRevision: 1 }) }),
      }),
      expect.anything(),
    )
  })

  it('makes it again when the format gets a new file meanwhile, and never attaches the old one', async () => {
    // An export writes the 16:9 video into the format while the map of the 9:16 one is being made.
    whileMaking = () => {
      whileMaking = () => {}
      row = { ...row, blobId: 'cut-16x9', fileRevision: 2, filename: 'Cut (16:9).mp4' }
    }
    expect(await service().run({ formatId: 'format' }, job)).toEqual({ made: 'Cut (16:9)_depth.mp4' })
    expect(made).toEqual(['/blobs/cut-9x16.mp4', '/blobs/cut-16x9.mp4'])
    expect(attachFile).toHaveBeenCalledTimes(1)
    expect(attachFile).toHaveBeenCalledWith(
      'item',
      { id: 'map', filename: 'Cut (16:9)_depth.mp4' },
      expect.objectContaining({
        formatKey: 'main',
        meta: expect.objectContaining({ generated: expect.objectContaining({ fromRevision: 2 }) }),
      }),
      expect.anything(),
    )
  })
})
