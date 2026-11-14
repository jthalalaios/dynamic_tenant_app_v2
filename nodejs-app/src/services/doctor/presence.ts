import { sql } from 'kysely'
import { config } from '../../config/index.ts'
import { db, type Executor } from '../../db/database.ts'
import type { PresenceSession, User } from '../../db/schema.ts'
import { subMinutes } from '../../support/time.ts'

/**
 * Tracks whether staff are online (on duty). Online = open session + fresh heartbeat.
 */
function liveSince(): Date {
  return subMinutes(new Date(), config.tenancy.presence.timeoutMinutes)
}

export function isLive(session: PresenceSession): boolean {
  return session.ended_at === null && session.last_heartbeat_at.getTime() >= liveSince().getTime()
}

export async function currentSession(user: User, executor: Executor = db()): Promise<PresenceSession | null> {
  return (
    (await executor
      .selectFrom('presence_sessions')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('ended_at', 'is', null)
      .orderBy('started_at', 'desc')
      .executeTakeFirst()) ?? null
  )
}

export async function isOnline(user: User): Promise<boolean> {
  const session = await currentSession(user)
  return session !== null && isLive(session)
}

export async function goOnline(user: User): Promise<PresenceSession> {
  if (user.tenant_id === null) throw new Error('Users without a tenant cannot go online.')
  const tenantId = user.tenant_id

  return db()
    .transaction()
    .execute(async (trx) => {
      const session = await trx
        .selectFrom('presence_sessions')
        .selectAll()
        .where('user_id', '=', user.id)
        .where('ended_at', 'is', null)
        .forUpdate()
        .executeTakeFirst()

      const now = new Date()

      if (session && isLive(session)) {
        return trx
          .updateTable('presence_sessions')
          .set({ last_heartbeat_at: now, updated_at: now })
          .where('id', '=', session.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      }

      // A stale open session is closed at its last heartbeat, not "now", to keep shift history honest
      if (session) {
        await trx
          .updateTable('presence_sessions')
          .set({ ended_at: session.last_heartbeat_at, updated_at: now })
          .where('id', '=', session.id)
          .execute()
      }

      return trx
        .insertInto('presence_sessions')
        .values({ tenant_id: tenantId, user_id: user.id, started_at: now, last_heartbeat_at: now })
        .returningAll()
        .executeTakeFirstOrThrow()
    })
}

export async function heartbeat(user: User): Promise<PresenceSession | null> {
  const session = await currentSession(user)
  if (!session || !isLive(session)) return null

  const now = new Date()
  return db()
    .updateTable('presence_sessions')
    .set({ last_heartbeat_at: now, updated_at: now })
    .where('id', '=', session.id)
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function goOffline(user: User): Promise<void> {
  const now = new Date()
  await db()
    .updateTable('presence_sessions')
    .set({ ended_at: now, updated_at: now })
    .where('user_id', '=', user.id)
    .where('ended_at', 'is', null)
    .execute()
}

/** Close sessions whose heartbeat stopped (closed tab, lost connection). Returns how many */
export async function closeStale(executor: Executor = db()): Promise<number> {
  const result = await executor
    .updateTable('presence_sessions')
    .set({ ended_at: sql`last_heartbeat_at`, updated_at: new Date() })
    .where('ended_at', 'is', null)
    .where('last_heartbeat_at', '<', liveSince())
    .executeTakeFirst()
  return Number(result.numUpdatedRows)
}
