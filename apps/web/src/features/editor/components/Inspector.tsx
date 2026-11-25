import {
  type Asset,
  type Clip,
  type Composition,
  type Easing,
  forFormat,
  type Keyframe,
  type Op,
  type OutputFormat,
} from '@greenlit/composition'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Diamond,
  Plus,
  ScanFace,
  Trash2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useMediaItem } from '@/data/media'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { Button, IconButton, InlineEdit, Menu, Textarea, Toggle, toast } from '@/ui'
import { compositionApi, PRESETS } from '../api'
import { findClip, keyAtPlayhead, keyframesFor, round, setProp, toggleKeyframe, valueAt } from '../edits'
import { FONT_CHOICES } from '../fonts'
import { currentFormat, dispatch, editingOverride, preview, useDoc, useEditor } from '../store'
import { AspectBox } from './AspectBox'
import { CodeEditor } from './CodeEditor'
import { clipLabel, TYPE_LOOK } from './clipLook'
import { Choice, ColorField, FieldRow, Group, MiniSelect, NumberField } from './fields'

const get = useEditor.getState

const EASINGS: Easing[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'expo-out',
  'back-out',
  'spring',
  'hold',
]
const TRANSITIONS = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'zoom-in',
  'zoom-out',
  'blur',
  'wipe-left',
  'wipe-right',
  'iris',
] as const
const TEXT_PRESETS = [
  'none',
  'fade',
  'rise',
  'drop',
  'pop',
  'typewriter',
  'blur',
  'slide-left',
  'slide-right',
  'scale-up',
  'wipe',
] as const
const BLENDS = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
] as const
const pretty = (s: string) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Shared editing helpers for one clip at the playhead. */
function useProp(clip: Clip, format: OutputFormat) {
  const time = useEditor((s) => s.time)
  const doc = useEditor((s) => s.doc)
  const design = doc?.formats[0]?.id ?? 'main'
  return {
    time,
    value: (path: string) => valueAt(clip, path, time, format),
    num: (path: string) => {
      const v = valueAt(clip, path, time, format)
      return typeof v === 'number' ? v : undefined
    },
    str: (path: string) => {
      const v = valueAt(clip, path, time, format)
      return typeof v === 'string' ? v : undefined
    },
    commit: (path: string, value: unknown, label = 'Change') => {
      const d = get().doc
      if (d) dispatch(setProp(d, clip.id, path, value, get().time, format.id), { label })
    },
    preview: (path: string, value: unknown | null) => {
      const d = get().doc
      if (!d) return
      preview(value === null ? null : setProp(d, clip.id, path, value, get().time, format.id))
    },
    patch: (patch: Record<string, unknown>, label = 'Change') =>
      dispatch([{ op: 'update_clip', id: clip.id, patch }], { label }),
    animated: (path: string) => keyframesFor(clip, path, format.id, design).length > 0,
    keyHere: (path: string) => keyAtPlayhead(clip, path, time, format.id, design),
    keys: (path: string) => keyframesFor(clip, path, format.id, design),
    toggleKey: (path: string) => {
      const d = get().doc
      if (d) dispatch(toggleKeyframe(d, clip.id, path, get().time, format), { label: 'Keyframe' })
    },
  }
}
type PropApi = ReturnType<typeof useProp>

export function Inspector() {
  const t = useT('editor')
  const doc = useDoc()
  const selection = useEditor((s) => s.selection)
  const formatId = useEditor((s) => s.formatId)
  if (!doc) return null
  const format = currentFormat({ doc, draft: null, formatId })
  const found = selection.length === 1 ? findClip(doc, selection[0]!) : null
  if (selection.length > 1)
    return (
      <div className="px-4 py-10 text-center t-callout text-ink-3">
        {t('inspector.many', { count: selection.length })}
      </div>
    )
  if (!found) return <EditSettings doc={doc} />
  return <ClipInspector key={found.clip.id} clip={found.clip} format={format} doc={doc} />
}

function ClipInspector({ clip, format, doc }: { clip: Clip; format: OutputFormat; doc: Composition }) {
  const t = useT('editor')
  const p = useProp(clip, format)
  const override = useEditor((s) => editingOverride(s))
  const readOnly = useEditor((s) => s.readOnly)
  const asset = clip.assetId ? doc.assets[clip.assetId] : undefined
  const look = TYPE_LOOK[clip.type]
  const Icon = look.icon
  const visual = clip.type !== 'audio'
  const hasOverride = !!clip.formats?.[format.id]
  return (
    <fieldset disabled={readOnly} className="min-w-0">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-[7px]"
          style={{ background: `color-mix(in oklab, ${look.tint} 24%, transparent)`, color: look.tint }}
        >
          <Icon size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <InlineEdit
            value={clipLabel(clip, asset)}
            onSave={(name) => p.patch({ name }, 'Rename')}
            className="block t-callout font-[600] text-ink"
            tooltip={null}
          />
          <div className="t-micro text-ink-3">
            {pretty(clip.type)}
            {asset ? ` · ${asset.name}` : ''}
          </div>
        </div>
        {override && hasOverride && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => p.patch({ formats: { [format.id]: null } }, 'Reset framing')}
            title={t('inspector.resetOverride', { format: doc.formats[0]?.name })}
          >
            <X size={12} /> {format.name}
          </Button>
        )}
      </div>

      {asset && <VersionGroup clip={clip} asset={asset} />}

      <Group id="timing" title={t('inspector.timing')}>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField
            label={t('inspector.start')}
            value={clip.start}
            step={1 / doc.fps}
            digits={2}
            min={0}
            unit="s"
            onCommit={(v) => dispatch([{ op: 'move_clip', id: clip.id, start: round(v) }], { label: 'Move' })}
          />
          <NumberField
            label={t('inspector.duration')}
            value={clip.duration}
            step={1 / doc.fps}
            digits={2}
            min={0.04}
            unit="s"
            onCommit={(v) => p.patch({ duration: round(v) }, 'Trim')}
          />
          {asset && clip.type !== 'image' && (
            <>
              <NumberField
                label={t('inspector.in')}
                value={clip.in}
                step={1 / doc.fps}
                digits={2}
                min={0}
                unit="s"
                onCommit={(v) => p.patch({ in: round(v) }, 'Trim')}
              />
              <NumberField
                label={t('inspector.speed')}
                value={clip.speed}
                step={0.01}
                digits={2}
                min={0.1}
                max={16}
                unit="×"
                onCommit={(v) => p.patch({ speed: v }, 'Speed')}
              />
            </>
          )}
        </div>
      </Group>

      {visual && <TransformGroup p={p} clip={clip} format={format} override={override} />}
      {(clip.type === 'video' || clip.type === 'image') && (
        <FramingGroup p={p} clip={clip} format={format} override={override} />
      )}
      {clip.type === 'text' && <TextGroup p={p} clip={clip} />}
      {clip.type === 'shape' && <ShapeGroup p={p} clip={clip} />}
      {clip.type === 'solid' && (
        <Group id="solid" title={t('inspector.solid')}>
          <FieldRow label={t('inspector.fillColor')}>
            <ColorField value={clip.fill} onCommit={(v) => p.patch({ fill: v }, 'Colour')} />
          </FieldRow>
        </Group>
      )}
      {clip.type === 'html' && <CodeGroup p={p} clip={clip} />}
      {visual && <StyleGroup p={p} clip={clip} />}
      {(clip.type === 'audio' || clip.type === 'video') && <AudioGroup p={p} clip={clip} />}
      {visual && <TransitionGroup clip={clip} />}
      <AnimationGroup p={p} clip={clip} format={format} doc={doc} />
    </fieldset>
  )
}

/**
 * Makes a media clip play another version of its item. Other clips of the same asset keep theirs; an asset of the
 * edit that already plays that version is reused, and the old one goes when no clip uses it any more.
 */
async function switchVersion(clip: Clip, asset: Asset, version: string) {
  const s = get()
  if (!s.id || !s.doc || s.readOnly || (asset.version ?? '') === version) return
  const ops: Op[] = []
  let next = Object.values(s.doc.assets).find(
    (a) => a.mediaId === asset.mediaId && (a.version ?? '') === version && a.formatKey === asset.formatKey,
  )
  if (!next) {
    try {
      ;[next] = await compositionApi.assets(s.id, [
        { mediaId: asset.mediaId, formatKey: asset.formatKey, ...(version ? { version } : {}) },
      ])
    } catch (err) {
      toast.error(err)
      return
    }
    if (!next) return
    ops.push({ op: 'add_asset', asset: next })
  }
  ops.push({ op: 'update_clip', id: clip.id, patch: { assetId: next.id } })
  const doc = get().doc
  if (!doc?.tracks.some((tr) => tr.clips.some((c) => c.id !== clip.id && c.assetId === asset.id)))
    ops.push({ op: 'remove_asset', id: asset.id })
  dispatch(ops, { label: 'Version' })
}

/** Which version of its item a media clip plays, when the item has several. */
function VersionGroup({ clip, asset }: { clip: Clip; asset: Asset }) {
  const t = useT('editor')
  const { data: media } = useMediaItem(asset.mediaId)
  if (!media || media.versions.length < 2) return null
  const current = asset.version ?? ''
  const known = media.versions.some((v) => v.key === current)
  return (
    <Group id="source" title={t('inspector.source')}>
      <FieldRow label={t('inspector.version')} hint={known ? undefined : t('inspector.versionGone')}>
        <MiniSelect
          value={known ? current : ''}
          options={media.versions.map((v) => ({
            value: v.key,
            label: v.key ? v.label : v.label ? `${v.label} · ${t('bin.mainVersion')}` : t('bin.mainVersion'),
          }))}
          onChange={(v) => void switchVersion(clip, asset, v)}
        />
      </FieldRow>
    </Group>
  )
}

/** A number field with a keyframe diamond: hollow = not animated, half = animated, filled = a key here. */
function KeyedNumber({
  p,
  path,
  label,
  step = 1,
  digits = 0,
  min,
  max,
  unit,
  scale = 1,
}: {
  p: PropApi
  path: string
  label: ReactNode
  step?: number
  digits?: number
  min?: number
  max?: number
  unit?: string
  /** Display multiplier (opacity 0..1 shown as %). */
  scale?: number
}) {
  const t = useT('editor')
  const v = p.num(path)
  return (
    <NumberField
      label={label}
      value={v === undefined ? undefined : v * scale}
      step={step}
      digits={digits}
      min={min}
      max={max}
      unit={unit}
      onPreview={(x) => p.preview(path, x === null ? null : x / scale)}
      onCommit={(x) => p.commit(path, round(x / scale))}
      trailing={
        <button
          type="button"
          onClick={() => p.toggleKey(path)}
          title={p.keyHere(path) ? t('inspector.removeKey') : t('inspector.addKey')}
          className={cn(
            'press mr-1 grid size-5 shrink-0 place-items-center rounded-[4px] hover:bg-hover',
            p.animated(path) ? 'text-review' : 'text-ink-4 opacity-0 group-hover:opacity-100',
          )}
        >
          <Diamond size={10} strokeWidth={2.4} fill={p.keyHere(path) ? 'currentColor' : 'none'} />
        </button>
      }
    />
  )
}

function TransformGroup({
  p,
  clip,
  format,
  override,
}: {
  p: PropApi
  clip: Clip
  format: OutputFormat
  override: boolean
}) {
  const t = useT('editor')
  const eff = forFormat(clip, format.id)
  return (
    <Group
      id="transform"
      title={t('inspector.transform')}
      aside={
        override && clip.formats?.[format.id]?.transform ? (
          <span className="rounded-[4px] bg-cue-soft px-1.5 py-px t-micro text-cue">
            {t('inspector.overrideBadge', { format: format.name })}
          </span>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-1.5">
        <KeyedNumber p={p} path="transform.x" label={t('inspector.x')} unit="px" />
        <KeyedNumber p={p} path="transform.y" label={t('inspector.y')} unit="px" />
        <KeyedNumber p={p} path="transform.width" label={t('inspector.width')} unit="px" min={1} />
        <KeyedNumber p={p} path="transform.height" label={t('inspector.height')} unit="px" min={1} />
        <KeyedNumber p={p} path="transform.rotation" label={<RotIcon />} unit="°" step={0.5} digits={1} />
        <KeyedNumber
          p={p}
          path="transform.scale"
          label={t('inspector.scale')}
          step={1}
          digits={0}
          unit="%"
          scale={100}
          min={1}
        />
      </div>
      <KeyedNumber
        p={p}
        path="transform.opacity"
        label={t('inspector.opacity')}
        step={1}
        digits={0}
        unit="%"
        scale={100}
        min={0}
        max={100}
      />
      <FieldRow label={t('inspector.anchor')}>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField
            label="X"
            value={eff.transform.anchorX * 100}
            step={1}
            digits={0}
            unit="%"
            onCommit={(v) => p.commit('transform.anchorX', v / 100)}
          />
          <NumberField
            label="Y"
            value={eff.transform.anchorY * 100}
            step={1}
            digits={0}
            unit="%"
            onCommit={(v) => p.commit('transform.anchorY', v / 100)}
          />
        </div>
      </FieldRow>
    </Group>
  )
}

function RotIcon() {
  return <span className="t-caption">↻</span>
}

function FramingGroup({
  p,
  clip,
  format,
  override,
}: {
  p: PropApi
  clip: Clip
  format: OutputFormat
  override: boolean
}) {
  const t = useT('editor')
  const [busy, setBusy] = useState(false)
  const id = useEditor((s) => s.id)
  return (
    <Group id="framing" title={t('inspector.media')}>
      <FieldRow label={t('inspector.fit')}>
        <Choice
          value={clip.fit}
          onChange={(v) => p.patch({ fit: v }, 'Fit')}
          options={[
            { value: 'cover', label: t('inspector.cover') },
            { value: 'contain', label: t('inspector.contain') },
            { value: 'fill', label: t('inspector.fill') },
          ]}
        />
      </FieldRow>
      <FieldRow label={t('inspector.focus')} hint={t('inspector.focusHint')}>
        <div className="grid grid-cols-2 gap-1.5">
          <KeyedNumber p={p} path="focusX" label="X" step={0.5} unit="%" scale={100} min={0} max={100} />
          <KeyedNumber p={p} path="focusY" label="Y" step={0.5} unit="%" scale={100} min={0} max={100} />
        </div>
      </FieldRow>
      {override && clip.type === 'video' && id && (
        <Button
          size="sm"
          variant="secondary"
          icon={ScanFace}
          loading={busy}
          className="mt-1 w-full"
          title={t('inspector.autoReframeHint', { format: format.name })}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await compositionApi.autoReframe(
                id,
                clip.id,
                format.id,
                format.width < format.height ? 'x' : 'both',
              )
              toast.done(t('inspector.reframed', { format: format.name, count: r.samples }))
            } catch (err) {
              toast.error(err)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? t('inspector.reframing') : t('inspector.autoReframe')}
        </Button>
      )}
      <FieldRow label={t('inspector.crop')}>
        <div className="grid grid-cols-2 gap-1.5">
          {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
            <NumberField
              key={side}
              label={side[0]!.toUpperCase()}
              value={(forFormat(clip, format.id).crop?.[side] ?? 0) * 100}
              step={0.5}
              digits={1}
              unit="%"
              min={0}
              max={90}
              onCommit={(v) => p.commit(`crop.${side}`, v / 100, 'Crop')}
            />
          ))}
        </div>
      </FieldRow>
    </Group>
  )
}

function TextGroup({ p, clip }: { p: PropApi; clip: Clip }) {
  const t = useT('editor')
  const tx = clip.text ?? {}
  const [draft, setDraft] = useState(tx.content ?? '')
  const [focused, setFocused] = useState(false)
  // Someone else (or Claude) changed the words: show them unless you are typing.
  useEffect(() => {
    if (!focused) setDraft(tx.content ?? '')
  }, [tx.content, focused])
  return (
    <>
      <Group id="text" title={t('inspector.text')}>
        <Textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            p.preview('text.content', e.target.value)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (draft !== tx.content) p.commit('text.content', draft, 'Text')
          }}
          onKeyDown={(e) => e.stopPropagation()}
          rows={2}
          className="t-callout"
        />
        <FieldRow label={t('inspector.font')}>
          <MiniSelect
            value={tx.fontFamily ?? 'Inter Variable'}
            options={[...new Set([...FONT_CHOICES, tx.fontFamily ?? 'Inter Variable'])].map((f) => ({
              value: f,
              label: f.replace(' Variable', ''),
            }))}
            onChange={(v) => p.commit('text.fontFamily', v, 'Font')}
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-1.5">
          <KeyedNumber p={p} path="text.fontSize" label={t('inspector.size')} unit="px" min={1} />
          <NumberField
            label={t('inspector.weight')}
            value={tx.fontWeight ?? 700}
            step={10}
            digits={0}
            min={100}
            max={1000}
            onCommit={(v) => p.commit('text.fontWeight', Math.round(v / 10) * 10)}
          />
          <NumberField
            label={t('inspector.lineHeight')}
            value={tx.lineHeight ?? 1.1}
            step={0.01}
            digits={2}
            onCommit={(v) => p.commit('text.lineHeight', v)}
          />
          <KeyedNumber
            p={p}
            path="text.letterSpacing"
            label={t('inspector.letterSpacing')}
            step={0.001}
            digits={3}
            unit="em"
          />
        </div>
        <FieldRow label={t('inspector.color')}>
          <ColorField
            value={p.str('text.color') ?? tx.color ?? '#ffffff'}
            onCommit={(v) => p.commit('text.color', v, 'Colour')}
          />
        </FieldRow>
        <FieldRow label={t('inspector.align')}>
          <div className="grid grid-cols-2 gap-1.5">
            <Choice
              value={tx.align ?? 'center'}
              onChange={(v) => p.commit('text.align', v)}
              options={[
                { value: 'left', label: <AlignLeft size={13} /> },
                { value: 'center', label: <AlignCenter size={13} /> },
                { value: 'right', label: <AlignRight size={13} /> },
              ]}
            />
            <Choice
              value={tx.verticalAlign ?? 'middle'}
              onChange={(v) => p.commit('text.verticalAlign', v)}
              options={[
                { value: 'top', label: '⤒' },
                { value: 'middle', label: '↕' },
                { value: 'bottom', label: '⤓' },
              ]}
            />
          </div>
        </FieldRow>
        <FieldRow label={t('inspector.case')}>
          <Choice
            value={tx.textTransform ?? 'none'}
            onChange={(v) => p.commit('text.textTransform', v)}
            options={[
              { value: 'none', label: 'Aa' },
              { value: 'uppercase', label: 'AA' },
              { value: 'lowercase', label: 'aa' },
            ]}
          />
        </FieldRow>
        <FieldRow label={t('inspector.background')}>
          <ColorField value={tx.background} allowEmpty onCommit={(v) => p.commit('text.background', v)} />
        </FieldRow>
        <FieldRow label={t('inspector.stroke')}>
          <div className="grid grid-cols-[1fr_72px] gap-1.5">
            <ColorField value={tx.strokeColor} allowEmpty onCommit={(v) => p.commit('text.strokeColor', v)} />
            <NumberField
              label="px"
              value={tx.strokeWidth ?? 0}
              step={0.5}
              min={0}
              onCommit={(v) => p.commit('text.strokeWidth', v)}
            />
          </div>
        </FieldRow>
      </Group>
      <Group id="text-anim" title={t('inspector.animation')}>
        {(['animateIn', 'animateOut'] as const).map((which) => {
          const a = tx[which] ?? {}
          const set = (patch: Record<string, unknown>) =>
            p.patch({ text: { [which]: patch } }, 'Text animation')
          return (
            <div key={which} className="flex flex-col gap-1.5">
              <FieldRow label={t(`inspector.${which}`)}>
                <MiniSelect
                  value={a.preset ?? 'none'}
                  options={TEXT_PRESETS.map((v) => ({ value: v, label: pretty(v) }))}
                  onChange={(v) => set({ preset: v })}
                />
              </FieldRow>
              {a.preset && a.preset !== 'none' && (
                <div className="grid grid-cols-[1fr_1fr] gap-1.5 pl-[84px]">
                  <MiniSelect
                    value={a.by ?? 'block'}
                    options={(['block', 'line', 'word', 'char'] as const).map((v) => ({
                      value: v,
                      label: t(`inspector.${v}`),
                    }))}
                    onChange={(v) => set({ by: v })}
                  />
                  <NumberField
                    label="s"
                    value={a.duration ?? 0.6}
                    step={0.05}
                    digits={2}
                    min={0}
                    onCommit={(v) => set({ duration: v })}
                  />
                  {a.by && a.by !== 'block' && (
                    <NumberField
                      label={t('inspector.stagger')}
                      value={a.stagger ?? 0.04}
                      step={0.01}
                      digits={2}
                      min={0}
                      onCommit={(v) => set({ stagger: v })}
                      className="col-span-2"
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </Group>
    </>
  )
}

function ShapeGroup({ p, clip }: { p: PropApi; clip: Clip }) {
  const t = useT('editor')
  const sh = clip.shape ?? {}
  return (
    <Group id="shape" title={t('inspector.shape')}>
      <FieldRow label={t('inspector.kind')}>
        <MiniSelect
          value={sh.kind ?? 'rect'}
          options={(['rect', 'ellipse', 'line', 'polygon', 'path'] as const).map((v) => ({
            value: v,
            label: pretty(v),
          }))}
          onChange={(v) => p.patch({ shape: { kind: v } }, 'Shape')}
        />
      </FieldRow>
      <FieldRow label={t('inspector.fillColor')}>
        <ColorField value={sh.fill} allowEmpty onCommit={(v) => p.patch({ shape: { fill: v } }, 'Colour')} />
      </FieldRow>
      <FieldRow label={t('inspector.stroke')}>
        <div className="grid grid-cols-[1fr_72px] gap-1.5">
          <ColorField
            value={sh.stroke}
            allowEmpty
            onCommit={(v) => p.patch({ shape: { stroke: v } }, 'Outline')}
          />
          <NumberField
            label="px"
            value={sh.strokeWidth ?? 0}
            step={0.5}
            min={0}
            onCommit={(v) => p.patch({ shape: { strokeWidth: v } }, 'Outline')}
          />
        </div>
      </FieldRow>
      <KeyedNumber
        p={p}
        path="shape.trim"
        label={t('inspector.trim')}
        step={1}
        unit="%"
        scale={100}
        min={0}
        max={100}
      />
    </Group>
  )
}

function CodeGroup({ p, clip }: { p: PropApi; clip: Clip }) {
  const t = useT('editor')
  const readOnly = useEditor((s) => s.readOnly)
  return (
    <Group id="code" title={t('inspector.code')}>
      <CodeEditor
        value={clip.html?.code ?? ''}
        readOnly={readOnly}
        onPreview={(code) => p.preview('html.code', code)}
        onCommit={(code) => p.commit('html.code', code, 'Code')}
      />
      <p className="t-micro text-ink-4">{t('inspector.codeHint')}</p>
      <label className="flex items-center justify-between gap-3 t-caption text-ink-2">
        {t('inspector.transparent')}
        <Toggle
          size="sm"
          checked={clip.html?.transparent ?? true}
          onChange={(v) => p.patch({ html: { transparent: v } }, 'Code')}
        />
      </label>
    </Group>
  )
}

function StyleGroup({ p, clip }: { p: PropApi; clip: Clip }) {
  const t = useT('editor')
  const st = clip.style ?? {}
  return (
    <Group id="style" title={t('inspector.style')} defaultOpen={false}>
      <div className="grid grid-cols-2 gap-1.5">
        <KeyedNumber p={p} path="style.radius" label={t('inspector.radius')} unit="px" min={0} />
        <KeyedNumber
          p={p}
          path="style.filters.blur"
          label={t('inspector.blur')}
          unit="px"
          step={0.5}
          digits={1}
          min={0}
        />
        <KeyedNumber
          p={p}
          path="style.filters.brightness"
          label={t('inspector.brightness')}
          unit="%"
          scale={100}
          min={0}
        />
        <KeyedNumber
          p={p}
          path="style.filters.contrast"
          label={t('inspector.contrast')}
          unit="%"
          scale={100}
          min={0}
        />
        <KeyedNumber
          p={p}
          path="style.filters.saturate"
          label={t('inspector.saturate')}
          unit="%"
          scale={100}
          min={0}
        />
        <KeyedNumber p={p} path="style.filters.hue" label={t('inspector.hue')} unit="°" />
      </div>
      <KeyedNumber
        p={p}
        path="style.filters.grayscale"
        label={t('inspector.grayscale')}
        unit="%"
        scale={100}
        min={0}
        max={100}
      />
      <FieldRow label={t('inspector.blend')}>
        <MiniSelect
          value={st.blendMode ?? 'normal'}
          options={BLENDS.map((v) => ({ value: v, label: pretty(v) }))}
          onChange={(v) => p.patch({ style: { blendMode: v } }, 'Blend')}
        />
      </FieldRow>
      <FieldRow label={t('inspector.shadow')}>
        <input
          defaultValue={st.shadow ?? ''}
          placeholder="0 20px 60px rgba(0,0,0,.4)"
          onBlur={(e) =>
            e.target.value !== (st.shadow ?? '') && p.patch({ style: { shadow: e.target.value } }, 'Shadow')
          }
          onKeyDown={(e) => e.stopPropagation()}
          className="h-7 w-full rounded-[6px] bg-well px-2 t-meta text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:text-ink-4"
        />
      </FieldRow>
    </Group>
  )
}

function AudioGroup({ p, clip }: { p: PropApi; clip: Clip }) {
  const t = useT('editor')
  const a = clip.audio ?? {}
  return (
    <Group id="audio" title={t('inspector.audio')}>
      <KeyedNumber
        p={p}
        path="audio.volume"
        label={t('inspector.volume')}
        unit="%"
        scale={100}
        min={0}
        max={200}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField
          label={t('inspector.fadeIn')}
          value={a.fadeIn ?? 0}
          step={0.05}
          digits={2}
          min={0}
          unit="s"
          onCommit={(v) => p.patch({ audio: { fadeIn: v } }, 'Fade')}
        />
        <NumberField
          label={t('inspector.fadeOut')}
          value={a.fadeOut ?? 0}
          step={0.05}
          digits={2}
          min={0}
          unit="s"
          onCommit={(v) => p.patch({ audio: { fadeOut: v } }, 'Fade')}
        />
      </div>
      <label className="flex items-center justify-between gap-3 t-caption text-ink-2">
        {t('inspector.muted')}
        <Toggle size="sm" checked={!!a.muted} onChange={(v) => p.patch({ audio: { muted: v } }, 'Mute')} />
      </label>
    </Group>
  )
}

function TransitionGroup({ clip }: { clip: Clip }) {
  const t = useT('editor')
  const row = (which: 'transitionIn' | 'transitionOut') => {
    const tr = clip[which]
    const set = (v: Record<string, unknown> | null) =>
      dispatch([{ op: 'update_clip', id: clip.id, patch: { [which]: v } }], { label: 'Transition' })
    return (
      <div key={which} className="flex flex-col gap-1.5">
        <FieldRow label={t(`inspector.${which}`)}>
          <MiniSelect
            value={tr?.type ?? ''}
            options={[
              { value: '', label: t('inspector.noTransition') },
              ...TRANSITIONS.map((v) => ({ value: v, label: pretty(v) })),
            ]}
            onChange={(v) =>
              set(v ? { type: v, duration: tr?.duration ?? 0.5, easing: tr?.easing ?? 'ease-in-out' } : null)
            }
          />
        </FieldRow>
        {tr && (
          <div className="grid grid-cols-2 gap-1.5 pl-[84px]">
            <NumberField
              label="s"
              value={tr.duration}
              step={0.05}
              digits={2}
              min={0.05}
              max={10}
              onCommit={(v) => set({ ...tr, duration: v })}
            />
            <MiniSelect
              value={typeof tr.easing === 'string' ? tr.easing : 'ease-in-out'}
              options={EASINGS.map((e) => ({ value: e as string, label: pretty(e as string) }))}
              onChange={(v) => set({ ...tr, easing: v })}
            />
          </div>
        )}
      </div>
    )
  }
  return (
    <Group
      id="transitions"
      title={t('inspector.transitions')}
      defaultOpen={!!(clip.transitionIn || clip.transitionOut)}
    >
      {row('transitionIn')}
      {row('transitionOut')}
    </Group>
  )
}

/** Every animated property with its keyframes: jump to one, change its easing, remove it. */
function AnimationGroup({
  p,
  clip,
  format,
  doc,
}: {
  p: PropApi
  clip: Clip
  format: OutputFormat
  doc: Composition
}) {
  const t = useT('editor')
  const design = doc.formats[0]?.id ?? 'main'
  const paths = [
    ...new Set([
      ...Object.keys(clip.keyframes ?? {}),
      ...Object.keys(clip.formats?.[format.id]?.keyframes ?? {}),
    ]),
  ]
  if (!paths.length) return null
  const seek = (k: Keyframe) => useEditor.setState({ time: round(clip.start + k.t), playing: false })
  const write = (path: string, keys: Keyframe[]) => {
    const inOverride = format.id !== design && !!clip.formats?.[format.id]?.keyframes?.[path]
    const op: Op = inOverride
      ? {
          op: 'update_clip',
          id: clip.id,
          patch: { formats: { [format.id]: { keyframes: { [path]: keys } } } },
        }
      : { op: 'set_keyframes', id: clip.id, prop: path, keyframes: keys }
    dispatch([op], { label: 'Keyframes' })
  }
  return (
    <Group id="anim" title={t('inspector.animation')}>
      {paths.map((path) => {
        const keys = keyframesFor(clip, path, format.id, design)
        const local = p.time - clip.start
        const prev = [...keys].reverse().find((k) => k.t < local - 1e-3)
        const next = keys.find((k) => k.t > local + 1e-3)
        return (
          <div key={path} className="rounded-[8px] bg-well px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate t-meta text-ink-2">{path}</span>
              <IconButton
                size="xs"
                icon={ChevronLeft}
                label={t('inspector.prevKey')}
                disabled={!prev}
                onClick={() => prev && seek(prev)}
              />
              <IconButton
                size="xs"
                icon={ChevronRight}
                label={t('inspector.nextKey')}
                disabled={!next}
                onClick={() => next && seek(next)}
              />
              <IconButton
                size="xs"
                icon={Trash2}
                label={t('inspector.clearKeys')}
                onClick={() => write(path, [])}
              />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {keys.map((k, i) => (
                <Menu
                  key={`${k.t}-${i}`}
                  width={180}
                  trigger={
                    <button
                      type="button"
                      className={cn(
                        'press flex h-6 items-center gap-1 rounded-[5px] px-1.5 t-meta text-[10.5px]',
                        Math.abs(k.t - local) < 1 / 60
                          ? 'bg-review-soft text-review'
                          : 'bg-hover text-ink-2 hover:text-ink',
                      )}
                      onDoubleClick={() => seek(k)}
                    >
                      <Diamond size={8} fill="currentColor" strokeWidth={0} />
                      {k.t.toFixed(2)}s
                    </button>
                  }
                  items={[
                    { label: 'Go to', icon: Crosshair, onSelect: () => seek(k) },
                    {
                      label: t('inspector.easing'),
                      hint: typeof k.easing === 'string' ? pretty(k.easing) : k.easing ? 'Curve' : 'Linear',
                      items: EASINGS.map((e) => ({
                        label: pretty(e as string),
                        checked: k.easing === e || (!k.easing && e === 'linear'),
                        onSelect: () =>
                          write(
                            path,
                            keys.map((x, j) => (j === i ? { ...x, easing: e } : x)),
                          ),
                      })),
                    },
                    'separator',
                    {
                      label: t('inspector.removeKey'),
                      icon: Trash2,
                      danger: true,
                      onSelect: () =>
                        write(
                          path,
                          keys.filter((_, j) => j !== i),
                        ),
                    },
                  ]}
                />
              ))}
            </div>
          </div>
        )
      })}
    </Group>
  )
}

// ── nothing selected: the edit itself ────────────────────────────────────────────────

function EditSettings({ doc }: { doc: Composition }) {
  const t = useT('editor')
  const readOnly = useEditor((s) => s.readOnly)
  const set = (key: 'fps' | 'duration' | 'background' | 'formats', value: unknown, label: string) =>
    dispatch([{ op: 'set', key, value }], { label })
  const missing = PRESETS.filter(
    (p) => !doc.formats.some((f) => f.width === p.format.width && f.height === p.format.height),
  )
  return (
    <fieldset disabled={readOnly} className="min-w-0">
      <div className="border-b border-line px-3.5 py-3">
        <div className="t-callout font-[600] text-ink">{t('inspector.project')}</div>
        <div className="mt-0.5 t-caption text-ink-3">{t('inspector.nothing')}</div>
      </div>
      <Group id="settings" title={t('inspector.project')}>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField
            label={t('inspector.length')}
            value={doc.duration}
            step={0.1}
            digits={2}
            min={0.1}
            unit="s"
            onCommit={(v) => set('duration', round(v), 'Length')}
          />
          <MiniSelect
            value={String(doc.fps)}
            options={['24', '25', '30', '50', '60'].map((v) => ({ value: v, label: `${v} fps` }))}
            onChange={(v) => set('fps', Number(v), 'Frame rate')}
          />
        </div>
        <FieldRow label={t('inspector.backgroundColor')}>
          <ColorField value={doc.background} onCommit={(v) => set('background', v, 'Background')} />
        </FieldRow>
      </Group>
      <Group id="formats" title={t('inspector.formats')}>
        {doc.formats.map((f, i) => (
          <div
            key={f.id}
            className="flex items-center gap-2.5 rounded-[8px] bg-well px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <AspectBox w={f.width} h={f.height} />
            <div className="min-w-0 flex-1">
              <div className="t-caption font-[550] text-ink">{f.name}</div>
              <div className="t-meta text-ink-4">
                {f.width}×{f.height}
                {i === 0 ? ` · ${t('inspector.design')}` : ''}
              </div>
            </div>
            {i > 0 && (
              <IconButton
                size="xs"
                icon={Trash2}
                label={t('bar.removeFormat', { format: f.name })}
                onClick={() => {
                  // drop the format and every clip's override for it
                  const ops: Op[] = [
                    { op: 'set', key: 'formats', value: doc.formats.filter((x) => x.id !== f.id) },
                  ]
                  for (const tr of doc.tracks)
                    for (const c of tr.clips)
                      if (c.formats?.[f.id])
                        ops.push({ op: 'update_clip', id: c.id, patch: { formats: { [f.id]: null } } })
                  dispatch(ops, { label: 'Remove format' })
                }}
              />
            )}
          </div>
        ))}
        {missing.length > 0 && (
          <Menu
            trigger={
              <Button size="sm" variant="ghost" icon={Plus} className="self-start">
                {t('bar.addFormat')}
              </Button>
            }
            items={missing.map((p) => ({
              label: `${p.format.name} · ${p.format.width}×${p.format.height}`,
              onSelect: () => {
                let id = p.format.id
                while (doc.formats.some((f) => f.id === id)) id = `${id}-2`
                set('formats', [...doc.formats, { ...p.format, id }], 'Add format')
              },
            }))}
          />
        )}
      </Group>
    </fieldset>
  )
}
