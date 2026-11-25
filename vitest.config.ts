import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The API Anything fork keeps upstream's node:test suite (pnpm --filter api-anything test).
    // showcase/ is the local, git-ignored workshop for the website and film (gigabytes of media, no tests).
    exclude: [...configDefaults.exclude, 'packages/api-anything/**', 'showcase/**'],
  },
})
