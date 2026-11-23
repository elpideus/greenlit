import type { MediaFormat } from '@greenlit/shared'

/** How the viewer shows a text file: Markdown and HTML rendered (their source a click away), the rest as code. */
export type TextPreview = { kind: 'markdown' } | { kind: 'html' } | { kind: 'code'; lang: string | null }

/** Extension → language (see languages.ts); null = plain text with line numbers. */
const BY_EXT: Record<string, string | null> = {
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  ipy: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  webmanifest: 'json',
  geojson: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  xml: 'xml',
  xsl: 'xml',
  plist: 'xml',
  rss: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  toml: 'toml',
  ini: 'properties',
  cfg: 'properties',
  conf: 'properties',
  env: 'properties',
  properties: 'properties',
  diff: 'diff',
  patch: 'diff',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  lua: 'lua',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  dart: 'dart',
  scala: 'scala',
  r: 'r',
  pl: 'perl',
  pm: 'perl',
  ps1: 'powershell',
  txt: null,
  text: null,
  log: null,
  csv: null,
  tsv: null,
  srt: null,
  vtt: null,
  cube: null,
  gpl: null,
  // Small subtitle and LUT formats are text too.
  '3dl': null,
}
const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'shell',
  '.gitignore': 'properties',
  '.env': 'properties',
}

export function textPreview(f: Pick<MediaFormat, 'filename' | 'mime'>): TextPreview | null {
  const name = f.filename.toLowerCase()
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  const mime = f.mime.split(';')[0]!.trim()
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx' || mime === 'text/markdown')
    return { kind: 'markdown' }
  if (ext === 'html' || ext === 'htm' || mime === 'text/html') return { kind: 'html' }
  if (ext in BY_EXT) return { kind: 'code', lang: BY_EXT[ext]! }
  if (name in BY_NAME) return { kind: 'code', lang: BY_NAME[name]! }
  if (mime === 'application/json') return { kind: 'code', lang: 'json' }
  if (mime === 'application/xml' || mime === 'text/xml') return { kind: 'code', lang: 'xml' }
  if (mime === 'text/javascript' || mime === 'application/javascript')
    return { kind: 'code', lang: 'javascript' }
  if (mime === 'text/x-python' || mime === 'text/x-script.python') return { kind: 'code', lang: 'python' }
  if (mime.startsWith('text/')) return { kind: 'code', lang: null }
  return null
}

/** What the language bar calls each language. */
export const LANGUAGE_NAMES: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  typescript: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  xml: 'XML',
  markdown: 'Markdown',
  yaml: 'YAML',
  sql: 'SQL',
  shell: 'Shell',
  toml: 'TOML',
  properties: 'INI',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
  go: 'Go',
  rust: 'Rust',
  ruby: 'Ruby',
  lua: 'Lua',
  swift: 'Swift',
  kotlin: 'Kotlin',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  dart: 'Dart',
  scala: 'Scala',
  r: 'R',
  perl: 'Perl',
  powershell: 'PowerShell',
}
