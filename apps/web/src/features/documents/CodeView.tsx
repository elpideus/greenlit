import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { languageFor } from './languages'

/**
 * A text file shown as code: line numbers, folding, search (Ctrl/⌘ F), selection and copy; nothing can be typed.
 * Highlighting follows the light or dark mode the app is in.
 */
export function CodeView({ text, lang, wrap }: { text: string; lang: string | null; wrap: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const parts = useRef({ lang: new Compartment(), wrap: new Compartment(), colors: new Compartment() })
  const mode = useDocumentMode()

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is made once per text; the rest is reconfigured below
  useEffect(() => {
    const c = parts.current
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          EditorState.readOnly.of(true),
          theme,
          c.colors.of(syntaxHighlighting(dark)),
          c.wrap.of(wrap ? EditorView.lineWrapping : []),
          c.lang.of([]),
          // The viewer's shortcuts (arrows, space) stay with the viewer unless the code has the focus.
          EditorView.domEventHandlers({ keydown: (e) => e.stopPropagation() }),
        ],
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [text])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text means a new view, which needs its language again
  useEffect(() => {
    let live = true
    void languageFor(lang).then((ext) => {
      if (live && view.current) view.current.dispatch({ effects: parts.current.lang.reconfigure(ext ?? []) })
    })
    return () => {
      live = false
    }
  }, [lang, text])

  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  // The viewer may stay dark while the app is light: the colours follow the surface the code is drawn on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mode` and `text` say when to look again
  useEffect(() => {
    const el = view.current?.dom
    if (!el) return
    const onDark = isDark(getComputedStyle(el).backgroundColor) ?? mode === 'dark'
    view.current?.dispatch({
      effects: parts.current.colors.reconfigure(syntaxHighlighting(onDark ? dark : light)),
    })
  }, [mode, text])

  return <div ref={host} className="size-full overflow-hidden [&_.cm-editor]:h-full" />
}

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--panel)', color: 'var(--ink)', fontSize: '12.5px', height: '100%' },
  '.cm-content': { fontFamily: 'var(--gl-font-mono)', padding: '12px 0', caretColor: 'var(--ink-3)' },
  '.cm-scroller': { fontFamily: 'var(--gl-font-mono)', lineHeight: '1.6' },
  '.cm-gutters': {
    backgroundColor: 'var(--panel)',
    color: 'var(--ink-4)',
    border: 'none',
    paddingLeft: '6px',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--ink) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-2)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--cue) 28%, transparent) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklab, var(--review) 22%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklab, var(--review) 30%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklab, var(--review) 55%, transparent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--well)', border: 'none', color: 'var(--ink-3)' },
  '.cm-panels': { backgroundColor: 'var(--raised)', color: 'var(--ink)', borderColor: 'var(--line)' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'var(--gl-font-ui)', fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--well)',
    border: '1px solid var(--line-strong)',
    borderRadius: '6px',
    color: 'var(--ink)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--raised)',
    border: '1px solid var(--line-strong)',
    borderRadius: '6px',
    color: 'var(--ink)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--raised)',
    border: '1px solid var(--line-strong)',
    borderRadius: '8px',
  },
})

// Syntax colours are part of the file being read, not of Greenlit's chrome: one set per mode, tuned for contrast.
const style = (c: Record<string, string>) =>
  HighlightStyle.define([
    {
      tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier, tags.definitionKeyword],
      color: c.keyword,
    },
    { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.attributeValue], color: c.string },
    { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit], color: c.number },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
      color: c.comment,
      fontStyle: 'italic',
    },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: c.fn },
    { tag: [tags.className, tags.typeName, tags.namespace, tags.standard(tags.variableName)], color: c.type },
    { tag: [tags.tagName, tags.angleBracket], color: c.tag },
    { tag: [tags.attributeName, tags.propertyName], color: c.attr },
    { tag: [tags.meta, tags.annotation, tags.processingInstruction], color: c.meta },
    { tag: [tags.heading], color: c.keyword, fontWeight: '600' },
    { tag: [tags.link, tags.url], color: c.string, textDecoration: 'underline' },
    { tag: [tags.emphasis], fontStyle: 'italic' },
    { tag: [tags.strong], fontWeight: '600' },
    { tag: [tags.inserted], color: c.inserted },
    { tag: [tags.deleted], color: c.keyword },
    { tag: [tags.invalid], color: c.keyword, textDecoration: 'underline wavy' },
  ])
const dark = style({
  keyword: '#ff7b72',
  string: '#a5d6ff',
  number: '#79c0ff',
  comment: '#8b949e',
  fn: '#d2a8ff',
  type: '#ffa657',
  tag: '#7ee787',
  attr: '#79c0ff',
  meta: '#ffa657',
  inserted: '#7ee787',
})
const light = style({
  keyword: '#cf222e',
  string: '#0a3069',
  number: '#0550ae',
  comment: '#6e7781',
  fn: '#8250df',
  type: '#953800',
  tag: '#116329',
  attr: '#0550ae',
  meta: '#953800',
  inserted: '#116329',
})

/** Is this computed colour (rgb(), or color(srgb …)) dark? Null when it can't tell. */
function isDark(css: string) {
  const n = css.match(/[\d.]+/g)?.map(Number)
  if (!n || n.length < 3) return null
  const scale = css.startsWith('color(') ? 1 : 255
  const [r, g, b] = n.map((v) => v / scale) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
}

/** The mode the app is drawn in right now (`data-theme-mode` on the document). */
function useDocumentMode() {
  return useSyncExternalStore(
    (cb) => {
      const mo = new MutationObserver(cb)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
      return () => mo.disconnect()
    },
    () => (document.documentElement.dataset.themeMode === 'light' ? 'light' : 'dark'),
  )
}
