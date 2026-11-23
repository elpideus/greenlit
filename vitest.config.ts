import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The API Anything fork keeps upstream's node:test suite (pnpm --filter api-anything test).
    exclude: [...configDefaults.exclude, 'packages/api-anything/**'],
  },
})
