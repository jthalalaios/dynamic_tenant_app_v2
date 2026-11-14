import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'
import { Server, type Socket } from 'socket.io'
import { hasPermission } from '../authorization/acl.ts'
import { config } from '../config/index.ts'
import { isTenantType } from '../domain/enums.ts'
import { authenticateToken } from '../services/auth/tokens.ts'
import { findUser, mustVerifyEmail, tenantOfUser } from '../services/auth/users.ts'
import { card, type MemberCard } from '../services/chat/directory.ts'
import { accessibleRoom } from '../services/chat/rooms.ts'
import { isThemeEnabled, themeAllowed } from '../tenancy/themes.ts'
import { createContext, type Ctx } from '../support/context.ts'
import { redisOptions } from '../support/redis.ts'
import { CHANNEL_EVENT, parseChannel, type ChannelEvent } from './channels.ts'

/**
 * Websocket server for the live chat (the role Laravel Reverb plays), on Socket.IO.
 *
 * Protocol (client → server, with acknowledgements):
 * - handshake `auth: { token, theme? }`: the API's bearer token; same tenant, theme and
 *   email-verification checks as the HTTP API
 * - `subscribe { channel }` → `{ ok, members? }`: authorised per channel (routes/channels.php):
 *     private-chat.tenant.{id}   own workspace + chat.view
 *     private-chat.feed.{room}   chat.view + the room is in the user's audience
 *     presence-chat.room.{room}  same, and the member's card joins the room's presence list
 * - `unsubscribe { channel }`
 * - `client-event { channel, event, data }`: whispers (typing) to the other members of a
 *   presence channel the socket has joined
 *
 * Server → client: `channel:event { channel, event, data }`, for API broadcasts
 * (published through Redis) and presence changes (`presence.joining` / `presence.leaving`).
 */
interface SocketData {
  userId: number
  tenantId: number
  theme: string | null
  /** Presence channels joined, with the card shown to the other members */
  presence: Record<string, MemberCard>
}

type ChatSocket = Socket<Record<string, any>, Record<string, any>, Record<string, never>, SocketData>

function originHost(origin: string | undefined): string | null {
  if (!origin) return null
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** REALTIME_ALLOWED_ORIGINS: hostnames ("localhost,app.example.com"); * = any */
export function originAllowed(origin: string | undefined): boolean {
  const allowed = config.realtime.allowedOrigins.map((o) => o.toLowerCase())
  if (allowed.length === 0 || allowed.includes('*')) return true
  const host = originHost(origin)
  return host !== null && allowed.includes(host)
}

/** The socket's user, reloaded so deactivation or a lost permission applies to the next subscription */
async function contextFor(socket: ChatSocket): Promise<Ctx | null> {
  const user = await findUser(socket.data.userId)
  if (!user || !user.is_active || mustVerifyEmail(user)) return null

  const tenant = await tenantOfUser(user)
  if (!tenant || !tenant.is_active || tenant.id !== socket.data.tenantId) return null

  const ctx = createContext({ user, tenant, theme: isTenantType(socket.data.theme) ? socket.data.theme : null, locale: tenant.locale })
  if (!themeAllowed(ctx, tenant.type)) return null

  return ctx
}

/**
 * Authorise one channel for the socket's user; resolves with the presence card for
 * presence channels, `true` for private ones, `false` when refused.
 */
export async function authorizeChannel(ctx: Ctx, channel: string): Promise<MemberCard | boolean> {
  const parsed = parseChannel(channel)
  const user = ctx.user
  if (!parsed || !user || !ctx.tenant) return false
  if (!(await hasPermission(user, 'chat.view'))) return false

  if (parsed.kind === 'tenant') return parsed.id === ctx.tenant.id

  // Another workspace's room, or one outside the user's audience, is refused
  const room = await accessibleRoom(ctx, user, parsed.id)
  if (!room) return false

  return parsed.kind === 'presence' ? ((await card(ctx, user)) ?? false) : true
}

async function presenceMembers(io: Server, channel: string): Promise<MemberCard[]> {
  const sockets = await io.in(channel).fetchSockets()
  const members = new Map<number, MemberCard>()
  for (const s of sockets) {
    const member = (s.data as SocketData).presence?.[channel]
    if (member && !members.has(member.id)) members.set(member.id, member)
  }
  return [...members.values()]
}

/** True while the user still has another socket in the channel (another tab) */
async function userStillPresent(io: Server, channel: string, userId: number, exceptSocketId: string): Promise<boolean> {
  const sockets = await io.in(channel).fetchSockets()
  return sockets.some((s) => s.id !== exceptSocketId && (s.data as SocketData).userId === userId)
}

function channelEvent(channel: string, event: string, data: unknown): ChannelEvent {
  return { channel, event, data }
}

export function attachRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: (origin, callback) => callback(null, originAllowed(origin)), credentials: false },
    allowRequest: (request: IncomingMessage, callback) => callback(null, originAllowed(request.headers.origin)),
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 10_000
  })

  // API publishes go through Redis; with several realtime replicas, so do presence lookups
  if (config.broadcast === 'redis') {
    const pub = new Redis(redisOptions())
    const sub = pub.duplicate()
    io.adapter(createAdapter(pub, sub))
  }

  io.use(async (socket: ChatSocket, next) => {
    try {
      const { token, theme } = (socket.handshake.auth ?? {}) as { token?: unknown; theme?: unknown }
      const requested = typeof theme === 'string' && theme !== '' ? theme.trim().toLowerCase() : null
      if (requested !== null && !isThemeEnabled(requested)) return next(new Error('theme_unavailable'))

      const result = typeof token === 'string' ? await authenticateToken(token) : null
      if (!result || result.user.tenant_id === null) return next(new Error('unauthenticated'))

      socket.data = { userId: result.user.id, tenantId: result.user.tenant_id, theme: requested, presence: {} }
      if (!(await contextFor(socket))) return next(new Error('forbidden'))

      next()
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)))
    }
  })

  io.on('connection', (socket: ChatSocket) => {
    socket.on('subscribe', async (payload: { channel?: unknown } | undefined, ack?: (reply: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      try {
        const channel = typeof payload?.channel === 'string' ? payload.channel : ''
        const ctx = await contextFor(socket)
        const granted = ctx ? await authorizeChannel(ctx, channel) : false
        if (!granted) return reply({ ok: false, status: 403 })

        if (granted === true) {
          await socket.join(channel)
          return reply({ ok: true })
        }

        const alreadyPresent = await userStillPresent(io, channel, socket.data.userId, socket.id)
        socket.data.presence = { ...socket.data.presence, [channel]: granted }
        await socket.join(channel)
        if (!alreadyPresent) socket.to(channel).emit(CHANNEL_EVENT, channelEvent(channel, 'presence.joining', granted))

        reply({ ok: true, members: await presenceMembers(io, channel) })
      } catch (error) {
        console.error('[realtime] subscribe failed', error)
        reply({ ok: false, status: 500 })
      }
    })

    socket.on('unsubscribe', async (payload: { channel?: unknown } | undefined) => {
      const channel = typeof payload?.channel === 'string' ? payload.channel : ''
      if (!socket.rooms.has(channel)) return
      await socket.leave(channel)
      await announceLeave(channel)
    })

    socket.on('client-event', (payload: { channel?: unknown; event?: unknown; data?: unknown } | undefined) => {
      const channel = typeof payload?.channel === 'string' ? payload.channel : ''
      const event = typeof payload?.event === 'string' ? payload.event : ''
      // Client events only between members of a presence channel the socket has joined
      if (!config.realtime.acceptClientEvents || !event.startsWith('client-') || !socket.data.presence[channel] || !socket.rooms.has(channel)) return
      socket.to(channel).emit(CHANNEL_EVENT, channelEvent(channel, event, payload?.data ?? null))
    })

    socket.on('disconnecting', () => {
      for (const channel of Object.keys(socket.data.presence)) void announceLeave(channel)
    })

    async function announceLeave(channel: string): Promise<void> {
      const member = socket.data.presence[channel]
      if (!member) return
      const { [channel]: _left, ...rest } = socket.data.presence
      socket.data.presence = rest
      try {
        if (!(await userStillPresent(io, channel, socket.data.userId, socket.id))) {
          io.to(channel).except(socket.id).emit(CHANNEL_EVENT, channelEvent(channel, 'presence.leaving', member))
        }
      } catch (error) {
        console.error('[realtime] presence update failed', error)
      }
    }
  })

  return io
}

export function createRealtimeHttpServer(): HttpServer {
  return createServer((request, response) => {
    if (request.url === '/up') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}')
      return
    }
    // Socket.IO handles its own path; everything else does not exist here
    if (!request.url?.startsWith('/socket.io')) response.writeHead(404).end()
  })
}
