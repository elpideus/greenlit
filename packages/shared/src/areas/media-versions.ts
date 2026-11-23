/**
 * The versions of a media item as a grid: groups of choices that combine (Language: Italiano | English, Watermark:
 * With | Without), each version being one combination with files of its own. The main version (key '') is the
 * combination of every group's first option. Pure functions shared by the server and the web app.
 */

/** A version's option in each group (group key → option key). */
export type VersionValues = Record<string, string>

export interface VersionOptionDef {
  key: string
  label: string
}

export interface VersionGroupDef {
  key: string
  /** What differs between its options ("Language", "Watermark"); '' = unnamed. */
  label: string
  /** The main version's option first. */
  options: VersionOptionDef[]
}

export interface VersionEntry {
  /** '' = the main version. */
  key: string
  values: VersionValues
}

/** A version as stored: rows from before groups have a `label` and no `values`. */
export interface StoredVersion {
  key: string
  label?: string
  values?: VersionValues
}

export interface VersionSet {
  groups: VersionGroupDef[]
  versions: VersionEntry[]
}

/** A URL-safe key from a name: lower case, no accents, never `main`, '' nor one of `taken`. */
export function keyFor(name: string, taken: Iterable<string>, fallback: string): string {
  const base =
    name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34) || fallback
  const used = new Set(taken)
  used.add('main')
  used.add('')
  let key = base
  for (let i = 2; used.has(key); i++) key = `${base}-${i}`
  return key
}

export function sameValues(a: VersionValues, b: VersionValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

/** The version with exactly these options. */
export function findVersion<T extends { values: VersionValues }>(versions: T[], values: VersionValues) {
  return versions.find((v) => sameValues(v.values, values))
}

/**
 * The version closest to `values` that has `option` in `group`: the most other groups in common, earlier options
 * winning ties. Used when the exact combination doesn't exist.
 */
export function nearestVersion<T extends { values: VersionValues }>(
  versions: T[],
  groups: VersionGroupDef[],
  values: VersionValues,
  group: string,
  option: string,
): T | undefined {
  let best: T | undefined
  let bestScore = -1
  for (const v of versions) {
    if (v.values[group] !== option) continue
    let score = 0
    for (const g of groups) if (g.key !== group && v.values[g.key] === values[g.key]) score++
    if (score > bestScore) {
      best = v
      bestScore = score
    }
  }
  return best
}

/** A version's name: its options' names, group by group ("English · Without watermark"). */
export function versionName(groups: VersionGroupDef[], values: VersionValues): string {
  return groups
    .map((g) => g.options.find((o) => o.key === values[g.key])?.label)
    .filter(Boolean)
    .join(' · ')
}

/**
 * Reads what an item stores. Items from before groups (a flat list of named versions) get one unnamed group with
 * an option per version.
 */
export function readVersionSet(stored: StoredVersion[], groups: VersionGroupDef[]): VersionSet {
  if (stored.length < 2) return { groups: [], versions: [] }
  if (groups.length && stored.every((v) => v.values)) {
    return {
      groups: groups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o })) })),
      versions: stored.map((v) => ({ key: v.key, values: { ...v.values } })),
    }
  }
  const options: VersionOptionDef[] = []
  // The main version first, whatever the stored order.
  const flat = [...stored].sort((a, b) => (a.key === '' ? -1 : b.key === '' ? 1 : 0))
  for (const v of flat) {
    options.push({
      key: keyFor(
        v.label ?? v.key,
        options.map((o) => o.key),
        'version',
      ),
      label: v.label ?? v.key,
    })
  }
  return {
    groups: [{ key: 'version', label: '', options }],
    versions: flat.map((v, i) => ({ key: v.key, values: { version: options[i]!.key } })),
  }
}

/**
 * Tidies a set after a change: options no version uses go, a group left with one option goes (it no longer tells
 * versions apart), and an item left with one version has none. Versions come out in grid order, the main one first.
 */
export function pruneVersionSet(set: VersionSet): VersionSet {
  const groups = set.groups
    .map((g) => ({
      ...g,
      options: g.options.filter((o) => set.versions.some((v) => v.values[g.key] === o.key)),
    }))
    .filter((g) => g.options.length > 1)
  const keep = new Set(groups.map((g) => g.key))
  const versions = set.versions.map((v) => ({
    key: v.key,
    values: Object.fromEntries(Object.entries(v.values).filter(([k]) => keep.has(k))),
  }))
  if (versions.length < 2 || !groups.length) return { groups: [], versions: [] }
  const rank = (v: VersionEntry) => groups.map((g) => g.options.findIndex((o) => o.key === v.values[g.key]))
  versions.sort((a, b) => {
    if (a.key === '') return -1
    if (b.key === '') return 1
    const ra = rank(a)
    const rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!
    return 0
  })
  return { groups, versions }
}
