import { describe, expect, it, vi } from 'vitest'
import type { DriverAccount, DriverRun } from './types.ts'
import { confirmUpload } from './youtube-api.ts'

// The read-back waits between its reads; here they answer at once.
vi.mock('./util.ts', async (original) => ({
  ...(await original<typeof import('./util.ts')>()),
  sleep: async () => {},
}))

const account: DriverAccount = {
  id: 'a',
  platform: 'youtube',
  externalId: 'UC0000000000000000000000',
  name: 'Acme Studio',
  handle: '@acmestudio',
  platformIds: { channelId: 'UC0000000000000000000000', pageId: '100000000000000000001' },
}

/** A run whose Studio list shows the video with the schedules given, one per read (the last one repeats). */
function listing(scheduled: (Date | null)[]) {
  const steps: string[] = []
  let reads = 0
  const run = {
    step: (m: string) => steps.push(m),
    warn: () => {},
    api: {
      call: async (op: string) => {
        if (op !== 'videos') throw new Error(`unexpected ${op}`)
        const at = scheduled[Math.min(reads++, scheduled.length - 1)]
        return [
          {
            videoId: 'abcdefghijk',
            draft: 'DRAFT_STATUS_NONE',
            privacy: 'PRIVATE',
            scheduledAt: at ? String(at.getTime() / 1000) : undefined,
          },
        ]
      },
    },
  } as unknown as DriverRun
  return { run, steps, reads: () => reads }
}

describe('reading a YouTube schedule back', () => {
  const before = new Date('2027-01-23T12:00:00Z')
  const after = new Date('2026-12-12T12:00:00Z')

  it('waits for YouTube’s list to show the new time of a moved video', async () => {
    const l = listing([before, before, after])
    await confirmUpload(l.run, account, 'abcdefghijk', after)
    expect(l.reads()).toBe(3)
    expect(l.steps.at(-1)).toContain('2026-12-12T12:00:00.000Z')
  })

  it('fails without a retry when YouTube keeps the old time', async () => {
    const l = listing([before])
    const err = await confirmUpload(l.run, account, 'abcdefghijk', after).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/2027-01-23T12:00:00.000Z, not 2026-12-12T12:00:00.000Z/)
    expect((err as { retriable?: boolean }).retriable).toBe(false)
  })

  it('accepts a time within five minutes (Studio rounds to its own steps)', async () => {
    const l = listing([new Date(after.getTime() + 60_000)])
    await confirmUpload(l.run, account, 'abcdefghijk', after)
    expect(l.reads()).toBe(1)
  })
})
