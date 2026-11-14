import type { SelectQueryBuilder } from 'kysely'
import { isAdmin, roleIdsOf } from '../../authorization/acl.ts'
import { db, type Executor } from '../../db/database.ts'
import type { ChatRoom, DB, User } from '../../db/schema.ts'
import { requireTenant, t, type Ctx } from '../../support/context.ts'
import { NotFoundError } from '../../support/errors.ts'

/**
 * Who may enter a chat room of the current workspace (its audience):
 *
 * - everyone: every member holding chat.view (the default "Global" room is always this)
 * - admins:   administrators only
 * - roles:    members holding one of the room's roles (chat_room_role)
 *
 * Administrators can enter every room. Every lookup by id goes through here, so a
 * restricted room is a 404 for others, on the API and on the websocket channels alike.
 */
type RoomQuery<O> = SelectQueryBuilder<DB, 'chat_rooms', O>

export async function scopeAccessibleBy<O>(ctx: Ctx, query: RoomQuery<O>, user: User, executor: Executor = db()): Promise<RoomQuery<O>> {
  const scoped = query.where('chat_rooms.tenant_id', '=', requireTenant(ctx).id)
  if (await isAdmin(user)) return scoped

  const roleIds = await roleIdsOf(user, executor)

  return scoped.where((eb) =>
    eb.or([
      eb('chat_rooms.audience', '=', 'everyone'),
      eb.and([
        eb('chat_rooms.audience', '=', 'roles'),
        eb.exists(
          eb
            .selectFrom('chat_room_role')
            .select('chat_room_role.role_id')
            .whereRef('chat_room_role.room_id', '=', 'chat_rooms.id')
            .where('chat_room_role.role_id', 'in', roleIds.length ? roleIds : [-1])
        )
      ])
    ])
  )
}

/** A room the user may enter, or null */
export async function accessibleRoom(ctx: Ctx, user: User, id: number, executor: Executor = db()): Promise<ChatRoom | null> {
  if (!Number.isSafeInteger(id)) return null
  const query = await scopeAccessibleBy(ctx, executor.selectFrom('chat_rooms').selectAll('chat_rooms').where('chat_rooms.id', '=', id), user, executor)
  return (await query.executeTakeFirst()) ?? null
}

/** Route binding for {room}: rooms outside the user's audience (or workspace) are a 404 */
export async function findAccessibleRoom(ctx: Ctx, user: User, id: number): Promise<ChatRoom> {
  const room = await accessibleRoom(ctx, user, id)
  if (!room) throw new NotFoundError(t(ctx, 'messages.not_found'))
  return room
}

export async function roomRoles(roomIds: number[], executor: Executor = db()): Promise<Map<number, { id: number; name: string; slug: string }[]>> {
  const byRoom = new Map<number, { id: number; name: string; slug: string }[]>()
  if (!roomIds.length) return byRoom

  const rows = await executor
    .selectFrom('chat_room_role')
    .innerJoin('roles', 'roles.id', 'chat_room_role.role_id')
    .where('chat_room_role.room_id', 'in', roomIds)
    .select(['chat_room_role.room_id', 'roles.id', 'roles.name', 'roles.slug'])
    .orderBy('roles.id')
    .execute()

  for (const row of rows) {
    const list = byRoom.get(row.room_id) ?? []
    list.push({ id: row.id, name: row.name, slug: row.slug })
    byRoom.set(row.room_id, list)
  }

  return byRoom
}
