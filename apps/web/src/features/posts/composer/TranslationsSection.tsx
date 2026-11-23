import { Languages, Plus, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { currentLanguage, useT } from '@/lib/i18n'
import { Button, Field, IconButton, Input, Menu, Textarea } from '@/ui'
import { Panel } from './bits'
import { useComposer } from './state'

const LANGS = [
  'en',
  'it',
  'de',
  'fr',
  'es',
  'pt',
  'nl',
  'pl',
  'ro',
  'ru',
  'uk',
  'sv',
  'da',
  'no',
  'fi',
  'el',
  'tr',
  'ar',
  'he',
  'hi',
  'zh',
  'ja',
  'ko',
]

/** Title and caption in other languages (YouTube localizations, Facebook multilingual posts). */
export function TranslationsSection() {
  const t = useT('posts')
  const c = useComposer()
  const names = useMemo(() => new Intl.DisplayNames([currentLanguage()], { type: 'language' }), [])
  const entries = Object.entries(c.draft.translations)
  const free = LANGS.filter((l) => !(l in c.draft.translations))
  const set = (lang: string, patch: Partial<{ title: string; caption: string }>) =>
    c.update((d) => ({
      ...d,
      translations: {
        ...d.translations,
        [lang]: {
          title: d.translations[lang]?.title ?? '',
          caption: d.translations[lang]?.caption ?? '',
          ...patch,
        },
      },
    }))
  return (
    <Panel
      title={t('composer.translations')}
      hint={t('composer.translationsHint')}
      aside={
        c.editable && (
          <Menu
            align="end"
            width={200}
            items={free.map((l) => ({
              label: names.of(l) ?? l,
              hint: l.toUpperCase(),
              onSelect: () => set(l, {}),
            }))}
            trigger={
              <Button size="sm" icon={Plus}>
                {t('composer.addLanguage')}
              </Button>
            }
          />
        )
      }
    >
      {entries.length === 0 ? (
        <div className="flex items-center gap-2.5 t-caption text-ink-4">
          <Languages size={15} />
          {names.of('it')}, {names.of('en')}, {names.of('de')}…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {entries.map(([lang, tr]) => (
              <motion.div
                key={lang}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-[10px] p-3 shadow-[inset_0_0_0_1px_var(--line)]">
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="rounded-tag bg-hover px-1.5 t-meta text-ink-2">
                      {lang.toUpperCase()}
                    </span>
                    <span className="t-callout font-[550] text-ink">{names.of(lang)}</span>
                    {c.editable && (
                      <IconButton
                        size="sm"
                        icon={Trash2}
                        label={t('composer.removeLanguage')}
                        className="ml-auto"
                        onClick={() =>
                          c.update((d) => {
                            const { [lang]: _, ...rest } = d.translations
                            return { ...d, translations: rest }
                          })
                        }
                      />
                    )}
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <Field label={t('composer.title')}>
                      {(id) => (
                        <Input
                          id={id}
                          value={tr.title ?? ''}
                          disabled={!c.editable}
                          onChange={(e) => set(lang, { title: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={t('composer.caption')}>
                      {(id) => (
                        <Textarea
                          id={id}
                          rows={3}
                          value={tr.caption ?? ''}
                          disabled={!c.editable}
                          onChange={(e) => set(lang, { caption: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  )
}
