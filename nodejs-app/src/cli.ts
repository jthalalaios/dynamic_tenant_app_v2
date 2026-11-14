import { randomBytes } from 'node:crypto'
import { sql } from 'kysely'
import { provisionTenantRoles, syncPermissions } from './authorization/permissionSynchronizer.ts'
import { closeDatabase, db } from './db/database.ts'
import { isFreshDatabase, migrateToLatest } from './db/migrator.ts'
import { runDatabaseSeeder } from './seeders/databaseSeeder.ts'
import { runChatDemoSeeder } from './seeders/chatDemoSeeder.ts'
import { purgeTokens } from './services/auth/tokens.ts'
import { closeStale } from './services/doctor/presence.ts'
import { closeRedis } from './support/redis.ts'

/**
 * Console commands (the port of `php artisan ...`):
 *
 *   node src/cli.ts db:wait               wait until the database accepts connections
 *   node src/cli.ts db:first-boot         prints 1 before the first migration ran, else 0
 *   node src/cli.ts migrate               apply pending migrations
 *   node src/cli.ts permissions:sync      upsert src/config/permissions.ts
 *          [--roles]                      also reset every tenant's system roles to the config
 *   node src/cli.ts db:seed               permissions + demo data (outside production)
 *          [--class=ChatDemoSeeder]       only the demo chat rooms and messages (idempotent)
 *   node src/cli.ts presence:close-stale  close sessions whose heartbeat stopped
 *   node src/cli.ts tokens:purge          delete revoked / long expired access tokens
 *   node src/cli.ts key:generate          print a fresh APP_KEY
 */
const [command, ...args] = process.argv.slice(2)
const flag = (name: string) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`))
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForDatabase(attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await sql`select 1`.execute(db())
      return
    } catch (error) {
      if (i >= attempts) {
        console.error(`Database still unreachable after ${i} attempts:`, error instanceof Error ? error.message : error)
        throw error
      }
      console.info(`Waiting for the database (${i}/${attempts})...`)
      await sleep(2000)
    }
  }
}

const commands: Record<string, () => Promise<void>> = {
  'db:wait': () => waitForDatabase(),

  'db:first-boot': async () => {
    process.stdout.write((await isFreshDatabase(db())) ? '1' : '0')
  },

  migrate: async () => {
    const applied = await migrateToLatest(db())
    console.info(applied.length ? applied.map((name) => `Migrated: ${name}`).join('\n') : 'Nothing to migrate.')
  },

  'permissions:sync': async () => {
    const { synced, pruned } = await syncPermissions()
    console.info(`Synced ${synced} permissions, pruned ${pruned}.`)

    if (flag('roles')) {
      const tenants = await db().selectFrom('tenants').selectAll().execute()
      for (const tenant of tenants) await provisionTenantRoles(tenant)
      console.info('System roles refreshed for every tenant.')
    }
  },

  'db:seed': async () => {
    const which = option('class')
    if (which === 'ChatDemoSeeder') await runChatDemoSeeder()
    else if (which === undefined || which === 'DatabaseSeeder') await runDatabaseSeeder()
    else throw new Error(`Unknown seeder: ${which}`)
    console.info('Database seeded.')
  },

  'presence:close-stale': async () => {
    console.info(`Closed ${await closeStale()} stale presence sessions.`)
  },

  'tokens:purge': async () => {
    console.info(`Purged ${await purgeTokens()} revoked or expired access tokens.`)
  },

  'key:generate': async () => {
    console.info(`base64:${randomBytes(32).toString('base64')}`)
  }
}

async function main(): Promise<number> {
  const run = command ? commands[command] : undefined
  if (!run) {
    console.error(`Usage: node src/cli.ts <${Object.keys(commands).join(' | ')}>`)
    return 1
  }

  try {
    await run()
    return 0
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error)
    return 1
  } finally {
    await Promise.allSettled([closeDatabase(), closeRedis()])
  }
}

process.exitCode = await main()
