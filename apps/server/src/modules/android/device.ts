import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Text as `adb shell input text` must get it: the device's shell reads the command line, so its special characters
 * are escaped, and `input` reads %s as a space.
 */
export function inputText(text: string): string {
  return text.replace(/[\\'"`$&|;<>()*?!~#{}[\]^% ]/g, (c) => (c === ' ' ? '%s' : `\\${c}`))
}

/** Android key codes the device view sends. */
export const KEYS = { back: 4, home: 3, recents: 187, enter: 66, delete: 67, tab: 61, escape: 111 } as const
export type Key = keyof typeof KEYS

export interface DeviceStatus {
  /** GREENLIT_ANDROID_ADB is set. */
  configured: boolean
  /** The adb server answers and a device is attached. */
  online: boolean
  /** Android has finished starting. */
  booted: boolean
  serial: string | null
  model: string | null
  android: string | null
  screen: { width: number; height: number } | null
  message: string | null
}

/**
 * Greenlit's Android device (docker/android: the emulator, headless), reached through its adb server. Used for
 * what only a platform's Android app does, and shown in Settings so the owner can sign in to apps on it.
 */
export class Device {
  readonly configured: boolean
  private host = ''
  private port = ''
  private adbBin: string

  constructor(adbServer: string | null, adbBin: string) {
    this.adbBin = adbBin
    this.configured = !!adbServer
    if (adbServer) {
      const [h, p] = adbServer.split(':')
      this.host = h || '127.0.0.1'
      this.port = p || '5037'
    }
  }

  /** Runs adb against the device's server; `serial` picks the device. */
  async adb(args: string[], opts: { serial?: string | null; timeoutMs?: number; binary?: boolean } = {}) {
    if (!this.configured) throw new Error('No Android device is set up (GREENLIT_ANDROID_ADB)')
    const all = ['-H', this.host, '-P', this.port, ...(opts.serial ? ['-s', opts.serial] : []), ...args]
    const { stdout } = await run(this.adbBin, all, {
      timeout: opts.timeoutMs ?? 15_000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: opts.binary ? 'buffer' : 'utf8',
    })
    return stdout as unknown as string | Buffer
  }

  /** The first attached device ("emulator-5554"), or null. */
  async serial(): Promise<string | null> {
    const out = String(await this.adb(['devices']))
    const line = out
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .find((p) => p[1] === 'device')
    return line?.[0] ?? null
  }

  async status(): Promise<DeviceStatus> {
    const base: DeviceStatus = {
      configured: this.configured,
      online: false,
      booted: false,
      serial: null,
      model: null,
      android: null,
      screen: null,
      message: null,
    }
    if (!this.configured) return { ...base, message: 'No Android device is set up' }
    try {
      const serial = await this.serial()
      if (!serial) return { ...base, message: 'The Android device is starting' }
      const prop = async (k: string) => String(await this.adb(['shell', 'getprop', k], { serial })).trim()
      const booted = (await prop('sys.boot_completed')) === '1'
      const size = String(await this.adb(['shell', 'wm', 'size'], { serial })).match(/(\d+)x(\d+)/)
      return {
        ...base,
        online: true,
        booted,
        serial,
        model: (await prop('ro.product.model')) || null,
        android: (await prop('ro.build.version.release')) || null,
        screen: size ? { width: Number(size[1]), height: Number(size[2]) } : null,
        message: booted ? null : 'Android is still starting',
      }
    } catch (err) {
      return {
        ...base,
        message: `The Android device does not answer (${(err as Error).message.split('\n')[0]})`,
      }
    }
  }

  /**
   * The screen as raw RGBA pixels. The device encoding a PNG of every frame took about 0.5 s; the raw frame comes
   * in about 0.12 s and is made into a JPEG on this side.
   */
  async screen(): Promise<RawFrame> {
    const serial = await this.serial()
    if (!serial) throw new Error('No Android device attached')
    const buf = (await this.adb(['exec-out', 'screencap'], {
      serial,
      binary: true,
      timeoutMs: 10_000,
    })) as Buffer
    return rawFrame(buf)
  }

  async tap(x: number, y: number) {
    await this.shell(['input', 'tap', String(Math.round(x)), String(Math.round(y))])
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, ms: number) {
    await this.shell([
      'input',
      'swipe',
      ...[x1, y1, x2, y2].map((v) => String(Math.round(v))),
      String(Math.round(ms)),
    ])
  }

  async key(key: Key) {
    await this.shell(['input', 'keyevent', String(KEYS[key])])
  }

  /** Types text into the focused field. Never logged: it may be a password. */
  async text(text: string) {
    const safe = inputText(text)
    if (safe) await this.shell(['input', 'text', safe])
  }

  /**
   * The OAuth token an app holds for the device's Google account, as Android's account database keeps it (the
   * app's own requests carry it), for `scope` (`oauth2:<scopes>`). Read as root (the emulator's adb root); the
   * copy is deleted straight after. Null when the app has none (not signed in).
   */
  async appToken(pkg: string, scope: string): Promise<string | null> {
    const serial = await this.rootSerial()
    const dir = await mkdtemp(join(tmpdir(), 'greenlit-accounts-'))
    try {
      await this.adb(['pull', '/data/system_ce/0/accounts_ce.db', join(dir, 'accounts_ce.db')], { serial })
      // Recent writes (a renewed token) may still be in the write-ahead log.
      await this.adb(['pull', '/data/system_ce/0/accounts_ce.db-wal', join(dir, 'accounts_ce.db-wal')], {
        serial,
      }).catch(() => {})
      return tokenIn(join(dir, 'accounts_ce.db'), pkg, scope)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /**
   * A file of an app's own data (`/data/data/<pkg>/<rel>`), read as root; null when it is not there. For what an
   * app keeps about who is signed in (its user id and name). The path stays inside the app's folder.
   */
  async appRead(pkg: string, rel: string): Promise<Buffer | null> {
    const path = appPath(pkg, rel)
    const serial = await this.rootSerial()
    const out = (await this.adb(['exec-out', `cat '${path}' 2>/dev/null`], {
      serial,
      binary: true,
      timeoutMs: 20_000,
    })) as Buffer
    return out.length ? out : null
  }

  /** The names in a folder of an app's own data; empty when it is not there. */
  async appList(pkg: string, rel: string): Promise<string[]> {
    const path = appPath(pkg, rel)
    const serial = await this.rootSerial()
    const out = String(await this.adb(['shell', `ls -1 '${path}' 2>/dev/null`], { serial }))
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  }

  /** Whether an app is installed. */
  async hasApp(pkg: string): Promise<boolean> {
    if (!/^[\w.]+$/.test(pkg)) return false
    const serial = await this.serial()
    if (!serial) return false
    return String(await this.adb(['shell', 'pm', 'path', pkg], { serial }).catch(() => '')).includes(
      'package:',
    )
  }

  private async rootSerial() {
    const serial = await this.serial()
    if (!serial) throw new Error('No Android device attached')
    await this.adb(['root'], { serial, timeoutMs: 20_000 })
    await this.adb(['wait-for-device'], { serial, timeoutMs: 30_000 })
    return serial
  }

  /** Starts an app (its launcher activity), as tapping its icon does. */
  async launch(pkg: string) {
    if (!/^[\w.]+$/.test(pkg)) throw new Error(`Not a package name: ${pkg}`)
    await this.shell(['monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'])
  }

  private async shell(args: string[]) {
    const serial = await this.serial()
    if (!serial) throw new Error('No Android device attached')
    await this.adb(['shell', ...args], { serial })
  }
}

/**
 * The token an app holds for a Google account for `scope`, in a copy of Android's accounts_ce.db. Its type there
 * is `<package>:<the app's certificate hash>:<scope>`.
 */
export function tokenIn(file: string, pkg: string, scope: string): string | null {
  const db = new DatabaseSync(file)
  try {
    const rows = db
      .prepare(
        `select t.type as type, t.authtoken as token from authtokens t join accounts a on a._id = t.accounts_id
         where a.type = 'com.google' order by t._id desc`,
      )
      .all() as { type: string; token: string | null }[]
    const row = rows.find((r) => r.type.startsWith(`${pkg}:`) && r.type.endsWith(`:${scope}`) && r.token)
    return row?.token ?? null
  } finally {
    db.close()
  }
}

/** `/data/data/<pkg>/<rel>`, refused unless both are plain names (no way out of the app's folder, no quoting). */
export function appPath(pkg: string, rel: string): string {
  if (!/^[\w.]+$/.test(pkg)) throw new Error(`Not a package name: ${pkg}`)
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(rel) || rel.split('/').some((p) => p === '..' || p === '.'))
    throw new Error(`Not a file of the app: ${rel}`)
  return `/data/data/${pkg}/${rel}`
}

export interface RawFrame {
  width: number
  height: number
  /** RGBA, `width * height * 4` bytes. */
  pixels: Buffer
}

/**
 * A frame as `screencap` writes it without -p: its width, height and pixel format (1 = RGBA_8888) as 32-bit little
 * endian numbers (and, since Android 10, a colour space: a 16-byte header, 12 before), then the pixels.
 */
export function rawFrame(buf: Buffer): RawFrame {
  if (buf.length < 12) throw new Error('No frame from the device')
  const width = buf.readUInt32LE(0)
  const height = buf.readUInt32LE(4)
  const format = buf.readUInt32LE(8)
  const size = width * height * 4
  const header = buf.length - size
  if (format !== 1 || !width || !height || (header !== 12 && header !== 16))
    throw new Error(`Unexpected frame from the device (${width}x${height}, format ${format})`)
  return { width, height, pixels: buf.subarray(header) }
}
