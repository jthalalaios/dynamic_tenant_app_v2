import { sql } from 'kysely'
import { db, type Executor } from './db/database.ts'
import { purgeTokens } from './services/auth/tokens.ts'
import { closeStale } from './services/doctor/presence.ts'

/**
 * Scheduled tasks (the port of routes/console.php), run by the API process:
 *
 * - presence:close-stale  every five minutes
 * - tokens:purge          daily at 00:00 UTC (passport:purge)
 *
 * Each run holds a PostgreSQL advisory lock, so several API replicas never run the
 * same task at the same time (withoutOverlapping).
 */
interface Task {
  name: string
  lockId: number
  due: (at: Date) => boolean
  run: (executor: Executor) => Promise<string>
}

export const TASKS: Task[] = [
  {
    name: 'presence:close-stale',
    lockId: 724_001,
    due: (at) => at.getUTCMinutes() % 5 === 0,
    run: async (executor) => `Closed ${await closeStale(executor)} stale presence sessions.`
  },
  {
    name: 'tokens:purge',
    lockId: 724_002,
    due: (at) => at.getUTCHours() === 0 && at.getUTCMinutes() === 0,
    run: async (executor) => `Purged ${await purgeTokens(executor)} revoked or expired access tokens.`
  }
]

export async function runTask(task: Task): Promise<string | null> {
  return db()
    .transaction()
    .execute(async (trx) => {
      const { rows } = await sql<{ locked: boolean }>`select pg_try_advisory_xact_lock(${task.lockId}) as locked`.execute(trx)
      if (!rows[0]?.locked) return null
      return task.run(trx)
    })
}

/** Ticks at the start of every minute; returns a stop function */
export function startScheduler(log: (message: string) => void = console.info): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const tick = async () => {
    const at = new Date()
    for (const task of TASKS.filter((t) => t.due(at))) {
      try {
        const result = await runTask(task)
        if (result) log(`[scheduler] ${task.name}: ${result}`)
      } catch (error) {
        console.error(`[scheduler] ${task.name} failed`, error)
      }
    }
    schedule()
  }

  const schedule = () => {
    if (stopped) return
    const now = Date.now()
    timer = setTimeout(() => void tick(), 60_000 - (now % 60_000) + 50)
  }

  schedule()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
