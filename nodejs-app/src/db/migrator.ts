import { sql } from 'kysely'
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration'
import type { Database } from './database.ts'
import * as m0001 from './migrations/0001_create_tenants_and_users.ts'
import * as m0002 from './migrations/0002_create_access_control_tables.ts'
import * as m0003 from './migrations/0003_create_clinic_tables.ts'
import * as m0004 from './migrations/0004_create_shop_tables.ts'
import * as m0005 from './migrations/0005_create_chat_tables.ts'

/**
 * Every migration, in order. Listed explicitly (no directory scan), so the set
 * that runs is exactly the set that is type-checked and reviewed.
 */
const MIGRATIONS: Record<string, Migration> = {
  '0001_create_tenants_and_users': m0001,
  '0002_create_access_control_tables': m0002,
  '0003_create_clinic_tables': m0003,
  '0004_create_shop_tables': m0004,
  '0005_create_chat_tables': m0005
}

export const MIGRATION_TABLE = 'kysely_migration'

function migrator(db: Database): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => MIGRATIONS },
    migrationTableName: MIGRATION_TABLE
  })
}

/** Apply every pending migration; throws (with the failing migration's name) on error */
export async function migrateToLatest(db: Database): Promise<string[]> {
  const result: MigrationResultSet = await migrator(db).migrateToLatest()
  const failed = result.results?.find((r) => r.status === 'Error')

  if (result.error) {
    const name = failed ? ` (${failed.migrationName})` : ''
    throw new Error(`Migration failed${name}: ${result.error instanceof Error ? result.error.message : String(result.error)}`, {
      cause: result.error
    })
  }

  return (result.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName)
}

/** True before the very first migration ran against this database */
export async function isFreshDatabase(db: Database): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`select to_regclass(${MIGRATION_TABLE}) is not null as exists`.execute(db)
  return !result.rows[0]?.exists
}
