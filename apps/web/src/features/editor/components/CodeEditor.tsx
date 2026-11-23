import { html } from '@codemirror/lang-html'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--well)', color: 'var(--ink)', fontSize: '12px', height: '100%' },
    '.cm-content': { fontFamily: 'var(--gl-font-mono)', caretColor: 'var(--signal)', padding: '8px 0' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--ink-4)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--ink) 4%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-2)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--signal-soft) !important',
    },
    '.cm-cursor': { borderLeftColor: 'var(--signal)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--gl-font-mono)', lineHeight: '1.55' },
    '.cm-tooltip': {
      backgroundColor: 'var(--raised)',
      border: '1px solid var(--line-strong)',
      borderRadius: '8px',
    },
    '.cm-foldGutter': { width: '10px' },
  },
  { dark: true },
)

const highlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: '#7fb4ff' },
  { tag: [tags.attributeName, tags.propertyName], color: '#9d8cff' },
  { tag: [tags.string, tags.attributeValue], color: '#42d77b' },
  { tag: [tags.number, tags.unit, tags.bool, tags.null], color: '#f9b73f' },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: '#f75d59' },
  { tag: [tags.comment], color: 'var(--ink-4)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.className], color: '#5ec8c0' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--ink)' },
])

/**
 * The code layer editor (HTML with its CSS and JS). Every change previews live; it is saved after a pause or when
 * the editor loses focus (one op, not one per keystroke).
 */
export function CodeEditor({
  value,
  onPreview,
  onCommit,
  readOnly,
}: {
  value: string
  onPreview: (code: string) => void
  onCommit: (code: string) => void
  readOnly?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cb = useRef({ onPreview, onCommit })
  cb.current = { onPreview, onCommit }
  const last = useRef(value)
  const external = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is created once; later values arrive via the effect below
  useEffect(() => {
    const commit = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      const code = view.current?.state.doc.toString() ?? ''
      if (code !== last.current) {
        last.current = code
        cb.current.onCommit(code)
      }
    }
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          html(),
          theme,
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!!readOnly),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                commit()
                return true
              },
            },
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || external.current) return
            const code = u.state.doc.toString()
            cb.current.onPreview(code)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(commit, 900)
          }),
          EditorView.domEventHandlers({
            blur: () => {
              commit()
              return false
            },
            keydown: (e) => {
              e.stopPropagation()
              return false
            },
          }),
        ],
      }),
    })
    view.current = v
    return () => {
      commit()
      v.destroy()
      view.current = null
    }
  }, [readOnly])

  // External changes (another editor, Claude) replace the text when we are not typing.
  useEffect(() => {
    const v = view.current
    if (!v || v.hasFocus || v.state.doc.toString() === value) return
    last.current = value
    external.current = true
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    external.current = false
  }, [value])

  return (
    <div
      ref={host}
      className="h-[340px] overflow-hidden rounded-[8px] shadow-[inset_0_0_0_1px_var(--line)] [&_.cm-editor]:h-full"
    />
  )
}
