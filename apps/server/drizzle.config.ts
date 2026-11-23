import { defineConfig } from 'drizzle-kit'

// Every module keeps its tables in its own `schema.ts`; drizzle-kit picks them all up.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/core/schema.ts', './src/modules/*/schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.GREENLIT_DATABASE_URL ?? 'postgres://greenlit:greenlit@localhost:54329/greenlit',
  },
  strict: true,
  verbose: false,
})
