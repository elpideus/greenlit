import { createWriteStream } from 'node:fs'
import { type FileHandle, mkdir, open } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw, inflateRawSync } from 'node:zlib'

/**
 * A small zip reader for the archives Greenlit opens itself (FigCraft documents, the FigCraft browser build): it reads
 * the central directory, then one entry at a time, so a 60 MB design file costs only the entries asked for. Stored
 * and deflated entries, ZIP64 sizes and offsets; no encryption, no multi-disk archives.
 */
export interface ZipEntry {
  name: string
  size: number
  compressedSize: number
  method: number
  offset: number
  directory: boolean
}

const EOCD = 0x06054b50
const EOCD64 = 0x06064b50
const EOCD64_LOCATOR = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const MAX_COMMENT = 0xffff

export class ZipError extends Error {}

export class ZipReader {
  readonly entries: ZipEntry[]
  private fh: FileHandle

  private constructor(fh: FileHandle, entries: ZipEntry[]) {
    this.fh = fh
    this.entries = entries
  }

  static async open(path: string): Promise<ZipReader> {
    const fh = await open(path, 'r')
    try {
      return new ZipReader(fh, await readDirectory(fh))
    } catch (err) {
      await fh.close()
      throw err
    }
  }

  get(name: string) {
    return this.entries.find((e) => e.name === name)
  }

  /** An entry's bytes, or null when it isn't there. Refuses entries bigger than `maxBytes` (unpacked). */
  async read(name: string, maxBytes = 512 * 1024 * 1024): Promise<Buffer | null> {
    const e = this.get(name)
    if (!e || e.directory) return null
    if (e.size > maxBytes) throw new ZipError(`${name} is too big (${e.size} bytes)`)
    const raw = await this.raw(e)
    const data =
      e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: maxBytes }) : null
    if (!data) throw new ZipError(`${name} uses compression method ${e.method}`)
    if (data.length !== e.size) throw new ZipError(`${name} is damaged`)
    return data
  }

  /** Writes an entry to `dest` without holding it in memory. */
  async extract(e: ZipEntry, dest: string) {
    await mkdir(dirname(dest), { recursive: true })
    const start = await this.dataStart(e)
    const source = Readable.from(chunks(this.fh, start, e.compressedSize))
    if (e.method === 0) await pipeline(source, createWriteStream(dest))
    else if (e.method === 8) await pipeline(source, createInflateRaw(), createWriteStream(dest))
    else throw new ZipError(`${e.name} uses compression method ${e.method}`)
  }

  /** Every file into `dir`, refusing names that would land outside it. */
  async extractAll(dir: string) {
    const root = normalize(dir)
    for (const e of this.entries) {
      if (e.directory) continue
      const dest = normalize(join(root, e.name))
      if (!dest.startsWith(root + sep)) throw new ZipError(`${e.name} points outside the archive`)
      await this.extract(e, dest)
    }
  }

  close() {
    return this.fh.close()
  }

  private async dataStart(e: ZipEntry) {
    const head = Buffer.alloc(30)
    await this.fh.read(head, 0, 30, e.offset)
    if (head.readUInt32LE(0) !== LOCAL) throw new ZipError(`${e.name} has no local header`)
    return e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  }

  private async raw(e: ZipEntry) {
    const start = await this.dataStart(e)
    const buf = Buffer.alloc(e.compressedSize)
    const { bytesRead } = await this.fh.read(buf, 0, e.compressedSize, start)
    if (bytesRead !== e.compressedSize) throw new ZipError(`${e.name} is cut short`)
    return buf
  }
}

async function* chunks(fh: FileHandle, start: number, length: number) {
  const size = 1024 * 1024
  for (let pos = 0; pos < length; pos += size) {
    const buf = Buffer.alloc(Math.min(size, length - pos))
    const { bytesRead } = await fh.read(buf, 0, buf.length, start + pos)
    if (!bytesRead) throw new ZipError('The archive is cut short')
    yield buf.subarray(0, bytesRead)
  }
}

async function readDirectory(fh: FileHandle): Promise<ZipEntry[]> {
  const { size } = await fh.stat()
  if (size < 22) throw new ZipError('Not a zip archive')
  const tailLen = Math.min(size, 22 + MAX_COMMENT + 20)
  const tail = Buffer.alloc(tailLen)
  await fh.read(tail, 0, tailLen, size - tailLen)
  let at = -1
  for (let i = tailLen - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === EOCD) {
      at = i
      break
    }
  if (at < 0) throw new ZipError('Not a zip archive')
  let count = tail.readUInt16LE(at + 10)
  let dirSize = tail.readUInt32LE(at + 12)
  let dirOffset = tail.readUInt32LE(at + 16)
  // ZIP64: the real values live in the ZIP64 end record, found through its locator just before.
  if ((count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) && at >= 20) {
    if (tail.readUInt32LE(at - 20) === EOCD64_LOCATOR) {
      const recOffset = Number(tail.readBigUInt64LE(at - 20 + 8))
      const rec = Buffer.alloc(56)
      await fh.read(rec, 0, 56, recOffset)
      if (rec.readUInt32LE(0) !== EOCD64) throw new ZipError('Damaged ZIP64 archive')
      count = Number(rec.readBigUInt64LE(32))
      dirSize = Number(rec.readBigUInt64LE(40))
      dirOffset = Number(rec.readBigUInt64LE(48))
    }
  }
  if (dirOffset + dirSize > size) throw new ZipError('Damaged zip archive')
  const dir = Buffer.alloc(dirSize)
  await fh.read(dir, 0, dirSize, dirOffset)
  const entries: ZipEntry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.length || dir.readUInt32LE(p) !== CENTRAL) throw new ZipError('Damaged zip directory')
    const flags = dir.readUInt16LE(p + 8)
    const method = dir.readUInt16LE(p + 10)
    let compressedSize = dir.readUInt32LE(p + 20)
    let uncompressed = dir.readUInt32LE(p + 24)
    const nameLen = dir.readUInt16LE(p + 28)
    const extraLen = dir.readUInt16LE(p + 30)
    const commentLen = dir.readUInt16LE(p + 32)
    let offset = dir.readUInt32LE(p + 42)
    const name = dir.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen)
    // ZIP64 extra field: the 0xffffffff values, in order, as 8-byte numbers.
    let x = p + 46 + nameLen
    const extraEnd = x + extraLen
    while (x + 4 <= extraEnd) {
      const id = dir.readUInt16LE(x)
      const len = dir.readUInt16LE(x + 2)
      if (id === 0x0001) {
        let q = x + 4
        if (uncompressed === 0xffffffff) {
          uncompressed = Number(dir.readBigUInt64LE(q))
          q += 8
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(dir.readBigUInt64LE(q))
          q += 8
        }
        if (offset === 0xffffffff) offset = Number(dir.readBigUInt64LE(q))
      }
      x += 4 + len
    }
    if (flags & 0x1) throw new ZipError(`${name} is encrypted`)
    entries.push({
      name,
      size: uncompressed,
      compressedSize,
      method,
      offset,
      directory: name.endsWith('/'),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Does the file start like a zip archive? */
export async function isZip(path: string) {
  const fh = await open(path, 'r')
  try {
    const b = Buffer.alloc(4)
    await fh.read(b, 0, 4, 0)
    return b.readUInt32LE(0) === LOCAL
  } finally {
    await fh.close()
  }
}
