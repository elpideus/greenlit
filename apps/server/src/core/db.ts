import { join } from 'node:path'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { SERVER_ROOT } from './config.ts'
import type { Logger } from './logger.ts'

export type Db = PostgresJsDatabase
export type Sql = postgres.Sql

export function createDb(url: string, log: Logger) {
  const client = postgres(url, {
    max: 20,
    idle_timeout: 30,
    onnotice: (n) => log.debug({ notice: n.message }, 'postgres notice'),
  })
  const db = drizzle(client, { casing: 'snake_case' })
  return { db, client }
}

export async function runMigrations(url: string, log: Logger) {
  const client = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await client`create extension if not exists pg_trgm`
    await client`create extension if not exists unaccent`
    await migrate(drizzle(client), { migrationsFolder: join(SERVER_ROOT, 'drizzle') })
    log.info('database is up to date')
  } finally {
    await client.end()
  }
}

/** Postgres error code helper (unique_violation etc.). */
export function pgCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code
}
