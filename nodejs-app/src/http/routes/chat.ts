import type { FastifyInstance, FastifyRequest } from 'fastify'
import { hasPermission } from '../../authorization/acl.ts'
import { db } from '../../db/database.ts'
import type { ChatMessage } from '../../db/schema.ts'
import { CHAT_AUDIENCES, CHAT_MUTE_DURATIONS, CHAT_ROOM_ICONS } from '../../domain/enums.ts'
import {
  audienceRoleOptions,
  createRoom,
  deleteMessage,
  deleteRoom,
  ensureDefaultRooms,
  history,
  markRead,
  messageResources,
  roomPayload,
  roomsFor,
  sendMessage,
  updateRoom
} from '../../services/chat/chatService.ts'
import { card } from '../../services/chat/directory.ts'
import { activeMuteResources, mute, muteResource, unmute } from '../../services/chat/moderation.ts'
import { accessibleRoom, findAccessibleRoom } from '../../services/chat/rooms.ts'
import { requireTenant, requireUser } from '../../support/context.ts'
import { actor, body, created, idParam, noContent, orNotFound, query } from '../helpers.ts'
import { featureGuards, permission, throttle } from '../middleware.ts'
import { chatMessageResource } from '../resources.ts'
import {
  array,
  boolean,
  distinct,
  exists,
  integer,
  max,
  min,
  nullable,
  oneOf,
  required,
  sometimes,
  string,
  unique,
  validate
} from '../validation.ts'

/**
 * Live chat: available to every tenant type. Realtime events go through the
 * websocket server; moderation rules live in services/chat/moderation.ts.
 */
const PAGE_SIZE = 50

function roomRules(request: FastifyRequest, creating: boolean, ignoreId: number | null) {
  const tenantId = requireTenant(request.ctx).id
  const byTenant = (q: any) => q.where('tenant_id', '=', tenantId)

  return {
    name: [creating ? required : sometimes, string, max(60), unique('chat_rooms', 'name', byTenant, ignoreId)],
    description: [sometimes, nullable, string, max(240)],
    icon: [sometimes, string, oneOf(CHAT_ROOM_ICONS)],
    // Administrators only, enforced by the chat service
    is_locked: [sometimes, boolean],
    // Who may enter: everyone, administrators only, or the listed roles (rules in the chat service)
    audience: [sometimes, string, oneOf(CHAT_AUDIENCES)],
    role_ids: [sometimes, array, max(20)],
    'role_ids.*': [integer, distinct, exists('roles', 'id', byTenant)]
  }
}

/** {room}: only rooms the signed-in user may enter */
function room(request: FastifyRequest) {
  return findAccessibleRoom(request.ctx, requireUser(request.ctx), idParam(request, 'room'))
}

/** {message}: only messages of rooms the signed-in user may enter */
async function findMessage(request: FastifyRequest): Promise<ChatMessage> {
  const ctx = request.ctx
  const message = await db()
    .selectFrom('chat_messages')
    .selectAll()
    .where('id', '=', idParam(request, 'message'))
    .where('tenant_id', '=', requireTenant(ctx).id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()

  const visible = message ? await accessibleRoom(ctx, requireUser(ctx), message.room_id) : null
  return orNotFound(ctx, visible ? message : null)
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const guards = [...featureGuards, permission('chat.view')]
  const managers = [...guards, permission('chat.manage')]
  const moderators = [...guards, permission('chat.mute')]

  /**
   * Rooms the viewer may enter with their unread counts, every active mute (meta.mutes)
   * and, for room managers, the workspace's roles to pick an audience from (meta.roles).
   */
  app.get('/chat/rooms', { preHandler: guards }, async (request) => {
    const ctx = request.ctx
    const user = requireUser(ctx)
    await ensureDefaultRooms(ctx)

    return {
      data: await roomsFor(ctx, user),
      meta: {
        mutes: await activeMuteResources(ctx),
        roles: (await hasPermission(user, 'chat.manage')) ? await audienceRoleOptions(ctx, user) : []
      }
    }
  })

  app.post('/chat/rooms', { preHandler: managers }, async (request, reply) => {
    const data = await validate(request.ctx, body(request), roomRules(request, true, null))
    const created_ = await createRoom(request.ctx, data as Parameters<typeof createRoom>[1], actor(request).user)
    return created(reply, { data: await roomPayload(request.ctx, created_) })
  })

  app.patch('/chat/rooms/:room', { preHandler: managers }, async (request) => {
    const current = await room(request)
    const data = await validate(request.ctx, body(request), roomRules(request, false, current.id))
    return { data: await roomPayload(request.ctx, await updateRoom(request.ctx, current, data, actor(request).user)) }
  })

  app.delete('/chat/rooms/:room', { preHandler: managers }, async (request, reply) => {
    await deleteRoom(request.ctx, await room(request))
    return noContent(reply)
  })

  /** Mark the room read up to a message (default: the newest one) */
  app.post('/chat/rooms/:room/read', { preHandler: guards }, async (request, reply) => {
    const current = await room(request)
    const data = await validate(request.ctx, body(request), { message_id: [nullable, integer, min(1)] })
    await markRead(current, actor(request).user, data.message_id ?? null)
    return noContent(reply)
  })

  /** History, oldest first. `?before={id}` pages backwards; meta.has_more says whether older messages exist */
  app.get('/chat/rooms/:room/messages', { preHandler: guards }, async (request) => {
    const current = await room(request)
    const data = await validate(request.ctx, query(request), {
      before: [nullable, integer, min(1)],
      limit: [nullable, integer, min(1), max(100)]
    })
    const limit = data.limit ?? PAGE_SIZE
    const messages = await history(current, data.before ?? null, limit)

    return { data: await messageResources(request.ctx, messages), meta: { has_more: messages.length === limit } }
  })

  app.post('/chat/rooms/:room/messages', { preHandler: [...guards, throttle('chat')] }, async (request, reply) => {
    const current = await room(request)
    // Whitespace-only bodies are trimmed to null by the input normaliser and fail `required`
    const data = await validate(request.ctx, body(request), { body: [required, string, max(2000)] })
    const author = actor(request).user
    const message = await sendMessage(request.ctx, current, author, data.body)
    return created(reply, { data: await chatMessageResource(request.ctx, message, author) })
  })

  app.delete('/chat/messages/:message', { preHandler: guards }, async (request, reply) => {
    await deleteMessage(request.ctx, await findMessage(request), actor(request).user)
    return noContent(reply)
  })

  /**
   * Active team members who can use the chat (administrators, or a role granting chat.view);
   * with `?room={id}`, only those who may enter that room. Online status comes from the
   * room's presence channel, not from here.
   */
  app.get('/chat/members', { preHandler: guards }, async (request) => {
    const ctx = request.ctx
    const tenant = requireTenant(ctx)
    const data = await validate(ctx, query(request), { room: [nullable, integer] })
    const target = data.room !== undefined && data.room !== null ? orNotFound(ctx, await accessibleRoom(ctx, requireUser(ctx), data.room)) : null

    const roomRoleIds = target?.audience === 'roles'
      ? (await db().selectFrom('chat_room_role').select('role_id').where('room_id', '=', target.id).execute()).map((r) => r.role_id)
      : []

    let q = db()
      .selectFrom('users')
      .select(['users.id', 'users.name'])
      .where('users.tenant_id', '=', tenant.id)
      .where('users.is_active', '=', true)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('role_user')
            .innerJoin('roles', 'roles.id', 'role_user.role_id')
            .select('roles.id')
            .whereRef('role_user.user_id', '=', 'users.id')
            .where((r) =>
              r.or([
                r('roles.is_admin', '=', true),
                r.exists(
                  r
                    .selectFrom('permission_role')
                    .innerJoin('permissions', 'permissions.id', 'permission_role.permission_id')
                    .select('permission_role.role_id')
                    .whereRef('permission_role.role_id', '=', 'roles.id')
                    .where('permissions.name', '=', 'chat.view')
                )
              ])
            )
        )
      )

    if (target?.audience === 'admins') {
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('role_user')
            .innerJoin('roles', 'roles.id', 'role_user.role_id')
            .select('roles.id')
            .whereRef('role_user.user_id', '=', 'users.id')
            .where('roles.is_admin', '=', true)
        )
      )
    }

    if (target?.audience === 'roles') {
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('role_user')
            .innerJoin('roles', 'roles.id', 'role_user.role_id')
            .select('roles.id')
            .whereRef('role_user.user_id', '=', 'users.id')
            .where((r) => r.or([r('roles.is_admin', '=', true), r('roles.id', 'in', roomRoleIds.length ? roomRoleIds : [-1])]))
        )
      )
    }

    const members = await q.orderBy('users.name').orderBy('users.id').execute()
    return { data: await Promise.all(members.map((m) => card(ctx, m))) }
  })

  app.get('/chat/mutes', { preHandler: guards }, async (request) => ({
    data: await activeMuteResources(request.ctx)
  }))

  /** Who may mute whom is decided by the moderation rules (admins: everyone; chat.mute: everyone but admins) */
  app.post('/chat/mutes', { preHandler: moderators }, async (request, reply) => {
    const ctx = request.ctx
    const tenant = requireTenant(ctx)
    const byTenant = (q: any) => q.where('tenant_id', '=', tenant.id)

    const data = await validate(ctx, body(request), {
      user_id: [required, integer, exists('users', 'id', byTenant)],
      // Omitted / null = mute in every room
      room_id: [nullable, integer, exists('chat_rooms', 'id', byTenant)],
      // Omitted / null = until someone lifts it
      duration_minutes: [nullable, integer, oneOf(CHAT_MUTE_DURATIONS)],
      reason: [nullable, string, max(240)]
    })

    const target = orNotFound(
      ctx,
      await db().selectFrom('users').selectAll().where('id', '=', data.user_id).where('tenant_id', '=', tenant.id).executeTakeFirst()
    )
    const scope = data.room_id !== undefined && data.room_id !== null ? orNotFound(ctx, await accessibleRoom(ctx, requireUser(ctx), data.room_id)) : null

    const saved = await mute(ctx, requireUser(ctx), target, scope, data.duration_minutes ?? null, data.reason ?? null)
    return created(reply, { data: await muteResource(ctx, saved) })
  })

  app.delete('/chat/mutes/:mute', { preHandler: moderators }, async (request, reply) => {
    const ctx = request.ctx
    const current = orNotFound(
      ctx,
      await db()
        .selectFrom('chat_mutes')
        .selectAll()
        .where('id', '=', idParam(request, 'mute'))
        .where('tenant_id', '=', requireTenant(ctx).id)
        .executeTakeFirst()
    )
    await unmute(ctx, requireUser(ctx), current)
    return noContent(reply)
  })
}
