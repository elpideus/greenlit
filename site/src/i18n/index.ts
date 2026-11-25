import { en } from './en'
import { it } from './it'

export type Lang = 'en' | 'it'
export const langs: Lang[] = ['en', 'it']
export const dicts = { en, it }
/** BCP 47 tags for <html lang> and hreflang */
export const htmlLang: Record<Lang, string> = { en: 'en', it: 'it' }

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')

/** A page's address in a language: English at the root, Italian under /it/. `path` is like '' or 'start/'. */
export const href = (lang: Lang, path = '') => `${base}${lang === 'it' ? 'it/' : ''}${path}`

/**
 * A file under public/media in a language. Footage recorded in the app has an Italian take under media/it/;
 * stock footage (`shared`) is the same in both.
 */
export const media = (lang: Lang, file: string, shared = false) =>
  `${base}media/${lang === 'it' && !shared ? 'it/' : ''}${file}`

/** Replaces {name} placeholders. */
export const fill = (s: string, values: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '')
