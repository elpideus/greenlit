export { aspectLabel, formatBytes, formatDuration, formatTimecode } from '@greenlit/shared'

/** 1234 → "1.2K" */
export function compactNumber(n: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** "3 items" / "1 item" without i18n plural machinery for meta lines. */
export function plural(n: number, one: string, many: string) {
  return `${new Intl.NumberFormat().format(n)} ${n === 1 ? one : many}`
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase() || '?'
}
