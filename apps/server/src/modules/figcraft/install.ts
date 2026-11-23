import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { arch, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { FIGCRAFT_WEB, installWebApp } from './webapp.ts'

/**
 * Installs FigCraft's pinned release files (the Docker image runs this at build time):
 *
 *   node apps/server/src/modules/figcraft/install.ts web <dir>   the browser build, unpacked and precompressed
 *   node apps/server/src/modules/figcraft/install.ts cli <dir>   figcraft-cli (+ its licences) from the Linux tarball
 *
 * Every download is checked against the SHA-256 the release publishes (SHA256SUMS.txt).
 */
export const FIGCRAFT_CLI = {
  version: FIGCRAFT_WEB.version,
  x64: {
    url: 'https://github.com/storytold/figcraft/releases/download/v0.18.1/figcraft-0.18.1-linux-x86_64.tar.gz',
    sha256: '8276d2ac55c6f77f7af3a411a9b00415d3feb0b59607a54523311340e653fc19',
  },
  arm64: {
    url: 'https://github.com/storytold/figcraft/releases/download/v0.18.1/figcraft-0.18.1-linux-aarch64.tar.gz',
    sha256: 'b27dee10be5db50def03dee3be470bc2f9ce508be1690e75b4765354d2b89c88',
  },
} as const

export async function installCli(dir: string, from?: string) {
  const pin = FIGCRAFT_CLI[arch() as 'x64' | 'arm64']
  if (!pin) throw new Error(`No figcraft-cli build for ${arch()}`)
  const work = await mkdtemp(join(tmpdir(), 'figcraft-cli-'))
  try {
    const tarball = join(work, 'figcraft.tar.gz')
    const hash = createHash('sha256')
    const tap = new Transform({
      transform(chunk, _enc, done) {
        hash.update(chunk)
        done(null, chunk)
      },
    })
    if (from) await pipeline(createReadStream(from), tap, createWriteStream(tarball))
    else {
      const res = await fetch(pin.url, { redirect: 'follow', signal: AbortSignal.timeout(20 * 60_000) })
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
      await pipeline(Readable.fromWeb(res.body as never), tap, createWriteStream(tarball))
    }
    const got = hash.digest('hex')
    if (got !== pin.sha256)
      throw new Error(`the download's checksum is wrong (${got}, expected ${pin.sha256})`)
    await run('tar', [
      '-xzf',
      tarball,
      '-C',
      work,
      '--wildcards',
      '*/bin/figcraft-cli',
      '*/share/doc/figcraft/*',
    ])
    const top = (await readdir(work, { withFileTypes: true })).find((e) => e.isDirectory())
    if (!top) throw new Error('the tarball has no figcraft folder')
    await mkdir(dir, { recursive: true })
    await copyFile(join(work, top.name, 'bin', 'figcraft-cli'), join(dir, 'figcraft-cli'))
    await chmod(join(dir, 'figcraft-cli'), 0o755)
    const docs = join(dir, 'figcraft-licenses')
    await mkdir(docs, { recursive: true })
    for (const name of await readdir(join(work, top.name, 'share', 'doc', 'figcraft')))
      await copyFile(join(work, top.name, 'share', 'doc', 'figcraft', name), join(docs, name))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

if (import.meta.main) {
  const [what, dir, from] = process.argv.slice(2)
  if ((what !== 'web' && what !== 'cli') || !dir) {
    console.error('usage: install.ts web|cli <dir> [local release file]')
    process.exit(2)
  }
  await (what === 'web' ? installWebApp(dir, from) : installCli(dir, from))
  console.log(`FigCraft ${FIGCRAFT_WEB.version} ${what} installed in ${dir}`)
}
