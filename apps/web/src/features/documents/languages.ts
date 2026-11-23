import type { StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

/** A language's highlighting, loaded only when a file in it is opened. */
export async function languageFor(lang: string | null): Promise<Extension | null> {
  if (!lang) return null
  // Languages CodeMirror has as stream modes (shell, TOML, Go…): the same highlighting, a simpler parser.
  const legacy = async <S>(load: () => Promise<StreamParser<S>>) => {
    const { StreamLanguage } = await import('@codemirror/language')
    return StreamLanguage.define(await load())
  }
  switch (lang) {
    case 'python':
      return (await import('@codemirror/lang-python')).python()
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript()
    case 'jsx':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true })
    case 'tsx':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true })
    case 'json':
      return (await import('@codemirror/lang-json')).json()
    case 'css':
      return (await import('@codemirror/lang-css')).css()
    case 'html':
      return (await import('@codemirror/lang-html')).html()
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml()
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql()
    case 'shell':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell)
    case 'toml':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml)
    case 'properties':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/properties')).properties)
    case 'diff':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/diff')).diff)
    case 'dockerfile':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile)
    case 'go':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/go')).go)
    case 'rust':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/rust')).rust)
    case 'ruby':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/ruby')).ruby)
    case 'lua':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/lua')).lua)
    case 'swift':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/swift')).swift)
    case 'r':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/r')).r)
    case 'perl':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/perl')).perl)
    case 'powershell':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/powershell')).powerShell)
    case 'kotlin':
    case 'java':
    case 'c':
    case 'cpp':
    case 'csharp':
    case 'dart':
    case 'scala': {
      const m = await import('@codemirror/legacy-modes/mode/clike')
      return legacy(async () => m[lang])
    }
    default:
      return null
  }
}
