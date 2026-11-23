import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isZip, ZipReader } from '../../lib/zip.ts'
import { NotADesign, readDesign, soleFrame } from './design.ts'

/** A zip writer just big enough for the tests: stored or deflated entries, no ZIP64. */
function zip(entries: { name: string; data: Buffer | string; deflate?: boolean }[]) {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data)
    const body = e.deflate ? deflateRawSync(data) : data
    const name = Buffer.from(e.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(e.deflate ? 8 : 0, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x800, 8)
    c.writeUInt16LE(e.deflate ? 8 : 0, 10)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += 30 + name.length + body.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dir, end])
}

const doc = {
  format: 'figcraft',
  version: 1,
  name: 'Poster',
  pages: [1, 10],
  nodes: {
    '1': { id: 1, name: 'Social', type: 'page', children: [2, 3] },
    '2': { id: 2, name: 'Post 1:1', type: 'frame', children: [4], width: 1080, height: 1080 },
    '3': {
      id: 3,
      name: 'Story',
      type: 'frame',
      width: 1080,
      height: 1920,
      transform: [1, 0, 0, 1, 1200, 0],
    },
    '4': {
      id: 4,
      name: 'Title',
      type: 'text',
      style: { font_family: 'Cinzel' },
      runs: [{ style: { font_family: 'Jost' } }],
    },
    '10': { id: 10, name: 'Empty', type: 'page', children: [] },
  },
  styles: [{ type: 'text' }, { type: 'paint' }],
  variables: { variables: [{}, {}, {}] },
  imageIndex: [{ hash: 'abc' }],
  comments: [],
}

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'greenlit-figcraft-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ZipReader', () => {
  it('reads stored and deflated entries and unpacks them', async () => {
    const path = join(dir, 'a.zip')
    const big = 'x'.repeat(100_000)
    await writeFile(
      path,
      zip([
        { name: 'plain.txt', data: 'hello' },
        { name: 'sub/big.txt', data: big, deflate: true },
      ]),
    )
    expect(await isZip(path)).toBe(true)
    const z = await ZipReader.open(path)
    try {
      expect(z.entries.map((e) => e.name)).toEqual(['plain.txt', 'sub/big.txt'])
      expect((await z.read('plain.txt'))?.toString()).toBe('hello')
      expect((await z.read('sub/big.txt'))?.toString()).toBe(big)
      expect(await z.read('missing')).toBeNull()
      await expect(z.read('sub/big.txt', 10)).rejects.toThrow(/too big/)
      await z.extractAll(join(dir, 'out'))
    } finally {
      await z.close()
    }
    expect(await readFile(join(dir, 'out/sub/big.txt'), 'utf8')).toBe(big)
  })

  it('refuses names that climb out of the folder', async () => {
    const path = join(dir, 'evil.zip')
    await writeFile(path, zip([{ name: '../escape.txt', data: 'no' }]))
    const z = await ZipReader.open(path)
    try {
      await expect(z.extractAll(join(dir, 'evil'))).rejects.toThrow(/outside/)
    } finally {
      await z.close()
    }
  })

  it('says no to files that are not zips', async () => {
    const path = join(dir, 'not.zip')
    await writeFile(path, 'just text, long enough to have an end record if it were one')
    expect(await isZip(path)).toBe(false)
    await expect(ZipReader.open(path)).rejects.toThrow(/Not a zip/)
  })
})

describe('readDesign', () => {
  it('lists pages, frames, fonts and counts', async () => {
    const path = join(dir, 'poster.figcraft')
    await writeFile(
      path,
      zip([
        { name: 'document.json', data: JSON.stringify(doc), deflate: true },
        { name: 'thumbnail.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
        { name: 'versions/index.json', data: '{"versions":[]}' },
        { name: 'versions/v1.json', data: '{}' },
      ]),
    )
    const { info, thumbnail } = await readDesign(path)
    expect(thumbnail?.length).toBe(4)
    expect(info.name).toBe('Poster')
    expect(info.pages.map((p) => p.name)).toEqual(['Social', 'Empty'])
    expect(info.pages[0]!.frames).toEqual([
      { id: 2, name: 'Post 1:1', type: 'frame', x: 0, y: 0, width: 1080, height: 1080 },
      { id: 3, name: 'Story', type: 'frame', x: 1200, y: 0, width: 1080, height: 1920 },
    ])
    expect(info.fonts).toEqual(['Cinzel', 'Jost'])
    expect(info).toMatchObject({ layers: 3, styles: 2, textStyles: 1, variables: 3, images: 1, versions: 1 })
    expect(soleFrame(info)).toBeNull()
  })

  it('knows a one-frame design by its frame', async () => {
    const one = { ...doc, pages: [1], nodes: { ...doc.nodes, '1': { ...doc.nodes['1'], children: [2] } } }
    const path = join(dir, 'one.figcraft')
    await writeFile(path, zip([{ name: 'document.json', data: JSON.stringify(one) }]))
    const { info, thumbnail } = await readDesign(path)
    expect(thumbnail).toBeNull()
    expect(soleFrame(info)?.name).toBe('Post 1:1')
  })

  it('rejects files that are not FigCraft documents', async () => {
    const plain = join(dir, 'plain.figcraft')
    await writeFile(plain, 'not a zip at all, but long enough to be scanned for an end record')
    await expect(readDesign(plain)).rejects.toBeInstanceOf(NotADesign)
    const other = join(dir, 'other.figcraft')
    await writeFile(other, zip([{ name: 'document.json', data: '{"format":"something-else"}' }]))
    await expect(readDesign(other)).rejects.toBeInstanceOf(NotADesign)
  })
})
