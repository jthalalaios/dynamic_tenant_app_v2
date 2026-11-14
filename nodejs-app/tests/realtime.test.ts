import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server as HttpServer } from 'node:http'
import type { Server } from 'socket.io'
import { io as connect, type Socket } from 'socket.io-client'
import type { ChatRoom, Tenant, User } from '../src/db/schema.ts'
import { CHANNEL_EVENT, type ChannelEvent } from '../src/realtime/channels.ts'
import { attachRealtime, createRealtimeHttpServer } from '../src/realtime/server.ts'
import { issueToken } from '../src/services/auth/tokens.ts'
import { api, assertStatus, createTenant, createUser, useTestApp } from './helpers.ts'

const { db } = useTestApp()

/*
| Websocket channel authorization (the port of routes/channels.php), end to end:
| a real Socket.IO server and client.
*/
describe('websocket channels', () => {
  let httpServer: HttpServer
  let io: Server
  let url: string
  const sockets: Socket[] = []

  let clinic: Tenant
  let admin: User
  let moderator: User
  let member: User
  let general: ChatRoom
  let adminsRoom: ChatRoom
  let doctorsRoom: ChatRoom

  before(async () => {
    httpServer = createRealtimeHttpServer()
    io = attachRealtime(httpServer)
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
  })

  after(async () => {
    for (const s of sockets) s.disconnect()
    await new Promise<void>((resolve) => io.close(() => resolve()))
  })

  async function socketFor(user: User | null, auth: Record<string, unknown> = {}): Promise<Socket> {
    const token = user ? (await issueToken(user)).accessToken : undefined
    const socket = connect(url, { path: '/socket.io', transports: ['websocket'], auth: { token, ...auth }, reconnection: false, forceNew: true })
    sockets.push(socket)
    return socket
  }

  function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', (error) => reject(error))
    })
  }

  async function subscribe(user: User, channel: string): Promise<{ ok: boolean; status?: number; members?: unknown[] }> {
    const socket = await socketFor(user)
    await connected(socket)
    return socket.emitWithAck('subscribe', { channel })
  }

  const room = (slug: string) =>
    db().selectFrom('chat_rooms').selectAll().where('tenant_id', '=', clinic.id).where('slug', '=', slug).executeTakeFirstOrThrow()

  beforeEach(async () => {
    clinic = await createTenant('doctor')
    admin = await createUser(clinic, ['admin'], { name: 'Alice Admin' })
    moderator = await createUser(clinic, ['doctor'])
    member = await createUser(clinic, ['receptionist'])
    assertStatus(await api('GET', '/api/v1/chat/rooms', { as: member }), 200)
    general = await room('general')
    adminsRoom = await room('admins')
    doctorsRoom = await room('doctors')
  })

  it('lets chat members join their own workspace channel only', async () => {
    assert.equal((await subscribe(member, `private-chat.tenant.${clinic.id}`)).ok, true)

    const shop = await createTenant('marketplace')
    assert.equal((await subscribe(member, `private-chat.tenant.${shop.id}`)).ok, false)
    // No chat.view: refused
    assert.equal((await subscribe(await createUser(clinic), `private-chat.tenant.${clinic.id}`)).ok, false)
  })

  it('only lets a room’s audience receive its messages', async () => {
    assert.equal((await subscribe(member, `private-chat.feed.${general.id}`)).ok, true)
    assert.equal((await subscribe(member, `private-chat.feed.${doctorsRoom.id}`)).ok, false)
    assert.equal((await subscribe(moderator, `private-chat.feed.${doctorsRoom.id}`)).ok, true)
    assert.equal((await subscribe(moderator, `private-chat.feed.${adminsRoom.id}`)).ok, false)
    assert.equal((await subscribe(admin, `private-chat.feed.${adminsRoom.id}`)).ok, true)
  })

  it('shares the member card on room presence channels within the audience', async () => {
    const joined = await subscribe(admin, `presence-chat.room.${general.id}`)
    assert.equal(joined.ok, true)
    assert.deepEqual(joined.members, [{ id: admin.id, name: 'Alice Admin', is_admin: true }])

    assert.equal((await subscribe(member, `presence-chat.room.${adminsRoom.id}`)).ok, false)

    const shopRoom = await db()
      .insertInto('chat_rooms')
      .values({ tenant_id: (await createTenant('marketplace')).id, name: 'X', slug: 'x' })
      .returningAll()
      .executeTakeFirstOrThrow()
    assert.equal((await subscribe(admin, `presence-chat.room.${shopRoom.id}`)).ok, false)
  })

  it('announces joins and leaves and relays typing whispers to the room only', async () => {
    const channel = `presence-chat.room.${general.id}`
    const first = await socketFor(admin)
    await connected(first)
    await first.emitWithAck('subscribe', { channel })

    const received: ChannelEvent[] = []
    first.on(CHANNEL_EVENT, (event: ChannelEvent) => received.push(event))

    const second = await socketFor(member)
    await connected(second)
    const ack = await second.emitWithAck('subscribe', { channel })
    assert.equal(ack.members.length, 2)

    second.emit('client-event', { channel, event: 'client-typing', data: { id: member.id, name: member.name } })
    // Not a member of this channel's presence: ignored
    second.emit('client-event', { channel: `presence-chat.room.${doctorsRoom.id}`, event: 'client-typing', data: {} })
    await new Promise((resolve) => setTimeout(resolve, 150))
    second.disconnect()

    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.deepEqual(
      received.map((e) => e.event),
      ['presence.joining', 'client-typing', 'presence.leaving']
    )
    assert.equal((received[0].data as { id: number }).id, member.id)
  })

  it('refuses guests and revoked tokens', async () => {
    await assert.rejects(connected(await socketFor(null)), /unauthenticated/)

    const token = (await issueToken(member)).accessToken
    await db().updateTable('access_tokens').set({ revoked: true }).execute()
    const revoked = connect(url, { path: '/socket.io', transports: ['websocket'], auth: { token }, reconnection: false, forceNew: true })
    sockets.push(revoked)
    await assert.rejects(connected(revoked), /unauthenticated/)
  })

  it('refuses tokens used from another theme frontend', async () => {
    await assert.rejects(connected(await socketFor(member, { theme: 'marketplace' })), /forbidden/)
    await connected(await socketFor(member, { theme: 'doctor' }))
  })
})
