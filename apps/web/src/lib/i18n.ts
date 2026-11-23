import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'

/**
 * Strings live next to the feature that shows them (`features/<id>/locales/{en,it}.json`) and are registered under
 * the feature's namespace. Always add both languages.
 */
export type LocaleBundle = { en: Record<string, unknown>; it: Record<string, unknown> }

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
})

export function registerLocales(ns: string, bundle: LocaleBundle) {
  i18next.addResourceBundle('en', ns, bundle.en, true, true)
  i18next.addResourceBundle('it', ns, bundle.it, true, true)
}

export function setLanguage(lang: string) {
  if (i18next.language !== lang) void i18next.changeLanguage(lang)
  document.documentElement.lang = lang
}

export function currentLanguage() {
  return i18next.language || 'en'
}

/** `const t = useT('library')` then `t('empty.title')`; `t('common:save')` reaches the shared strings. */
export function useT(ns = 'common') {
  return useTranslation([ns, 'common']).t
}

export { i18next }
