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
      serialize: (item) => ({
        ...item,
        lastmod: new Date().toISOString(),
        changefreq: 'weekly',
        priority: item.url.endsWith('/greenlit/') ? 1.0 : 0.8,
      }),
    }),
  ],
  build: { inlineStylesheets: 'auto', assets: '_assets' },
  image: { responsiveStyles: false },
})
