import { sql } from 'kysely'
import { hasRole, isAdmin, roleIdsOf } from '../../authorization/acl.ts'
import { db, type Executor } from '../../db/database.ts'
import type { ChatAudience } from '../../domain/enums.ts'
import type { ChatMessage, ChatRoom, User } from '../../db/schema.ts'
import { chatMessageResource, chatRoomResource } from '../../http/resources.ts'
import { broadcast } from '../../realtime/broadcaster.ts'
import { roomChannel, tenantChannel } from '../../realtime/channels.ts'
import { requireTenant, t, userTimezone, type Ctx } from '../../support/context.ts'
import { BusinessRuleError } from '../../support/errors.ts'
import { trans } from '../../support/i18n.ts'
import { slugify } from '../../support/strings.ts'
import { formatShort } from '../../support/time.ts'
import { canDeleteMessage, activeMuteFor } from './moderation.ts'
import { roomRoles, scopeAccessibleBy } from './rooms.ts'

/**
 * Rooms, messages and read markers of the current workspace's live chat.
 *
 * Realtime: messages go to the room's own channel (`private-chat.feed.{room}`), which
 * only members who may enter the room can join, so a restricted room never leaks.
 * Room and mute changes go to the workspace channel as signals to resync.
 */
interface RoomDefinition {
  name: string
  description: string
  icon: string
  is_default?: boolean
  is_locked?: boolean
  audience: ChatAudience
  roles?: string[]
}

/**
 * Rooms every workspace starts with: a Global room for everyone, an announcements
 * room only administrators post in, a private room for administrators, and a room
 * per role listed for the workspace's theme.
 */
const DEFAULT_ROOMS: Record<string, RoomDefinition> = {
  general: { name: 'chat_default_room_name', description: 'chat_default_room_description', icon: 'globe', is_default: true, audience: 'everyone' },
  announcements: { name: 'chat_announcements_room_name', description: 'chat_announcements_room_description', icon: 'megaphone', is_locked: true, audience: 'everyone' },
  admins: { name: 'chat_admins_room_name', description: 'chat_admins_room_description', icon: 'shield', audience: 'admins' }
}

/** Role rooms per theme: slug => lang keys, icon, role slug */
const ROLE_ROOMS: Record<string, Record<string, { name: string; description: string; icon: string; role: string }>> = {
  doctor: { doctors: { name: 'chat_doctors_room_name', description: 'chat_doctors_room_description', icon: 'heart', role: 'doctor' } },
  marketplace: { managers: { name: 'chat_managers_room_name', description: 'chat_managers_room_description', icon: 'briefcase', role: 'manager' } }
}

export interface RoomInput {
  name?: string
  description?: string | null
  icon?: string
  is_locked?: boolean
  audience?: ChatAudience
  role_ids?: number[]
}

// ------------------------------------------------------------------ provision

/** Lazily set up a workspace that has no rooms at all yet */
export async function ensureDefaultRooms(ctx: Ctx): Promise<void> {
  const any = await db().selectFrom('chat_rooms').select('id').where('tenant_id', '=', requireTenant(ctx).id).executeTakeFirst()
  if (!any) await provisionDefaultRooms(ctx)
}

/**
 * Create the current workspace's default rooms that do not exist yet (by slug).
 * Idempotent and safe under concurrent requests.
 */
export async function provisionDefaultRooms(ctx: Ctx): Promise<void> {
  const tenant = ctx.tenant
  if (!tenant) return

  // Named in the organisation's language, not in that of whoever opens the chat first
  const locale = tenant.locale
  const definitions: Record<string, RoomDefinition> = { ...DEFAULT_ROOMS }

  for (const [slug, roleRoom] of Object.entries(ROLE_ROOMS[tenant.type] ?? {})) {
    definitions[slug] = { name: roleRoom.name, description: roleRoom.description, icon: roleRoom.icon, audience: 'roles', roles: [roleRoom.role] }
  }

  for (const [slug, definition] of Object.entries(definitions)) {
    const roleIds = definition.roles
      ? (
          await db().selectFrom('roles').select('id').where('tenant_id', '=', tenant.id).where('slug', 'in', definition.roles).execute()
        ).map((r) => r.id)
      : []

    // A role room whose role does not exist in this workspace would be empty: skip it
    if (definition.roles && roleIds.length === 0) continue

    const created = await db()
      .insertInto('chat_rooms')
      .values({
        tenant_id: tenant.id,
        slug,
        name: trans(locale, `messages.${definition.name}`),
        description: trans(locale, `messages.${definition.description}`),
        icon: definition.icon,
        is_default: definition.is_default ?? false,
        is_locked: definition.is_locked ?? false,
        audience: definition.audience
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'slug']).doNothing())
      .returning('id')
      .executeTakeFirst()

    if (created && roleIds.length) {
      await db()
        .insertInto('chat_room_role')
        .values(roleIds.map((roleId) => ({ room_id: created.id, role_id: roleId })))
        .execute()
    }
  }
}

// ----------------------------------------------------------------------- rooms

/** Messages of others newer than the viewer's read marker, for a room column */
function unreadCount(viewerId: number) {
  return sql<number>`(
    select count(*) from chat_messages m
    where m.room_id = chat_rooms.id
      and m.deleted_at is null
      and (m.user_id is null or m.user_id <> ${viewerId})
      and m.id > coalesce((select r.last_read_message_id from chat_room_reads r where r.room_id = m.room_id and r.user_id = ${viewerId}), 0)
  )`
}

/**
 * Rooms the viewer may enter, with their unread count and newest message.
 */
export async function roomsFor(ctx: Ctx, viewer: User) {
  const query = await scopeAccessibleBy(
    ctx,
    db().selectFrom('chat_rooms').selectAll('chat_rooms').select(unreadCount(viewer.id).as('unread_count')),
    viewer
  )
  const rooms = await query.orderBy('chat_rooms.is_default', 'desc').orderBy('chat_rooms.name').orderBy('chat_rooms.id').execute()
  const ids = rooms.map((r) => r.id)

  const roles = await roomRoles(ids)
  const latest = ids.length
    ? await db()
        .selectFrom('chat_messages')
        .leftJoin('users', 'users.id', 'chat_messages.user_id')
        .selectAll('chat_messages')
        .select(['users.name as author_name'])
        .where('chat_messages.id', 'in', (eb) =>
          eb
            .selectFrom('chat_messages as m')
            .select((e) => e.fn.max('m.id').as('id'))
            .where('m.room_id', 'in', ids)
            .where('m.deleted_at', 'is', null)
            .groupBy('m.room_id')
        )
        .execute()
    : []
  const latestByRoom = new Map(latest.map((m) => [m.room_id, m]))

  return Promise.all(
    rooms.map(async ({ unread_count, ...room }) => {
      const last = latestByRoom.get(room.id)
      const { author_name, ...message } = last ?? ({} as Partial<(typeof latest)[number]>)
      return chatRoomResource(ctx, room, {
        roles: roles.get(room.id) ?? [],
        unreadCount: Number(unread_count),
        lastMessage: last
          ? await chatMessageResource(ctx, message as ChatMessage, last.user_id !== null && author_name ? { id: last.user_id, name: author_name } : null)
          : null
      })
    })
  )
}

export async function roomPayload(ctx: Ctx, room: ChatRoom) {
  return chatRoomResource(ctx, room, { roles: (await roomRoles([room.id])).get(room.id) ?? [] })
}

/** Workspace roles a room manager may pick an audience from */
export async function audienceRoleOptions(ctx: Ctx, viewer: User) {
  const roles = await db()
    .selectFrom('roles')
    .select(['id', 'name', 'slug', 'is_admin'])
    .where('tenant_id', '=', requireTenant(ctx).id)
    .orderBy('is_admin', 'desc')
    .orderBy('name')
    .execute()
  const admin = await isAdmin(viewer)

  return Promise.all(
    roles.map(async (role) => ({
      id: role.id,
      name: role.name,
      slug: role.slug,
      is_admin: role.is_admin,
      // Non-admins may only open rooms to roles they hold themselves
      assignable: admin || (await hasRole(viewer, role.slug))
    }))
  )
}

export async function createRoom(ctx: Ctx, data: RoomInput & { name: string }, actor: User): Promise<ChatRoom> {
  const tenant = requireTenant(ctx)
  await guardLock(ctx, data, actor)
  const [audience, roleIds] = await resolveAudience(ctx, data, actor)

  const room = await db()
    .transaction()
    .execute(async (trx) => {
      const created = await trx
        .insertInto('chat_rooms')
        .values({
          tenant_id: tenant.id,
          name: data.name,
          description: data.description ?? null,
          ...(data.icon !== undefined ? { icon: data.icon } : {}),
          ...(data.is_locked !== undefined ? { is_locked: data.is_locked } : {}),
          audience,
          slug: await uniqueSlug(trx, tenant.id, data.name),
          created_by: actor.id
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      await syncRoomRoles(trx, created.id, roleIds)
      return created
    })

  await signalRoom(ctx, room, 'created')
  return room
}

export async function updateRoom(ctx: Ctx, room: ChatRoom, data: RoomInput, actor: User): Promise<ChatRoom> {
  await guardLock(ctx, data, actor, room)
  const changesAudience = data.audience !== undefined || data.role_ids !== undefined

  if (changesAudience && room.is_default) {
    throw new BusinessRuleError(t(ctx, 'messages.chat_default_room_audience'), 'chat_default_room_audience', 422)
  }

  // Resolved before the transaction: it reads the actor's ACL
  let audience: [ChatAudience, number[]] | null = null
  if (changesAudience) {
    const currentRoles = data.role_ids ?? ((await roomRoles([room.id])).get(room.id) ?? []).map((r) => r.id)
    audience = await resolveAudience(ctx, { audience: data.audience ?? room.audience, role_ids: currentRoles }, actor)
  }

  const updated = await db()
    .transaction()
    .execute(async (trx) => {
      const changes: Partial<Pick<ChatRoom, 'name' | 'description' | 'icon' | 'is_locked' | 'audience'>> = {}
      if (data.name !== undefined) changes.name = data.name
      if (data.description !== undefined) changes.description = data.description
      if (data.icon !== undefined) changes.icon = data.icon
      if (data.is_locked !== undefined) changes.is_locked = data.is_locked
      if (audience) changes.audience = audience[0]

      const saved = await trx
        .updateTable('chat_rooms')
        .set({ ...changes, updated_at: new Date() })
        .where('id', '=', room.id)
        .returningAll()
        .executeTakeFirstOrThrow()

      if (audience) await syncRoomRoles(trx, room.id, audience[1])
      return saved
    })

  await signalRoom(ctx, updated, 'updated')
  return updated
}

export async function deleteRoom(ctx: Ctx, room: ChatRoom): Promise<void> {
  if (room.is_default) {
    throw new BusinessRuleError(t(ctx, 'messages.chat_default_room'), 'chat_default_room', 422)
  }

  await db().deleteFrom('chat_rooms').where('id', '=', room.id).execute()
  await signalRoom(ctx, room, 'deleted')
}

// -------------------------------------------------------------------- messages

async function authorsOf(messages: ChatMessage[], executor: Executor = db()) {
  const ids = [...new Set(messages.map((m) => m.user_id).filter((id): id is number => id !== null))]
  if (!ids.length) return new Map<number, { id: number; name: string }>()
  const rows = await executor.selectFrom('users').select(['id', 'name']).where('id', 'in', ids).execute()
  return new Map(rows.map((row) => [row.id, row]))
}

export async function messageResources(ctx: Ctx, messages: ChatMessage[]) {
  const authors = await authorsOf(messages)
  return Promise.all(messages.map((m) => chatMessageResource(ctx, m, m.user_id !== null ? authors.get(m.user_id) ?? null : null)))
}

/**
 * A page of history, oldest first, ending just before `beforeId` (or at the newest message).
 */
export async function history(room: ChatRoom, beforeId: number | null, limit: number): Promise<ChatMessage[]> {
  let query = db().selectFrom('chat_messages').selectAll().where('room_id', '=', room.id).where('deleted_at', 'is', null)
  if (beforeId) query = query.where('id', '<', beforeId)
  const rows = await query.orderBy('id', 'desc').limit(limit).execute()
  return rows.reverse()
}

export async function sendMessage(ctx: Ctx, room: ChatRoom, author: User, body: string): Promise<ChatMessage> {
  if (room.is_locked && !(await isAdmin(author))) {
    throw new BusinessRuleError(t(ctx, 'messages.chat_room_locked'), 'chat_room_locked', 403)
  }

  const mute = await activeMuteFor(author, room)
  if (mute) {
    const message =
      mute.expires_at === null
        ? t(ctx, 'messages.chat_muted')
        : t(ctx, 'messages.chat_muted_until', { time: formatShort(mute.expires_at, userTimezone(ctx, author)) })

    throw new BusinessRuleError(message, 'chat_muted', 403)
  }

  const message = await db()
    .transaction()
    .execute(async (trx) => {
      const created = await trx
        .insertInto('chat_messages')
        .values({ tenant_id: room.tenant_id, room_id: room.id, user_id: author.id, body })
        .returningAll()
        .executeTakeFirstOrThrow()

      // Your own message never counts as unread
      await markRead(room, author, created.id, trx)
      return created
    })

  await broadcast(ctx, roomChannel(room.id), 'message.sent', await chatMessageResource(ctx, message, author))
  return message
}

export async function deleteMessage(ctx: Ctx, message: ChatMessage, actor: User): Promise<void> {
  const author = message.user_id !== null
    ? (await db().selectFrom('users').select(['id', 'name', 'tenant_id']).where('id', '=', message.user_id).executeTakeFirst()) ?? null
    : null

  if (!(await canDeleteMessage(ctx, actor, message, author))) {
    throw new BusinessRuleError(t(ctx, 'messages.chat_cannot_moderate'), 'chat_cannot_moderate', 403)
  }

  const now = new Date()
  await db().updateTable('chat_messages').set({ deleted_by: actor.id, deleted_at: now, updated_at: now }).where('id', '=', message.id).execute()

  await broadcast(ctx, roomChannel(message.room_id), 'message.deleted', { id: message.id, room_id: message.room_id, deleted_by: actor.id })
}

/**
 * Move the viewer's read marker forward (never backwards) to a message, or to the newest one.
 */
export async function markRead(room: ChatRoom, viewer: User, messageId: number | null = null, executor: Executor = db()): Promise<void> {
  let target = messageId
  if (target === null) {
    const newest = await executor
      .selectFrom('chat_messages')
      .select((eb) => eb.fn.max('id').as('id'))
      .where('room_id', '=', room.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    target = Number(newest?.id ?? 0)
  }

  if (target <= 0) return

  const now = new Date()
  // Upsert that only ever moves the marker forward
  await executor
    .insertInto('chat_room_reads')
    .values({ room_id: room.id, user_id: viewer.id, last_read_message_id: target, updated_at: now })
    .onConflict((oc) =>
      oc
        .columns(['room_id', 'user_id'])
        .doUpdateSet({ last_read_message_id: target, updated_at: now })
        .where('chat_room_reads.last_read_message_id', '<', target)
    )
    .execute()
}

// ----------------------------------------------------------------- internals

/**
 * Who a room is for, validated against what the actor may grant:
 *
 * - administrators may pick any audience;
 * - others may open a room to everyone, or to roles they hold themselves
 *   (never "administrators only", never a room they would be locked out of).
 */
async function resolveAudience(ctx: Ctx, data: { audience?: ChatAudience; role_ids?: number[] }, actor: User): Promise<[ChatAudience, number[]]> {
  const audience = data.audience ?? 'everyone'
  const roleIds = audience === 'roles' ? [...new Set((data.role_ids ?? []).map(Number))] : []

  if (audience === 'roles' && roleIds.length === 0) {
    throw new BusinessRuleError(t(ctx, 'messages.chat_audience_roles_required'), 'chat_audience_roles_required', 422)
  }

  if (!(await isAdmin(actor))) {
    const own = await roleIdsOf(actor)
    const allowed = audience === 'everyone' || (audience === 'roles' && roleIds.some((id) => own.includes(id)))

    if (!allowed) {
      throw new BusinessRuleError(t(ctx, 'messages.chat_audience_forbidden'), 'chat_audience_forbidden', 403)
    }
  }

  return [audience, roleIds]
}

async function syncRoomRoles(executor: Executor, roomId: number, roleIds: number[]): Promise<void> {
  await executor.deleteFrom('chat_room_role').where('room_id', '=', roomId).execute()
  if (roleIds.length) {
    await executor
      .insertInto('chat_room_role')
      .values(roleIds.map((roleId) => ({ room_id: roomId, role_id: roleId })))
      .execute()
  }
}

/**
 * Rooms changed: tell the workspace to resync its room list. Only the id goes
 * out, so a restricted room's name never reaches members who cannot see it.
 */
async function signalRoom(ctx: Ctx, room: ChatRoom, action: 'created' | 'updated' | 'deleted'): Promise<void> {
  await broadcast(ctx, tenantChannel(room.tenant_id), 'room.changed', { action, room: { id: room.id } })
}

/** Locking a room silences everyone but administrators, so only they may toggle it */
async function guardLock(ctx: Ctx, data: RoomInput, actor: User, room?: ChatRoom): Promise<void> {
  if (data.is_locked === undefined || (await isAdmin(actor))) return

  const changes = room === undefined ? data.is_locked : data.is_locked !== room.is_locked

  if (changes) {
    throw new BusinessRuleError(t(ctx, 'messages.chat_admin_only'), 'chat_admin_only', 403)
  }
}

async function uniqueSlug(executor: Executor, tenantId: number, name: string): Promise<string> {
  const base = slugify(name) || 'room'
  let slug = base
  let n = 2

  while (await executor.selectFrom('chat_rooms').select('id').where('tenant_id', '=', tenantId).where('slug', '=', slug).executeTakeFirst()) {
    slug = `${base}-${n++}`
  }

  return slug
}
