import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

// GitHub Pages: https://elpideus.github.io/greenlit/
export default defineConfig({
  site: 'https://elpideus.github.io',
  base: '/greenlit',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404'),
      // each page lists its other language (xhtml:link hreflang)
      i18n: { defaultLocale: 'en', locales: { en: 'en', it: 'it' } },
      serialize: (item) => ({
        ...item,
        lastmod: new Date().toISOString(),
        changefreq: 'weekly',
        priority: /\/greenlit\/(it\/)?$/.test(item.url) ? 1.0 : 0.8,
      }),
    }),
  ],
  build: { inlineStylesheets: 'auto', assets: '_assets' },
  image: { responsiveStyles: false },
})
