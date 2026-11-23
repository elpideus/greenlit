/**
 * Puts CUDA into the image (`docker build --build-arg GPU=cuda`): ONNX Runtime's CUDA provider, which npm doesn't
 * carry (it comes from the same release on NuGet), next to its CPU runtime, and the CUDA 13 libraries it loads
 * (cudart, cuBLAS, cuRAND and cuDNN 9: NVIDIA's redistributable wheels from PyPI; the provider's own installer calls
 * it "cuda12", but 1.31 is built against CUDA 13) in /opt/greenlit-cuda, which the runtime stage registers with the
 * dynamic linker. Every download is pinned and checked by SHA-256; only what ONNX Runtime loads is kept. The NVIDIA
 * driver itself (CUDA 13 needs 580 or newer) comes from the machine, mounted in by NVIDIA's container toolkit
 * (docker/compose.gpu.yaml).
 *
 * Run from the repo root: node docker/gpu/install-cuda.ts
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ZipReader } from '../../apps/server/src/lib/zip.ts'

const LIB_DIR = '/opt/greenlit-cuda/lib'

/** Must be the version of onnxruntime-node in apps/server/package.json (the provider is built against it). */
const ORT_VERSION = '1.31.1'

const PACKAGES: { url: string; sha256: string; take: RegExp; to: 'provider' | 'cuda' }[] = [
  {
    url: `https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/${ORT_VERSION}/microsoft.ml.onnxruntime.gpu.linux.${ORT_VERSION}.nupkg`,
    sha256: 'cfb5315b87f812d8d91194075eb4aab3cbfd97a932f2b56c9bfa41e36087c4a2',
    take: /^runtimes\/linux-x64\/native\/libonnxruntime_providers_(cuda|shared)\.so$/,
    to: 'provider',
  },
  {
    url: 'https://files.pythonhosted.org/packages/0b/7c/14b8f5518f8951e9dca57ea80f44f8ea8bcc8671812e6cc38009f3205e57/nvidia_cuda_runtime-13.5.37-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl',
    sha256: 'df2b79a8852f10d1fef8c848489c49eebb5754051bf870202a862831412b179d',
    take: /\/lib\/libcudart\.so\.13$/,
    to: 'cuda',
  },
  {
    url: 'https://files.pythonhosted.org/packages/27/11/db2c1a4321c2145928f87e0f647104d3a908f78d4d582908759ce81a0c17/nvidia_cublas-13.10.1.6-py3-none-manylinux1_x86_64.manylinux_2_5_x86_64.whl',
    sha256: '0f26cf49a81377fd96f519e28fd56c5f638a2581f303d531f60e633fb222e1ea',
    take: /\/lib\/libcublas(Lt)?\.so\.13$/,
    to: 'cuda',
  },
  {
    url: 'https://files.pythonhosted.org/packages/ef/6f/94535c450d44a68ef0b43d7a5e54c0e5ecda2ca3db7daec5d54c8d94e0d8/nvidia_cudnn_cu13-9.28.1.4-py3-none-manylinux_2_27_x86_64.whl',
    sha256: 'a54f205b1db1f2895d99f398754db1369816f0569dd459731f925635cf7b65ec',
    take: /\/lib\/libcudnn[a-z_]*\.so\.9$/,
    to: 'cuda',
  },
  {
    url: 'https://files.pythonhosted.org/packages/12/63/636e5dc9afb2959bfc0042a357d5567358df829b66c96d9fc36d77dc0596/nvidia_curand-10.4.5.25-py3-none-manylinux_2_27_x86_64.whl',
    sha256: '22bb226a857e5888fe6b54ae465fc4371296bcff13a35f79e19691bcf454f529',
    take: /\/lib\/libcurand\.so\.10$/,
    to: 'cuda',
  },
]

const require = createRequire(join(process.cwd(), 'apps/server/package.json'))
const ortPackage = require.resolve('onnxruntime-node/package.json')
const installed = (require(ortPackage) as { version: string }).version
if (installed !== ORT_VERSION)
  throw new Error(
    `onnxruntime-node is ${installed}; update ORT_VERSION and the NuGet checksum in ${import.meta.filename}`,
  )
const PROVIDER_DIR = join(dirname(ortPackage), 'bin', 'napi-v6', 'linux', 'x64')

const work = join(tmpdir(), 'greenlit-cuda')
await mkdir(work, { recursive: true })
await mkdir(LIB_DIR, { recursive: true })
for (const p of PACKAGES) {
  const file = join(work, p.url.split('/').pop()!)
  const res = await fetch(p.url)
  if (!res.ok || !res.body) throw new Error(`${p.url}: ${res.status}`)
  const hash = createHash('sha256')
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (c: Buffer) => hash.update(c))
  await pipeline(body, createWriteStream(file))
  const digest = hash.digest('hex')
  if (digest !== p.sha256) throw new Error(`${p.url}: checksum ${digest}, expected ${p.sha256}`)
  const zip = await ZipReader.open(file)
  try {
    const entries = zip.entries.filter((e) => p.take.test(e.name))
    if (!entries.length) throw new Error(`${p.url}: nothing matched ${p.take}`)
    for (const e of entries) {
      const data = await zip.read(e.name, 2 * 1024 ** 3)
      const dest = join(p.to === 'provider' ? PROVIDER_DIR : LIB_DIR, e.name.split('/').pop()!)
      await writeFile(dest, data!)
      console.log(`  ${dest} (${Math.round(data!.length / 1e6)} MB)`)
    }
  } finally {
    await zip.close()
    await rm(file, { force: true })
  }
}
await rm(work, { recursive: true, force: true })
console.log(`CUDA 13 for ONNX Runtime installed (${LIB_DIR} goes to the dynamic linker in the runtime stage)`)
