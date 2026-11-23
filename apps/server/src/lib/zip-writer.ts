import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { crc32, createDeflateRaw } from 'node:zlib'

/**
 * Writes a zip archive as a stream, one entry at a time, so a kit of a few GB costs no memory and no temporary file.
 * Files on disk that are stored as they are (pictures, PDFs: already compressed) are read once for their CRC first,
 * so their headers carry the real sizes and every unzip tool reads them; everything else is deflated with a data
 * descriptor. ZIP64 is used where sizes or offsets need it. Names are UTF-8.
 */

export interface ZipInput {
  /** The path inside the archive, with `/` between folders. */
  name: string
  /** A file on disk. */
  path?: string
  /** Or a stream, opened when its turn comes (for files that aren't on disk as they are). */
  open?: () => Promise<Readable>
  /** Bytes, when known. */
  size?: number | null
  date?: Date
  /** Deflate it (default: by extension; streams are always deflated). */
  compress?: boolean
}

const LOCAL = 0x04034b50
const DESCRIPTOR = 0x08074b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50
const EOCD64 = 0x06064b50
const EOCD64_LOCATOR = 0x07064b50
const MAX32 = 0xffffffff
const FLAG_DESCRIPTOR = 0x0008
const FLAG_UTF8 = 0x0800

/** Formats that are compressed already: deflating them only costs time. */
const STORED =
  /\.(png|jpe?g|webp|gif|avif|heic|mp4|mov|m4v|webm|mkv|m4a|mp3|aac|ogg|opus|flac|zip|figcraft|pdf|woff2?|7z|rar|gz|xz|zst|br)$/i

export const compressible = (name: string) => !STORED.test(name)

interface Written {
  name: Buffer
  method: number
  flags: number
  crc: number
  csize: number
  usize: number
  offset: number
  time: number
  date: number
  /** Its local header carries ZIP64 sizes: so does its central record. */
  zip64: boolean
}

export function zipStream(
  inputs: Iterable<ZipInput> | AsyncIterable<ZipInput>,
  opts: { zip64?: 'auto' | 'always' } = {},
) {
  const always = opts.zip64 === 'always'
  async function* run() {
    let offset = 0
    const written: Written[] = []
    for await (const input of inputs) {
      const name = Buffer.from(input.name.replace(/^\/+/, ''), 'utf8')
      const { time, date } = dosTime(input.date ?? new Date())
      const start = offset
      const deflate = input.open ? true : (input.compress ?? compressible(input.name))
      if (input.path && !deflate) {
        // Stored: the CRC first, then a header with the real sizes.
        let crc = 0
        let usize = 0
        for await (const chunk of createReadStream(input.path)) {
          crc = crc32(chunk as Buffer, crc)
          usize += (chunk as Buffer).length
        }
        const big = always || usize >= MAX32 || start >= MAX32
        const head = localHeader(name, 0, FLAG_UTF8, time, date, crc, usize, usize, big)
        yield head
        offset += head.length
        let sent = 0
        for await (const chunk of createReadStream(input.path)) {
          sent += (chunk as Buffer).length
          yield chunk as Buffer
        }
        if (sent !== usize) throw new Error(`${input.name} changed while it was being zipped`)
        offset += sent
        written.push({
          name,
          method: 0,
          flags: FLAG_UTF8,
          crc,
          csize: usize,
          usize,
          offset: start,
          time,
          date,
          zip64: big,
        })
        continue
      }
      // Deflated, sizes in a data descriptor after the data.
      const big = always || input.size == null || input.size >= MAX32 / 2 || start >= MAX32
      const flags = FLAG_UTF8 | FLAG_DESCRIPTOR
      const head = localHeader(name, 8, flags, time, date, 0, 0, 0, big)
      yield head
      offset += head.length
      const source = input.path ? createReadStream(input.path) : await input.open!()
      let crc = 0
      let usize = 0
      let csize = 0
      for await (const chunk of deflated(source, (raw) => {
        crc = crc32(raw, crc)
        usize += raw.length
      })) {
        csize += chunk.length
        yield chunk
      }
      offset += csize
      const desc = Buffer.alloc(big ? 24 : 16)
      desc.writeUInt32LE(DESCRIPTOR, 0)
      desc.writeUInt32LE(crc >>> 0, 4)
      if (big) {
        desc.writeBigUInt64LE(BigInt(csize), 8)
        desc.writeBigUInt64LE(BigInt(usize), 16)
      } else {
        desc.writeUInt32LE(csize, 8)
        desc.writeUInt32LE(usize, 12)
      }
      yield desc
      offset += desc.length
      written.push({ name, method: 8, flags, crc, csize, usize, offset: start, time, date, zip64: big })
    }

    const cdStart = offset
    for (const w of written) {
      const big = always || w.zip64 || w.csize >= MAX32 || w.usize >= MAX32 || w.offset >= MAX32
      const extra = big ? Buffer.alloc(28) : Buffer.alloc(0)
      if (big) {
        extra.writeUInt16LE(0x0001, 0)
        extra.writeUInt16LE(24, 2)
        extra.writeBigUInt64LE(BigInt(w.usize), 4)
        extra.writeBigUInt64LE(BigInt(w.csize), 12)
        extra.writeBigUInt64LE(BigInt(w.offset), 20)
      }
      const h = Buffer.alloc(46)
      h.writeUInt32LE(CENTRAL, 0)
      h.writeUInt16LE((3 << 8) | 45, 4) // made by Unix, zip 4.5
      h.writeUInt16LE(big ? 45 : 20, 6)
      h.writeUInt16LE(w.flags, 8)
      h.writeUInt16LE(w.method, 10)
      h.writeUInt16LE(w.time, 12)
      h.writeUInt16LE(w.date, 14)
      h.writeUInt32LE(w.crc >>> 0, 16)
      h.writeUInt32LE(big ? MAX32 : w.csize, 20)
      h.writeUInt32LE(big ? MAX32 : w.usize, 24)
      h.writeUInt16LE(w.name.length, 28)
      h.writeUInt16LE(extra.length, 30)
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38) // a regular file, rw-r--r--
      h.writeUInt32LE(big ? MAX32 : w.offset, 42)
      const rec = Buffer.concat([h, w.name, extra])
      yield rec
      offset += rec.length
    }
    const cdSize = offset - cdStart
    const count = written.length
    const big = always || count >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32
    if (big) {
      const z = Buffer.alloc(56)
      z.writeUInt32LE(EOCD64, 0)
      z.writeBigUInt64LE(44n, 4)
      z.writeUInt16LE((3 << 8) | 45, 12)
      z.writeUInt16LE(45, 14)
      z.writeBigUInt64LE(BigInt(count), 24)
      z.writeBigUInt64LE(BigInt(count), 32)
      z.writeBigUInt64LE(BigInt(cdSize), 40)
      z.writeBigUInt64LE(BigInt(cdStart), 48)
      const loc = Buffer.alloc(20)
      loc.writeUInt32LE(EOCD64_LOCATOR, 0)
      loc.writeBigUInt64LE(BigInt(offset), 8)
      loc.writeUInt32LE(1, 16)
      yield z
      yield loc
    }
    const e = Buffer.alloc(22)
    e.writeUInt32LE(EOCD, 0)
    e.writeUInt16LE(big ? 0xffff : count, 8)
    e.writeUInt16LE(big ? 0xffff : count, 10)
    e.writeUInt32LE(big ? MAX32 : cdSize, 12)
    e.writeUInt32LE(big ? MAX32 : cdStart, 16)
    yield e
  }
  return Readable.from(run(), { objectMode: false, highWaterMark: 1024 * 1024 })
}

function localHeader(
  name: Buffer,
  method: number,
  flags: number,
  time: number,
  date: number,
  crc: number,
  csize: number,
  usize: number,
  big: boolean,
) {
  const extra = big ? Buffer.alloc(20) : Buffer.alloc(0)
  if (big) {
    extra.writeUInt16LE(0x0001, 0)
    extra.writeUInt16LE(16, 2)
    extra.writeBigUInt64LE(BigInt(usize), 4)
    extra.writeBigUInt64LE(BigInt(csize), 12)
  }
  const h = Buffer.alloc(30)
  h.writeUInt32LE(LOCAL, 0)
  h.writeUInt16LE(big ? 45 : 20, 4)
  h.writeUInt16LE(flags, 6)
  h.writeUInt16LE(method, 8)
  h.writeUInt16LE(time, 10)
  h.writeUInt16LE(date, 12)
  h.writeUInt32LE(crc >>> 0, 14)
  h.writeUInt32LE(big ? MAX32 : csize, 18)
  h.writeUInt32LE(big ? MAX32 : usize, 22)
  h.writeUInt16LE(name.length, 26)
  h.writeUInt16LE(extra.length, 28)
  return Buffer.concat([h, name, extra])
}

/** The deflated bytes of `source`, telling `onRaw` about every chunk read. */
async function* deflated(source: Readable, onRaw: (chunk: Buffer) => void) {
  const d = createDeflateRaw({ level: 6 })
  const feeding = (async () => {
    for await (const chunk of source) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      onRaw(b)
      if (!d.write(b)) await once(d, 'drain')
    }
    d.end()
  })()
  feeding.catch((err) => d.destroy(err))
  for await (const out of d) yield out as Buffer
  await feeding
}

/** MS-DOS date and time, local, in 2-second steps (what every unzip tool shows). */
function dosTime(d: Date) {
  const year = Math.max(1980, Math.min(2107, d.getFullYear()))
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}
