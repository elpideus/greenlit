import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ZipReader } from './zip.ts'
import { zipStream } from './zip-writer.ts'

describe('zipStream', () => {
  let dir: string
  const picture = Buffer.alloc(300_000)
  for (let i = 0; i < picture.length; i++) picture[i] = (i * 7919) % 251
  const text = 'Stone su stone.\n'.repeat(5000)
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gl-zipw-'))
    await writeFile(join(dir, 'logo.png'), picture)
    await writeFile(join(dir, 'README.md'), text)
    await writeFile(join(dir, 'empty.txt'), '')
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  for (const zip64 of ['auto', 'always'] as const)
    it(`writes stored, deflated and streamed entries the reader gets back (zip64 ${zip64})`, async () => {
      const out = join(dir, `kit-${zip64}.zip`)
      await pipeline(
        zipStream(
          [
            { name: 'Acme Studio/01 Loghi/logo.png', path: join(dir, 'logo.png') },
            { name: 'Acme Studio/README.md', path: join(dir, 'README.md') },
            { name: 'Acme Studio/vuoto.txt', path: join(dir, 'empty.txt') },
            {
              name: 'Acme Studio/00 Anteprime/01 — Copertina.txt',
              open: async () => Readable.from([Buffer.from('copertina '), Buffer.from('à è ì')]),
            },
          ],
          { zip64 },
        ),
        createWriteStream(out),
      )
      const z = await ZipReader.open(out)
      try {
        expect(z.entries.map((e) => [e.name, e.method])).toEqual([
          ['Acme Studio/01 Loghi/logo.png', 0],
          ['Acme Studio/README.md', 8],
          ['Acme Studio/vuoto.txt', 8],
          ['Acme Studio/00 Anteprime/01 — Copertina.txt', 8],
        ])
        expect((await z.read('Acme Studio/01 Loghi/logo.png'))!.equals(picture)).toBe(true)
        expect((await z.read('Acme Studio/README.md'))!.toString()).toBe(text)
        expect((await z.read('Acme Studio/vuoto.txt'))!.length).toBe(0)
        expect((await z.read('Acme Studio/00 Anteprime/01 — Copertina.txt'))!.toString()).toBe(
          'copertina à è ì',
        )
        // Deflating actually happened.
        expect(z.get('Acme Studio/README.md')!.compressedSize).toBeLessThan(text.length / 10)
      } finally {
        await z.close()
      }
    })
})
