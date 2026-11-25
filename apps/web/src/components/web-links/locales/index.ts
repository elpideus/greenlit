import { registerLocales } from '@/lib/i18n'
import en from './en.json'
import it from './it.json'

// Shared by the project page and the media Info panel.
registerLocales('webLinks', { en, it })
