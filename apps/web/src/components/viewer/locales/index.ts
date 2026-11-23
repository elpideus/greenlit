import { registerLocales } from '@/lib/i18n'
import en from './en.json'
import it from './it.json'

// The viewer is shared by several features (media, review), so it registers its own strings.
registerLocales('viewer', { en, it })
