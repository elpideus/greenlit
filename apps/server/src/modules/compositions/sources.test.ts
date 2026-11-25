import {
  type Asset,
  applyOps,
  type ClipInput,
  type Composition,
  emptyComposition,
  FORMAT_SIZES,
} from '@greenlit/composition'
import type { EntityRef, LinkRelation } from '@greenlit/shared'
import { describe, expect, it } from 'vitest'
import { staleLinks } from '../links/module.ts'
import { linkSources, sourceMediaIds } from './sources.ts'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const DRONE = id(1)
const INTERIOR = id(2)
const MUSIC = id(3)
const LOGO = id(4) // a file of the "Acme Studio" brand kit
const UNUSED = id(5)
const OUTPUT = id(9)
const KIT = new Set([LOGO])

const asset = (a: Partial<Asset> & Pick<Asset, 'id' | 'mediaId' | 'kind'>): Asset => ({
  name: '',
  duration: 20,
  width: 1920,
  height: 1080,
  hasAudio: false,
  ...a,
})

/** A 16:9 + 9:16 edit: drone and interior shots, music, the logo on top, and a shot left in the bin. */
function edit(extra: (doc: Composition) => Composition = (d) => d) {
  let doc = emptyComposition([{ ...FORMAT_SIZES.landscape }, { ...FORMAT_SIZES.vertical }], 30, 20)
  const clip = (c: Partial<ClipInput> & Pick<ClipInput, 'id' | 'type'>): ClipInput => ({
    start: 0,
    duration: 5,
    ...c,
  })
  doc = applyOps(doc, [
    { op: 'add_asset', asset: asset({ id: 'a-drone', mediaId: DRONE, kind: 'video', hasAudio: true }) },
    { op: 'add_asset', asset: asset({ id: 'a-int', mediaId: INTERIOR, kind: 'image' }) },
    { op: 'add_asset', asset: asset({ id: 'a-music', mediaId: MUSIC, kind: 'audio' }) },
    { op: 'add_asset', asset: asset({ id: 'a-logo', mediaId: LOGO, kind: 'image' }) },
    { op: 'add_asset', asset: asset({ id: 'a-unused', mediaId: UNUSED, kind: 'image' }) },
    // emptyComposition has v1 (visual) and a1 (audio)
    { op: 'add_track', track: { id: 'v2', kind: 'visual' } },
    { op: 'add_clip', trackId: 'v1', clip: clip({ id: 'drone', type: 'video', assetId: 'a-drone' }) },
    { op: 'add_clip', trackId: 'v1', clip: clip({ id: 'int', type: 'image', assetId: 'a-int', start: 5 }) },
    // the same shot again later: still one source
    {
      op: 'add_clip',
      trackId: 'v1',
      clip: clip({ id: 'drone2', type: 'video', assetId: 'a-drone', start: 10 }),
    },
    { op: 'add_clip', trackId: 'v2', clip: clip({ id: 'logo', type: 'image', assetId: 'a-logo' }) },
    { op: 'add_clip', trackId: 'v2', clip: clip({ id: 'title', type: 'text', text: { content: 'Trullo' } }) },
    {
      op: 'add_clip',
      trackId: 'a1',
      clip: clip({ id: 'music', type: 'audio', assetId: 'a-music', duration: 20 }),
    },
  ])
  return extra(doc)
}

const patch = (doc: Composition, clipId: string, p: Record<string, unknown>) =>
  applyOps(doc, [{ op: 'update_clip', id: clipId, patch: p }])
const setTrack = (doc: Composition, trackId: string, p: Record<string, unknown>) =>
  applyOps(doc, [{ op: 'update_track', id: trackId, patch: p }])

describe('the media an export is made of', () => {
  it('is every library item a clip draws or plays, once each, and nothing left in the bin', () => {
    expect(sourceMediaIds(edit()).sort()).toEqual([DRONE, INTERIOR, MUSIC, LOGO].sort())
  })

  it('leaves out what the export leaves out: hidden clips and tracks, muted sound, clips after the end', () => {
    expect(sourceMediaIds(edit((d) => patch(d, 'int', { hidden: true })))).not.toContain(INTERIOR)
    expect(sourceMediaIds(edit((d) => setTrack(d, 'v2', { hidden: true })))).not.toContain(LOGO)
    expect(sourceMediaIds(edit((d) => setTrack(d, 'a1', { muted: true })))).not.toContain(MUSIC)
    expect(sourceMediaIds(edit((d) => patch(d, 'music', { audio: { muted: true } })))).not.toContain(MUSIC)
    // a 4.9 s export ends before the interior shot (at 5 s) begins
    expect(sourceMediaIds(edit((d) => ({ ...d, duration: 4.9 })))).not.toContain(INTERIOR)
    // hidden in both formats → not seen; hidden in one → still in the other format
    const hiddenIn = (formats: string[]) => (d: Composition) =>
      patch(d, 'int', { formats: Object.fromEntries(formats.map((f) => [f, { hidden: true }])) })
    expect(sourceMediaIds(edit(hiddenIn(['main', 'vertical'])))).not.toContain(INTERIOR)
    expect(sourceMediaIds(edit(hiddenIn(['vertical'])))).toContain(INTERIOR)
  })

  it('counts a video on a hidden track when its sound is still heard', () => {
    const both = edit((d) => setTrack(d, 'v1', { hidden: true }))
    expect(sourceMediaIds(both)).toContain(DRONE) // video with sound: heard
    expect(sourceMediaIds(both)).not.toContain(INTERIOR) // a picture: only seen
    const silent = edit((d) => setTrack(setTrack(d, 'v1', { hidden: true }), 'v1', { muted: true }))
    expect(sourceMediaIds(silent)).not.toContain(DRONE)
  })
})

/** The links table as far as `syncAutoInto` goes: unique (from, relation, to), people's links and Greenlit's own. */
class LinkTable {
  rows: { from: string; relation: LinkRelation; to: string; auto: boolean }[] = []
  private key = (r: EntityRef) => `${r.type}:${r.id}`

  add(from: EntityRef, relation: LinkRelation, to: EntityRef, auto: boolean) {
    const row = { from: this.key(from), relation, to: this.key(to), auto }
    if (!this.rows.some((r) => r.from === row.from && r.relation === relation && r.to === row.to))
      this.rows.push(row)
  }

  syncAutoInto = async (to: EntityRef, relation: LinkRelation, from: EntityRef[]) => {
    const mine = this.rows
      .filter((r) => r.to === this.key(to) && r.relation === relation && r.auto)
      .map((r) => {
        const [type, otherId] = r.from.split(':') as [string, string]
        return { row: r, type, otherId }
      })
    const stale = new Set(staleLinks(mine, from).map((e) => e.row))
    this.rows = this.rows.filter((r) => !stale.has(r))
    for (const f of from) this.add(f, relation, to, true)
  }

  /** "Made from" on the export: the sources linked to it. */
  madeFrom(output: string) {
    return this.rows
      .filter((r) => r.to === `media:${output}` && r.relation === 'source_of')
      .map((r) => r.from.slice('media:'.length))
      .sort()
  }
}

describe('linking an export to its sources', () => {
  const deps = (links: LinkTable) => ({
    links,
    material: async (ids: string[]) => ids.filter((m) => !KIT.has(m)),
  })

  it('links every source as "source of" the export, leaving the brand kit out', async () => {
    const links = new LinkTable()
    const linked = await linkSources(deps(links), OUTPUT, edit())
    expect(linked.sort()).toEqual([DRONE, INTERIOR, MUSIC].sort())
    expect(links.madeFrom(OUTPUT)).toEqual([DRONE, INTERIOR, MUSIC].sort())
    expect(links.rows.every((r) => r.auto && r.relation === 'source_of')).toBe(true)
    expect(links.rows.some((r) => r.from === `media:${LOGO}`)).toBe(false)
  })

  it('on a re-export, adds nothing twice and drops media the edit no longer uses', async () => {
    const links = new LinkTable()
    await linkSources(deps(links), OUTPUT, edit())
    await linkSources(deps(links), OUTPUT, edit())
    expect(links.rows).toHaveLength(3)
    // The interior shot is taken out and the unused shot goes in its place.
    const changed = edit((d) =>
      applyOps(d, [
        { op: 'remove_clip', id: 'int' },
        {
          op: 'add_clip',
          trackId: 'v1',
          clip: { id: 'new', type: 'image', assetId: 'a-unused', start: 5, duration: 5 },
        },
      ]),
    )
    await linkSources(deps(links), OUTPUT, changed)
    expect(links.madeFrom(OUTPUT)).toEqual([DRONE, MUSIC, UNUSED].sort())
  })

  it("keeps people's own links and other relations, and never links the export to itself", async () => {
    const links = new LinkTable()
    links.add({ type: 'media', id: INTERIOR }, 'source_of', { type: 'media', id: OUTPUT }, false)
    links.add({ type: 'composition', id: id(7) }, 'rendered_to', { type: 'media', id: OUTPUT }, true)
    // An edit that uses its own earlier export (and nothing else of the interior shot).
    const selfUse = edit((d) =>
      applyOps(d, [
        { op: 'add_asset', asset: asset({ id: 'a-self', mediaId: OUTPUT, kind: 'video' }) },
        { op: 'remove_clip', id: 'int' },
        {
          op: 'add_clip',
          trackId: 'v1',
          clip: { id: 'self', type: 'video', assetId: 'a-self', start: 5, duration: 5 },
        },
      ]),
    )
    await linkSources(deps(links), OUTPUT, selfUse)
    expect(links.rows.some((r) => r.from === `media:${OUTPUT}`)).toBe(false)
    // the interior link was made by a person: it stays although the edit doesn't use the shot any more
    expect(links.madeFrom(OUTPUT)).toEqual([DRONE, INTERIOR, MUSIC].sort())
    expect(links.rows.some((r) => r.relation === 'rendered_to')).toBe(true)
  })
})
