import { Kysely, PostgresDialect, type Transaction } from 'kysely'
import pg from 'pg'
import { config } from '../config/index.ts'
import type { DB } from './schema.ts'

/**
 * The application's Kysely instance.
 *
 * Production / Docker: a `pg` pool. Tests swap in an in-process PostgreSQL
 * (PGlite) through `setDatabase()`, so the suite never touches a real database.
 */
export type Database = Kysely<DB>
/** A query runner: the database itself or an open transaction */
export type Executor = Kysely<DB> | Transaction<DB>

// int8 (bigint ids, count(*)) as JS numbers; every id and count stays far below 2^53
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10))
// numeric (sum() of integer columns) as numbers
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value))
// date columns as plain YYYY-MM-DD strings, never shifted by the server's timezone
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value)

let instance: Database | null = null

export function createPostgresDatabase(): Database {
  const { host, port, database, user, password, poolMax } = config.database

  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ host, port, database, user, password, max: poolMax })
    })
  })
}

export function db(): Database {
  instance ??= createPostgresDatabase()
  return instance
}

export function setDatabase(next: Database | null): void {
  instance = next
}

export async function closeDatabase(): Promise<void> {
  if (instance) await instance.destroy()
  instance = null
}
