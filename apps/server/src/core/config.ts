import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
export const SERVER_ROOT = resolve(here, '../..')
export const REPO_ROOT = resolve(SERVER_ROOT, '../..')

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GREENLIT_DATABASE_URL: z.string().default('postgres://greenlit:greenlit@localhost:54329/greenlit'),
  GREENLIT_DATA_DIR: z.string().default(join(REPO_ROOT, 'data')),
  GREENLIT_HOST: z.string().default('0.0.0.0'),
  GREENLIT_PORT: z.coerce.number().int().default(4310),
  /** The address people use to reach Greenlit (share links, MCP setup text). */
  GREENLIT_PUBLIC_URL: z.string().default(''),
  /** 32+ random bytes, used to sign tokens and encrypt connected-account secrets. */
  GREENLIT_SECRET: z.string().optional(),
  /** all = API + background workers; api / worker split them across processes. */
  GREENLIT_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  GREENLIT_WEB_DIST: z.string().default(join(REPO_ROOT, 'apps/web/dist')),
  /** In development the web app runs on Vite; renders open pages from here. */
  GREENLIT_WEB_URL: z.string().optional(),
  GREENLIT_FFMPEG: z.string().default('ffmpeg'),
  GREENLIT_FFPROBE: z.string().default('ffprobe'),
  GREENLIT_CHROMIUM: z.string().default('/usr/bin/chromium'),
  /** Greenlit's Android device: its adb server (host:port), e.g. android:5037 in Docker. Unset = no device. */
  GREENLIT_ANDROID_ADB: z.string().optional(),
  GREENLIT_ADB: z.string().default('adb'),
  GREENLIT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  GREENLIT_WORKERS: z.coerce.number().int().min(1).max(64).default(2),
  TZ: z.string().optional(),
})

export type Config = ReturnType<typeof loadConfig>

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(env)
  const dataDir = resolve(e.GREENLIT_DATA_DIR)
  mkdirSync(dataDir, { recursive: true })
  const secret = e.GREENLIT_SECRET ?? devSecret(dataDir, e.NODE_ENV)
  if (secret.length < 32) throw new Error('GREENLIT_SECRET must be at least 32 characters')
  const port = e.GREENLIT_PORT
  const publicUrl = absoluteUrl(e.GREENLIT_PUBLIC_URL)
  return {
    env: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    databaseUrl: e.GREENLIT_DATABASE_URL,
    dataDir,
    host: e.GREENLIT_HOST,
    port,
    publicUrl: publicUrl || `http://localhost:${port}`,
    /** Where the web app is served; the renderer opens pages from it. In development Vite serves it on :4300. */
    webUrl: (
      e.GREENLIT_WEB_URL ||
      (e.NODE_ENV !== 'production' && !existsSync(join(e.GREENLIT_WEB_DIST, 'index.html'))
        ? 'http://localhost:4300'
        : '') ||
      publicUrl ||
      `http://localhost:${port}`
    ).replace(/\/$/, ''),
    /** URL the renderer uses to reach this API (always local). */
    internalUrl: `http://127.0.0.1:${port}`,
    secret,
    role: e.GREENLIT_ROLE,
    webDist: e.GREENLIT_WEB_DIST,
    ffmpeg: e.GREENLIT_FFMPEG,
    ffprobe: e.GREENLIT_FFPROBE,
    chromium: e.GREENLIT_CHROMIUM,
    androidAdb: e.GREENLIT_ANDROID_ADB || null,
    adb: e.GREENLIT_ADB,
    logLevel: e.GREENLIT_LOG_LEVEL,
    workers: e.GREENLIT_WORKERS,
    systemTimeZone: e.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    version: readVersion(),
  }
}

/**
 * The public address as a full URL without a trailing slash. A bare host name ("greenlit.example.com", as a
 * Cloudflare hostname is often written) gets https://, a local one (localhost, an IP address) http://.
 */
export function absoluteUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '')
  if (!u || /^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u
  const local = /^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(u)
  return `${local ? 'http' : 'https'}://${u}`
}

/** Outside production a random secret is created once and kept in the data folder. */
function devSecret(dataDir: string, env: string): string {
  if (env === 'production') throw new Error('Set GREENLIT_SECRET (e.g. `openssl rand -hex 32`)')
  const file = join(dataDir, '.dev-secret')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const s = randomBytes(32).toString('hex')
  writeFileSync(file, s, { mode: 0o600 })
  return s
}

function readVersion(): string {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
