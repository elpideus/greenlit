import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Rule: this repository is public and carries nothing of the studio and construction company it was first built
 * for (names, handles, page/channel ids, brand kit, theme). Fixtures use neutral names ("Acme Studio").
 * The patterns are assembled from pieces so this file does not match itself.
 */
const J = (...p: string[]) => p.join('')
const FORBIDDEN = [
  new RegExp(J('studio', '\\s+', 'associato'), 'i'),
  new RegExp(J('costruzioni', '\\s+', 'ge', 'm'), 'i'),
  new RegExp(J('associato', '_?', 'ge', 'm'), 'i'),
  new RegExp(J('(?<![a-z])ge', 'm(?![a-z])'), 'i'),
  new RegExp(J('ge', 'm-greenlit'), 'i'),
  new RegExp(J('10006364', '8724866|11365118', '6703712428850|UC8YjX5RrJJY26', 'uBC8slgNtw')),
]

describe('public release', () => {
  const root = join(__dirname, '..')
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(
      (f) =>
        f && f !== 'pnpm-lock.yaml' && !/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|zip|mp4|pdf)$/i.test(f),
    )

  it('has no trace of the first customer in any tracked file or path', () => {
    const hits: string[] = []
    for (const f of files) {
      for (const re of FORBIDDEN) if (re.test(f)) hits.push(`${f} (path)`)
      let text: string
      try {
        text = readFileSync(join(root, f), 'utf8')
      } catch {
        continue
      }
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${f} (${re.source})`)
    }
    expect(hits).toEqual([])
  })
})
