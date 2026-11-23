import { bodyField, textLength } from '@greenlit/platforms'
import { useT } from '@/lib/i18n'
import { Field, Input, Textarea, Toggle } from '@/ui'
import { type DraftTarget, finalCaption, specOf } from '../model'
import { useWhere } from '../parts'
import { Counter, Panel, TagInput } from './bits'
import { useComposer } from './state'

function limitsFor(targets: { platform: string; placement: string }[]) {
  let caption: { max: number; where: { platform: string; placement: string } } | null = null
  let title: { max: number; where: { platform: string; placement: string } } | null = null
  for (const t of targets) {
    const spec = specOf(t.platform as never, t.placement)
    if (!spec) continue
    const field = bodyField(spec)
    const max = field ? spec.text[field]?.max : undefined
    if (max && (!caption || max < caption.max)) caption = { max, where: t }
    const tm = spec.text.title?.max
    if (tm && (!title || tm < title.max)) title = { max: tm, where: t }
  }
  return { caption, title }
}

/** The text everywhere uses: caption, title (YouTube, TikTok photos) and hashtags. */
export function SharedTextSection() {
  const t = useT('posts')
  const where = useWhere()
  const c = useComposer()
  const platformOf = (accountId: string) =>
    c.accounts.find((a) => a.id === accountId)?.platform ?? 'instagram'
  const enabled = c.draft.targets
    .filter((x) => x.enabled)
    .map((x) => ({ platform: platformOf(x.accountId), placement: x.placement }))
  const { caption, title } = limitsFor(enabled)
  const composed = finalCaption(c.draft, { caption: null, hashtags: null })
  const showTitle = !!title || !!c.draft.title || !enabled.length
  return (
    <Panel title={t('composer.text')}>
      <div className="flex flex-col gap-4">
        {showTitle && (
          <Field
            label={t('composer.title')}
            aside={title && <Counter count={textLength(c.draft.title)} max={title.max} />}
          >
            {(id) => (
              <Input
                id={id}
                size="lg"
                value={c.draft.title}
                disabled={!c.editable}
                placeholder={t('composer.titlePlaceholder')}
                onChange={(e) => c.update((d) => ({ ...d, title: e.target.value }))}
              />
            )}
          </Field>
        )}
        <Field
          label={t('composer.caption')}
          aside={
            <span className="flex items-center gap-2">
              {caption && enabled.length > 1 && (
                <span className="t-caption text-ink-4">
                  {t('composer.strictest', { where: where(caption.where.platform, caption.where.placement) })}
                </span>
              )}
              <Counter count={textLength(composed)} max={caption?.max} />
            </span>
          }
        >
          {(id) => (
            <Textarea
              id={id}
              rows={6}
              maxRows={22}
              value={c.draft.caption}
              disabled={!c.editable}
              placeholder={t('composer.captionPlaceholder')}
              onChange={(e) => c.update((d) => ({ ...d, caption: e.target.value }))}
              className="min-h-[140px] text-[14.5px] leading-[1.55]"
            />
          )}
        </Field>
        <Field label={t('composer.hashtags')} hint={t('composer.hashtagsHint')}>
          {() => (
            <TagInput
              prefix="#"
              value={c.draft.hashtags}
              disabled={!c.editable}
              placeholder={t('composer.hashtagsPlaceholder')}
              onChange={(hashtags) => c.update((d) => ({ ...d, hashtags }))}
            />
          )}
        </Field>
      </div>
    </Panel>
  )
}

/** A version's own text, when it should differ from everywhere's. */
export function TargetTextSection({ target }: { target: DraftTarget }) {
  const t = useT('posts')
  const where = useWhere()
  const c = useComposer()
  const account = c.accounts.find((a) => a.id === target.accountId)
  const platform = account?.platform ?? 'instagram'
  const spec = specOf(platform, target.placement)
  const field = spec ? bodyField(spec) : 'caption'
  const max = field && spec ? spec.text[field]?.max : undefined
  const own = target.caption !== null || target.title !== null || target.hashtags !== null
  const label = where(platform, target.placement)
  const composed = finalCaption(c.draft, target)
  return (
    <Panel
      title={t('composer.text')}
      hint={own ? undefined : t('composer.ownHint')}
      aside={
        <label className="flex items-center gap-2.5 t-callout text-ink-2">
          {t('composer.own', { where: label })}
          <Toggle
            checked={own}
            disabled={!c.editable}
            onChange={(on) =>
              c.updateTarget(
                target.key,
                on
                  ? {
                      caption: c.draft.caption,
                      title: spec?.text.title ? c.draft.title : null,
                      hashtags: [...c.draft.hashtags],
                    }
                  : { caption: null, title: null, hashtags: null },
              )
            }
          />
        </label>
      }
    >
      <div className="flex flex-col gap-4">
        {own && spec?.text.title && (
          <Field
            label={t('composer.title')}
            aside={<Counter count={textLength(target.title ?? '')} max={spec.text.title.max} />}
          >
            {(id) => (
              <Input
                id={id}
                size="lg"
                value={target.title ?? ''}
                disabled={!c.editable}
                onChange={(e) => c.updateTarget(target.key, { title: e.target.value })}
              />
            )}
          </Field>
        )}
        {own ? (
          <Field label={t('composer.caption')} aside={<Counter count={textLength(composed)} max={max} />}>
            {(id) => (
              <Textarea
                id={id}
                rows={5}
                maxRows={20}
                value={target.caption ?? ''}
                disabled={!c.editable}
                onChange={(e) => c.updateTarget(target.key, { caption: e.target.value })}
                className="min-h-[120px] text-[14.5px]"
              />
            )}
          </Field>
        ) : (
          <div className="rounded-[10px] bg-well px-3.5 py-3 t-body whitespace-pre-wrap text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
            {composed || <span className="text-ink-4">{t('noText')}</span>}
            <div className="mt-2 flex justify-end">
              <Counter count={textLength(composed)} max={max} />
            </div>
          </div>
        )}
        {own && (
          <Field label={t('composer.hashtags')}>
            {() => (
              <TagInput
                prefix="#"
                value={target.hashtags ?? []}
                disabled={!c.editable}
                onChange={(hashtags) => c.updateTarget(target.key, { hashtags })}
              />
            )}
          </Field>
        )}
        {platform === 'youtube' && (
          <Field
            label={t('composer.ytTags')}
            aside={
              spec?.text.tags && (
                <Counter count={target.tags.join(',').length} max={spec.text.tags.maxTotal} />
              )
            }
          >
            {() => (
              <TagInput
                value={target.tags}
                splitOnSpace={false}
                disabled={!c.editable}
                placeholder={t('composer.ytTagsPlaceholder')}
                onChange={(tags) => c.updateTarget(target.key, { tags })}
              />
            )}
          </Field>
        )}
      </div>
    </Panel>
  )
}
