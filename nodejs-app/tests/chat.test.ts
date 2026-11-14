import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatRoom, Tenant, User } from '../src/db/schema.ts'
import { api, assertStatus, assertValidationErrors, broadcasts, createTenant, createUser, roleId, useTestApp } from './helpers.ts'

const { db } = useTestApp()

/*
| Clinic roles (src/config/permissions.ts):
|   admin        → every permission, may moderate everyone (admins included), enters every room
|   doctor       → chat.view + chat.mute: moderates everyone except admins; enters the Doctors room
|   receptionist → chat.view only: can only chat
|   member       → chat.view only (self-registered users)
*/
describe('live chat', () => {
  let clinic: Tenant
  let admin: User
  let moderator: User
  let member: User
  let general: ChatRoom
  let announcements: ChatRoom
  let adminsRoom: ChatRoom
  let doctorsRoom: ChatRoom

  const room = (slug: string) =>
    db().selectFrom('chat_rooms').selectAll().where('tenant_id', '=', clinic.id).where('slug', '=', slug).executeTakeFirstOrThrow()

  const postMessage = (user: User, target: ChatRoom, body = 'Hello') =>
    api('POST', `/api/v1/chat/rooms/${target.id}/messages`, { as: user, body: { body } })

  const mute = (actor: User, target: User, extra: Record<string, unknown> = {}) =>
    api('POST', '/api/v1/chat/mutes', { as: actor, body: { user_id: target.id, ...extra } })

  const roomSlugs = async (user: User): Promise<string[]> => {
    const response = await api('GET', '/api/v1/chat/rooms', { as: user })
    assertStatus(response, 200)
    return response.body.data.map((r: ChatRoom) => r.slug)
  }

  const sameSet = (actual: unknown[], expected: unknown[]) => assert.deepEqual([...actual].sort(), [...expected].sort())

  const events = (event: string) => broadcasts.events.filter((e) => e.event === event)

  beforeEach(async () => {
    clinic = await createTenant('doctor')
    admin = await createUser(clinic, ['admin'])
    moderator = await createUser(clinic, ['doctor'])
    member = await createUser(clinic, ['receptionist'])

    // First listing provisions the default rooms
    assertStatus(await api('GET', '/api/v1/chat/rooms', { as: member }), 200)
    general = await room('general')
    announcements = await room('announcements')
    adminsRoom = await room('admins')
    doctorsRoom = await room('doctors')
  })

  it('provisions a Global room for everyone plus admin and role rooms', async () => {
    const response = await api('GET', '/api/v1/chat/rooms', { as: admin })
    assertStatus(response, 200)
    assert.equal(response.body.data[0].slug, 'general')
    assert.equal(response.body.data[0].name, 'Global')
    assert.equal(response.body.data[0].is_default, true)
    assert.equal(response.body.data[0].audience, 'everyone')
    assert.deepEqual(response.body.meta.mutes, [])

    assert.equal(announcements.is_locked, true)
    assert.equal(adminsRoom.audience, 'admins')
    assert.equal(doctorsRoom.audience, 'roles')
    const roles = await db()
      .selectFrom('chat_room_role')
      .innerJoin('roles', 'roles.id', 'chat_room_role.role_id')
      .select('roles.slug')
      .where('chat_room_role.room_id', '=', doctorsRoom.id)
      .execute()
    assert.deepEqual(roles.map((r) => r.slug), ['doctor'])
  })

  it('shows each member only the rooms of their audience', async () => {
    sameSet(await roomSlugs(admin), ['general', 'announcements', 'admins', 'doctors'])
    sameSet(await roomSlugs(moderator), ['general', 'announcements', 'doctors'])
    sameSet(await roomSlugs(member), ['general', 'announcements'])
  })

  it('hides restricted rooms everywhere, not just in the list', async () => {
    // Reading, posting and the members list of a room outside your audience are all 404s
    assertStatus(await api('GET', `/api/v1/chat/rooms/${doctorsRoom.id}/messages`, { as: member }), 404)
    assertStatus(await postMessage(member, doctorsRoom), 404)
    assertStatus(await postMessage(moderator, adminsRoom), 404)
    assertStatus(await api('GET', `/api/v1/chat/members?room=${adminsRoom.id}`, { as: member }), 404)

    // ...and their messages cannot be targeted by id either
    const secret = await postMessage(admin, adminsRoom, 'admins only')
    assertStatus(secret, 201)
    assertStatus(await api('DELETE', `/api/v1/chat/messages/${secret.body.data.id}`, { as: moderator }), 404)

    // Doctors and admins share the Doctors room
    assertStatus(await postMessage(moderator, doctorsRoom, 'for doctors'), 201)
    const history = await api('GET', `/api/v1/chat/rooms/${doctorsRoom.id}/messages`, { as: admin })
    assert.equal(history.body.data[0].body, 'for doctors')
  })

  it('lists a room’s members by its audience', async () => {
    const ids = async (target: ChatRoom) =>
      (await api('GET', `/api/v1/chat/members?room=${target.id}`, { as: admin })).body.data.map((m: { id: number }) => m.id).sort()

    assert.deepEqual(await ids(general), [admin.id, moderator.id, member.id].sort())
    assert.deepEqual(await ids(doctorsRoom), [admin.id, moderator.id].sort())
    assert.deepEqual(await ids(adminsRoom), [admin.id])
  })

  it('lets every chat member post in the Global room and broadcasts on the room channel', async () => {
    const sent = await postMessage(member, general, '  Good morning  ')
    assertStatus(sent, 201)
    assert.equal(sent.body.data.body, 'Good morning')
    assert.equal(sent.body.data.user.id, member.id)
    assert.equal(sent.body.data.user.is_admin, false)

    const [event] = events('message.sent')
    assert.equal(event.channel, `private-chat.feed.${general.id}`)
    assert.equal((event.data as { body: string }).body, 'Good morning')

    assertValidationErrors(await postMessage(member, general, '   '), ['body'])
  })

  it('skips the sender’s own socket when broadcasting (X-Socket-ID)', async () => {
    await api('POST', `/api/v1/chat/rooms/${general.id}/messages`, { as: member, body: { body: 'Hi' }, headers: { 'x-socket-id': 'Ab12Cd34Ef56Gh78Ij90' } })
    assert.equal(events('message.sent')[0].except, 'Ab12Cd34Ef56Gh78Ij90')
  })

  it('blocks users without chat.view', async () => {
    const outsider = await createUser(clinic)
    assertStatus(await api('GET', '/api/v1/chat/rooms', { as: outsider }), 403)
    assertStatus(await postMessage(outsider, general), 403)
  })

  it('only lets administrators post in a locked room', async () => {
    assert.equal((await postMessage(member, announcements)).body.code, 'chat_room_locked')
    const doctorTry = await postMessage(moderator, announcements)
    assertStatus(doctorTry, 403)
    assert.equal(doctorTry.body.code, 'chat_room_locked')
    assertStatus(await postMessage(admin, announcements), 201)
  })

  it('lets a moderator mute a member in one room only', async () => {
    const muted = await mute(moderator, member, { room_id: general.id, duration_minutes: 60, reason: 'Spam' })
    assertStatus(muted, 201)
    assert.equal(muted.body.data.user.id, member.id)
    assert.equal(muted.body.data.room_id, general.id)
    assert.equal(muted.body.data.reason, 'Spam')
    assert.equal(muted.body.data.muted_by.id, moderator.id)

    const [event] = events('mute.changed')
    assert.equal((event.data as { action: string }).action, 'muted')
    assert.equal(event.channel, `private-chat.tenant.${clinic.id}`)

    const blocked = await postMessage(member, general)
    assertStatus(blocked, 403)
    assert.equal(blocked.body.code, 'chat_muted')

    // Other rooms are unaffected
    const frontDesk = await db()
      .insertInto('chat_rooms')
      .values({ tenant_id: clinic.id, name: 'Front desk', slug: 'front-desk' })
      .returningAll()
      .executeTakeFirstOrThrow()
    assertStatus(await postMessage(member, frontDesk), 201)
  })

  it('cannot scope a mute to a room the moderator cannot enter', async () => {
    assertStatus(await mute(moderator, member, { room_id: adminsRoom.id }), 404)
  })

  it('mutes everywhere when no room is given, until lifted', async () => {
    const muted = await mute(moderator, member)
    assertStatus(muted, 201)
    assert.equal(muted.body.data.room_id, null)
    assert.equal(muted.body.data.expires_at, null)

    assert.equal((await postMessage(member, general)).body.code, 'chat_muted')
    assert.equal((await api('GET', '/api/v1/chat/rooms', { as: member })).body.meta.mutes.length, 1)
  })

  it('lets timed mutes expire on their own', async () => {
    assertStatus(await mute(moderator, member, { duration_minutes: 15 }), 201)
    assertStatus(await postMessage(member, general), 403)

    // 16 minutes later
    await db().updateTable('chat_mutes').set({ expires_at: new Date(Date.now() - 60_000) }).execute()

    assertStatus(await postMessage(member, general), 201)
    assert.equal((await api('GET', '/api/v1/chat/mutes', { as: member })).body.data.length, 0)
  })

  it('only accepts the offered mute durations', async () => {
    assertValidationErrors(await mute(moderator, member, { duration_minutes: 7 }), ['duration_minutes'])
  })

  it('re-muting replaces the previous terms instead of stacking', async () => {
    assertStatus(await mute(moderator, member, { duration_minutes: 15 }), 201)
    const again = await mute(moderator, member)
    assertStatus(again, 201)
    assert.equal(again.body.data.expires_at, null)

    const rows = await db().selectFrom('chat_mutes').select('id').where('user_id', '=', member.id).execute()
    assert.equal(rows.length, 1)
  })

  it('never lets moderators without admin rights mute administrators', async () => {
    const response = await mute(moderator, admin)
    assertStatus(response, 403)
    assert.equal(response.body.code, 'chat_cannot_moderate')
    assert.equal((await db().selectFrom('chat_mutes').select('id').execute()).length, 0)
  })

  it('lets administrators mute everyone, other administrators and moderators included', async () => {
    const otherAdmin = await createUser(clinic, ['admin'])
    assertStatus(await mute(admin, moderator), 201)
    assertStatus(await mute(admin, otherAdmin), 201)
    assertStatus(await mute(admin, member), 201)

    const blocked = await postMessage(otherAdmin, general)
    assertStatus(blocked, 403)
    assert.equal(blocked.body.code, 'chat_muted')
  })

  it('lets members without chat.mute only chat', async () => {
    assertStatus(await mute(member, moderator), 403)
  })

  it('refuses self mutes and members of another workspace', async () => {
    const self = await mute(admin, admin)
    assertStatus(self, 403)
    assert.equal(self.body.code, 'chat_cannot_moderate')

    const stranger = await createUser(await createTenant('marketplace'), ['sales'])
    assertValidationErrors(await mute(admin, stranger), ['user_id'])
  })

  it('applies the same hierarchy to lifting mutes', async () => {
    const adminMute = (await mute(admin, await createUser(clinic, ['admin']))).body.data.id
    const memberMute = (await mute(admin, member)).body.data.id

    // A moderator cannot lift an administrator's mute (they could not have set it either)
    assertStatus(await api('DELETE', `/api/v1/chat/mutes/${adminMute}`, { as: moderator }), 403)
    assertStatus(await api('DELETE', `/api/v1/chat/mutes/${memberMute}`, { as: moderator }), 204)

    const unmuted = events('mute.changed').find((e) => (e.data as { action: string }).action === 'unmuted')
    assert.equal((unmuted?.data as { mute: { id: number } }).mute.id, memberMute)

    assertStatus(await postMessage(member, general), 201)
  })

  it('applies the moderation hierarchy to deleting messages', async () => {
    const mine = (await postMessage(member, general)).body.data.id
    const moderators = (await postMessage(moderator, general)).body.data.id
    const admins = (await postMessage(admin, general)).body.data.id

    // Members delete only their own messages
    assertStatus(await api('DELETE', `/api/v1/chat/messages/${moderators}`, { as: member }), 403)
    assertStatus(await api('DELETE', `/api/v1/chat/messages/${mine}`, { as: member }), 204)

    // Moderators cannot touch administrators' messages
    assertStatus(await api('DELETE', `/api/v1/chat/messages/${admins}`, { as: moderator }), 403)

    // Administrators can remove anyone's
    assertStatus(await api('DELETE', `/api/v1/chat/messages/${moderators}`, { as: admin }), 204)

    assert.equal(events('message.deleted').length, 2)
    const removed = await db().selectFrom('chat_messages').select('deleted_by').where('id', '=', moderators).executeTakeFirstOrThrow()
    assert.equal(removed.deleted_by, admin.id)

    const history = await api('GET', `/api/v1/chat/rooms/${general.id}/messages`, { as: member })
    assert.equal(history.body.data.length, 1)
    assert.equal(history.body.data[0].id, admins)
  })

  describe('room management', () => {
    let keeper: User
    let doctorRoleId: number
    let receptionRoleId: number

    beforeEach(async () => {
      // A non-admin room manager who is also a doctor
      const keeperRole = await db()
        .insertInto('roles')
        .values({ tenant_id: clinic.id, name: 'Room keeper', slug: 'room-keeper' })
        .returningAll()
        .executeTakeFirstOrThrow()
      const perms = await db().selectFrom('permissions').select('id').where('name', 'in', ['chat.view', 'chat.manage']).execute()
      await db()
        .insertInto('permission_role')
        .values(perms.map((p) => ({ role_id: keeperRole.id, permission_id: p.id })))
        .execute()

      keeper = await createUser(clinic, ['room-keeper', 'doctor'])
      doctorRoleId = await roleId(clinic, 'doctor')
      receptionRoleId = await roleId(clinic, 'receptionist')
    })

    it('is limited to chat.manage holders and signals the workspace without leaking names', async () => {
      assertStatus(await api('POST', '/api/v1/chat/rooms', { as: member, body: { name: 'Lounge' } }), 403)

      const created = await api('POST', '/api/v1/chat/rooms', { as: admin, body: { name: 'Night shift', icon: 'bolt', description: 'After hours' } })
      assertStatus(created, 201)
      assert.equal(created.body.data.slug, 'night-shift')
      assert.equal(created.body.data.audience, 'everyone')

      const [event] = events('room.changed')
      assert.deepEqual(event.data, { action: 'created', room: { id: created.body.data.id } })
      assert.equal(event.channel, `private-chat.tenant.${clinic.id}`)

      assertValidationErrors(await api('POST', '/api/v1/chat/rooms', { as: admin, body: { name: 'Night shift' } }), ['name'])
      assertValidationErrors(await api('POST', '/api/v1/chat/rooms', { as: admin, body: { name: 'Bad icon', icon: 'skull' } }), ['icon'])
    })

    it('lets administrators open rooms to admins only or to any roles', async () => {
      const board = await api('POST', '/api/v1/chat/rooms', { as: admin, body: { name: 'Board', audience: 'admins' } })
      assertStatus(board, 201)
      assert.equal(board.body.data.audience, 'admins')

      const office = await api('POST', '/api/v1/chat/rooms', { as: admin, body: { name: 'Front office', audience: 'roles', role_ids: [receptionRoleId] } })
      assertStatus(office, 201)
      assert.equal(office.body.data.roles[0].slug, 'receptionist')

      const memberRooms = await roomSlugs(member)
      assert.ok(memberRooms.includes('front-office') && !memberRooms.includes('board'))
      const moderatorRooms = await roomSlugs(moderator)
      assert.ok(!moderatorRooms.includes('front-office') && !moderatorRooms.includes('board'))

      const empty = await api('POST', '/api/v1/chat/rooms', { as: admin, body: { name: 'Empty', audience: 'roles', role_ids: [] } })
      assert.equal(empty.body.code, 'chat_audience_roles_required')
    })

    it('lets non-admin managers open rooms only to everyone or to their own roles', async () => {
      assertStatus(await api('POST', '/api/v1/chat/rooms', { as: keeper, body: { name: 'Doctors lounge', audience: 'roles', role_ids: [doctorRoleId] } }), 201)
      assertStatus(await api('POST', '/api/v1/chat/rooms', { as: keeper, body: { name: 'Open lounge' } }), 201)

      const board = await api('POST', '/api/v1/chat/rooms', { as: keeper, body: { name: 'Board', audience: 'admins' } })
      assertStatus(board, 403)
      assert.equal(board.body.code, 'chat_audience_forbidden')

      const desk = await api('POST', '/api/v1/chat/rooms', { as: keeper, body: { name: 'Desk', audience: 'roles', role_ids: [receptionRoleId] } })
      assertStatus(desk, 403)
      assert.equal(desk.body.code, 'chat_audience_forbidden')
    })

    it('lets non-admin managers rename but not lock rooms', async () => {
      const id = (await api('POST', '/api/v1/chat/rooms', { as: admin, body: { name: 'Night shift' } })).body.data.id

      const renamed = await api('PATCH', `/api/v1/chat/rooms/${id}`, { as: keeper, body: { name: 'Night owls' } })
      assertStatus(renamed, 200)
      assert.equal(renamed.body.data.name, 'Night owls')

      const lock = await api('PATCH', `/api/v1/chat/rooms/${id}`, { as: keeper, body: { is_locked: true } })
      assertStatus(lock, 403)
      assert.equal(lock.body.code, 'chat_admin_only')

      const locked = await api('PATCH', `/api/v1/chat/rooms/${id}`, { as: admin, body: { is_locked: true } })
      assertStatus(locked, 200)
      assert.equal(locked.body.data.is_locked, true)

      // Narrowing the audience takes the room away from those no longer in it
      assertStatus(await api('PATCH', `/api/v1/chat/rooms/${id}`, { as: admin, body: { audience: 'admins' } }), 200)
      assert.ok(!(await roomSlugs(member)).includes('night-shift'))

      assertStatus(await api('DELETE', `/api/v1/chat/rooms/${id}`, { as: admin }), 204)
      assert.ok(events('room.changed').some((e) => (e.data as { action: string; room: { id: number } }).action === 'deleted' && (e.data as { room: { id: number } }).room.id === id))
    })

    it('keeps the Global room open to everyone and undeletable', async () => {
      const narrow = await api('PATCH', `/api/v1/chat/rooms/${general.id}`, { as: admin, body: { audience: 'admins' } })
      assertStatus(narrow, 422)
      assert.equal(narrow.body.code, 'chat_default_room_audience')

      const destroy = await api('DELETE', `/api/v1/chat/rooms/${general.id}`, { as: admin })
      assertStatus(destroy, 422)
      assert.equal(destroy.body.code, 'chat_default_room')
    })

    it('gives room managers the workspace roles to pick from', async () => {
      const roles = (await api('GET', '/api/v1/chat/rooms', { as: keeper })).body.meta.roles as { slug: string; assignable: boolean }[]
      assert.equal(roles.find((r) => r.slug === 'doctor')?.assignable, true)
      assert.equal(roles.find((r) => r.slug === 'receptionist')?.assignable, false)

      assert.deepEqual((await api('GET', '/api/v1/chat/rooms', { as: member })).body.meta.roles, [])
    })
  })

  it('tracks unread messages per member', async () => {
    await postMessage(moderator, general, 'One')
    const last = (await postMessage(moderator, general, 'Two')).body.data.id

    const rooms = await api('GET', '/api/v1/chat/rooms', { as: member })
    assert.equal(rooms.body.data[0].unread_count, 2)
    assert.equal(rooms.body.data[0].last_message.body, 'Two')

    // The author's own messages never count as unread
    assert.equal((await api('GET', '/api/v1/chat/rooms', { as: moderator })).body.data[0].unread_count, 0)

    assertStatus(await api('POST', `/api/v1/chat/rooms/${general.id}/read`, { as: member, body: { message_id: last } }), 204)
    assert.equal((await api('GET', '/api/v1/chat/rooms', { as: member })).body.data[0].unread_count, 0)

    // The marker never moves backwards
    assertStatus(await api('POST', `/api/v1/chat/rooms/${general.id}/read`, { as: member, body: { message_id: 1 } }), 204)
    assert.equal((await api('GET', '/api/v1/chat/rooms', { as: member })).body.data[0].unread_count, 0)
  })

  it('pages history backwards, oldest first', async () => {
    const ids: number[] = []
    for (let i = 1; i <= 5; i++) ids.push((await postMessage(member, general, `m${i}`)).body.data.id)

    const page = await api('GET', `/api/v1/chat/rooms/${general.id}/messages?limit=2`, { as: member })
    assert.deepEqual(page.body.data.map((m: { body: string }) => m.body), ['m4', 'm5'])
    assert.equal(page.body.meta.has_more, true)

    const older = await api('GET', `/api/v1/chat/rooms/${general.id}/messages?limit=2&before=${ids[1]}`, { as: member })
    assert.deepEqual(older.body.data.map((m: { body: string }) => m.body), ['m1'])
    assert.equal(older.body.meta.has_more, false)
  })

  it('keeps rooms, messages and mutes inside their workspace', async () => {
    const shopAdmin = await createUser(await createTenant('marketplace'), ['admin'])

    assertStatus(await api('GET', `/api/v1/chat/rooms/${general.id}/messages`, { as: shopAdmin }), 404)
    assertStatus(await postMessage(shopAdmin, general), 404)
    sameSet(await roomSlugs(shopAdmin), ['general', 'announcements', 'admins', 'managers'])
  })

  it('lists the members who can chat, flagging administrators', async () => {
    await createUser(clinic) // no role: cannot chat

    const response = await api('GET', '/api/v1/chat/members', { as: member })
    assertStatus(response, 200)
    const members = response.body.data as { id: number; is_admin: boolean }[]
    assert.deepEqual(members.map((m) => m.id).sort(), [admin.id, moderator.id, member.id].sort())
    assert.equal(members.find((m) => m.id === admin.id)?.is_admin, true)
  })
})
