import { hasPermission, isAdmin } from '../../authorization/acl.ts'
import { db, type Executor } from '../../db/database.ts'
import type { ChatMessage, ChatMute, ChatRoom, User } from '../../db/schema.ts'
import { chatMuteResource } from '../../http/resources.ts'
import { broadcast } from '../../realtime/broadcaster.ts'
import { tenantChannel } from '../../realtime/channels.ts'
import { requireTenant, t, type Ctx } from '../../support/context.ts'
import { BusinessRuleError } from '../../support/errors.ts'
import { addMinutes } from '../../support/time.ts'
import { isAdminId } from './directory.ts'

/**
 * Chat moderation rules, in one place:
 *
 * - Administrators may moderate every member, other administrators included.
 * - Members holding `chat.mute` may moderate everyone except administrators.
 * - Everyone else may only chat. Nobody moderates themselves.
 *
 * The same rule decides who may delete someone else's message.
 */
type Person = Pick<User, 'id' | 'name' | 'tenant_id'>

export async function canModerate(ctx: Ctx, actor: User, target: Person | null | undefined): Promise<boolean> {
  if (!target || actor.id === target.id || actor.tenant_id !== target.tenant_id) return false
  if (await isAdmin(actor)) return true
  return (await hasPermission(actor, 'chat.mute')) && !(await isAdminId(ctx, target.id))
}

export async function canDeleteMessage(ctx: Ctx, actor: User, message: ChatMessage, author: Person | null): Promise<boolean> {
  if (message.user_id !== null && message.user_id === actor.id) return true

  // Messages of a removed account: the workspace's moderators may clean them up
  if (!author) {
    return message.tenant_id === actor.tenant_id && ((await isAdmin(actor)) || (await hasPermission(actor, 'chat.mute')))
  }

  return canModerate(ctx, actor, author)
}

async function authorize(ctx: Ctx, actor: User, target: Person | null | undefined): Promise<void> {
  if (!(await canModerate(ctx, actor, target))) {
    throw new BusinessRuleError(t(ctx, 'messages.chat_cannot_moderate'), 'chat_cannot_moderate', 403)
  }
}

async function people(ids: (number | null)[], executor: Executor = db()): Promise<Map<number, Person>> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))]
  if (!wanted.length) return new Map()
  const rows = await executor.selectFrom('users').select(['id', 'name', 'tenant_id']).where('id', 'in', wanted).execute()
  return new Map(rows.map((row) => [row.id, row]))
}

export async function muteResource(ctx: Ctx, mute: ChatMute) {
  const users = await people([mute.user_id, mute.muted_by])
  return chatMuteResource(ctx, mute, users.get(mute.user_id) ?? null, mute.muted_by !== null ? users.get(mute.muted_by) ?? null : null)
}

/**
 * Mute (or re-mute, replacing the previous terms) a member in one room or everywhere.
 */
export async function mute(ctx: Ctx, actor: User, target: User, room: ChatRoom | null, minutes: number | null, reason: string | null): Promise<ChatMute> {
  await authorize(ctx, actor, target)
  const tenant = requireTenant(ctx)
  const now = new Date()
  const values = {
    muted_by: actor.id,
    reason,
    expires_at: minutes !== null ? addMinutes(now, minutes) : null
  }

  const saved = await db()
    .transaction()
    .execute(async (trx) => {
      let existing = trx
        .selectFrom('chat_mutes')
        .selectAll()
        .where('tenant_id', '=', tenant.id)
        .where('user_id', '=', target.id)
      existing = room ? existing.where('room_id', '=', room.id) : existing.where('room_id', 'is', null)
      const current = await existing.forUpdate().executeTakeFirst()

      if (current) {
        return trx
          .updateTable('chat_mutes')
          .set({ ...values, updated_at: now })
          .where('id', '=', current.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      }

      return trx
        .insertInto('chat_mutes')
        .values({ tenant_id: tenant.id, user_id: target.id, room_id: room?.id ?? null, ...values })
        .returningAll()
        .executeTakeFirstOrThrow()
    })

  await broadcast(ctx, tenantChannel(saved.tenant_id), 'mute.changed', { action: 'muted', mute: await muteResource(ctx, saved) })

  return saved
}

export async function unmute(ctx: Ctx, actor: User, mute: ChatMute): Promise<void> {
  const target = (await people([mute.user_id])).get(mute.user_id) ?? null
  await authorize(ctx, actor, target)

  const payload = await muteResource(ctx, mute)
  await db().deleteFrom('chat_mutes').where('id', '=', mute.id).execute()

  await broadcast(ctx, tenantChannel(mute.tenant_id), 'mute.changed', { action: 'unmuted', mute: payload })
}

function activeFilter<Q extends { where: (...args: any[]) => Q }>(query: Q): Q {
  return query.where((eb: any) => eb.or([eb('chat_mutes.expires_at', 'is', null), eb('chat_mutes.expires_at', '>', new Date())]))
}

/**
 * The mute silencing a member in a room, if any. A permanent mute wins over
 * a timed one, otherwise the one that ends last.
 */
export async function activeMuteFor(user: User, room: ChatRoom, executor: Executor = db()): Promise<ChatMute | null> {
  const mutes = await activeFilter(
    executor
      .selectFrom('chat_mutes')
      .selectAll()
      .where('chat_mutes.tenant_id', '=', room.tenant_id)
      .where('chat_mutes.user_id', '=', user.id)
      .where((eb) => eb.or([eb('chat_mutes.room_id', 'is', null), eb('chat_mutes.room_id', '=', room.id)]))
  ).execute()

  if (!mutes.length) return null
  return mutes.reduce((best, m) => {
    if (best.expires_at === null) return best
    if (m.expires_at === null) return m
    return m.expires_at.getTime() > best.expires_at.getTime() ? m : best
  })
}

export async function activeMutes(ctx: Ctx): Promise<ChatMute[]> {
  return activeFilter(
    db().selectFrom('chat_mutes').selectAll().where('chat_mutes.tenant_id', '=', requireTenant(ctx).id).orderBy('created_at').orderBy('id')
  ).execute()
}

export async function activeMuteResources(ctx: Ctx) {
  const mutes = await activeMutes(ctx)
  const users = await people(mutes.flatMap((m) => [m.user_id, m.muted_by]))
  return Promise.all(
    mutes.map((m) => chatMuteResource(ctx, m, users.get(m.user_id) ?? null, m.muted_by !== null ? users.get(m.muted_by) ?? null : null))
  )
}
