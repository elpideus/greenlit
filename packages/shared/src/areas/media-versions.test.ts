import { describe, expect, it } from 'vitest'
import {
  findVersion,
  keyFor,
  nearestVersion,
  pruneVersionSet,
  readVersionSet,
  type VersionSet,
  versionName,
} from './media-versions.ts'

const grid = (): VersionSet => ({
  groups: [
    {
      key: 'language',
      label: 'Language',
      options: [
        { key: 'italiano', label: 'Italiano' },
        { key: 'english', label: 'English' },
      ],
    },
    {
      key: 'watermark',
      label: 'Watermark',
      options: [
        { key: 'with', label: 'With watermark' },
        { key: 'without', label: 'Without watermark' },
      ],
    },
  ],
  versions: [
    { key: '', values: { language: 'italiano', watermark: 'with' } },
    { key: 'english', values: { language: 'english', watermark: 'with' } },
    { key: 'italiano-without', values: { language: 'italiano', watermark: 'without' } },
  ],
})

describe('media versions', () => {
  it('reads a flat list from before groups as one unnamed group', () => {
    const set = readVersionSet(
      [
        { key: 'english', label: 'English' },
        { key: '', label: 'Italiano' },
      ],
      [],
    )
    expect(set.groups).toEqual([
      {
        key: 'version',
        label: '',
        options: [
          { key: 'italiano', label: 'Italiano' },
          { key: 'english', label: 'English' },
        ],
      },
    ])
    expect(set.versions).toEqual([
      { key: '', values: { version: 'italiano' } },
      { key: 'english', values: { version: 'english' } },
    ])
  })

  it('has no versions while an item has one', () => {
    expect(readVersionSet([], [])).toEqual({ groups: [], versions: [] })
    expect(readVersionSet([{ key: '', label: 'Original' }], [])).toEqual({ groups: [], versions: [] })
  })

  it('names a version by its choices and finds combinations', () => {
    const set = grid()
    expect(versionName(set.groups, set.versions[2]!.values)).toBe('Italiano · Without watermark')
    expect(findVersion(set.versions, { watermark: 'with', language: 'english' })?.key).toBe('english')
    expect(findVersion(set.versions, { language: 'english', watermark: 'without' })).toBeUndefined()
  })

  it('takes the nearest version when a combination is missing', () => {
    const set = grid()
    // On English · With, "Without" exists only in Italian.
    const near = nearestVersion(set.versions, set.groups, set.versions[1]!.values, 'watermark', 'without')
    expect(near?.key).toBe('italiano-without')
  })

  it('drops options nobody uses and groups that no longer tell versions apart', () => {
    const set = grid()
    // Removing the only version without the watermark: the Watermark group goes.
    set.versions = set.versions.filter((v) => v.key !== 'italiano-without')
    const pruned = pruneVersionSet(set)
    expect(pruned.groups.map((g) => g.key)).toEqual(['language'])
    expect(pruned.versions).toEqual([
      { key: '', values: { language: 'italiano' } },
      { key: 'english', values: { language: 'english' } },
    ])
    // One version left is a plain item again.
    pruned.versions = pruned.versions.filter((v) => v.key === '')
    expect(pruneVersionSet(pruned)).toEqual({ groups: [], versions: [] })
  })

  it('keeps versions in grid order with the main one first', () => {
    const set = grid()
    set.versions.push({ key: 'english-without', values: { language: 'english', watermark: 'without' } })
    set.versions.reverse()
    expect(pruneVersionSet(set).versions.map((v) => v.key)).toEqual([
      '',
      'italiano-without',
      'english',
      'english-without',
    ])
  })

  it('makes keys without accents, never main or taken', () => {
    expect(keyFor('Più luce · Senza logo', [], 'x')).toBe('piu-luce-senza-logo')
    expect(keyFor('Main', [], 'x')).toBe('main-2')
    expect(keyFor('English', ['english'], 'x')).toBe('english-2')
    expect(keyFor('···', [], 'version')).toBe('version')
  })
})
