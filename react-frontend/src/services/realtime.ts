import { io, type Socket } from 'socket.io-client'
import { create } from 'zustand'

/**
 * Websocket connection (Socket.IO) shared by the whole app, with Laravel Echo's API:
 *
 *   realtime()?.private('chat.tenant.1').listen('.room.changed', cb)
 *   realtime()?.join('chat.room.3').here(cb).joining(cb).leaving(cb).listenForWhisper('typing', cb)
 *   realtime()?.join('chat.room.3').whisper('typing', data)
 *   realtime()?.leaveChannel('private-chat.feed.3')
 *
 * - The handshake carries the API's bearer token and the standalone theme, so the
 *   server applies the same checks as the HTTP API; every channel is authorised by
 *   the server when subscribing.
 * - Channels are re-subscribed after every reconnect.
 * - Without VITE_REALTIME_URL the app runs without live updates (`unavailable`).
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable'

/** Server → client channel events (see nodejs-app/src/realtime/channels.ts) */
const CHANNEL_EVENT = 'channel:event'

interface ChannelEvent {
  channel: string
  event: string
  data: unknown
}

type Callback = (data: any) => void

/** Reactive connection state, for "Live" / "Reconnecting…" indicators */
export const useRealtimeStatus = create<{ status: RealtimeStatus }>(() => ({ status: 'idle' }))

function setStatus(status: RealtimeStatus): void {
  useRealtimeStatus.setState({ status })
}

export function realtimeStatus(): RealtimeStatus {
  return useRealtimeStatus.getState().status
}

export interface RealtimeHooks {
  getToken: () => string | null
  getTheme: () => string | null
}

let hooks: RealtimeHooks = { getToken: () => null, getTheme: () => null }

export function configureRealtime(next: Partial<RealtimeHooks>): void {
  hooks = { ...hooks, ...next }
}

class Channel {
  readonly name: string
  protected readonly client: RealtimeClient
  private readonly listeners = new Map<string, Set<Callback>>()

  constructor(name: string, client: RealtimeClient) {
    this.name = name
    this.client = client
  }

  /** Echo's leading dot (".message.sent") means "the raw event name" */
  listen(event: string, callback: Callback): this {
    const key = event.replace(/^\./, '')
    const set = this.listeners.get(key) ?? new Set()
    set.add(callback)
    this.listeners.set(key, set)
    return this
  }

  dispatch(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach((callback) => callback(data))
  }

  /** Called with the server's acknowledgement after every (re)subscription */
  subscribed(_members: unknown[] | undefined): void {}
}

class PresenceChannel extends Channel {
  private hereCallbacks: Callback[] = []
  private joiningCallbacks: Callback[] = []
  private leavingCallbacks: Callback[] = []

  here(callback: Callback): this {
    this.hereCallbacks.push(callback)
    return this
  }

  joining(callback: Callback): this {
    this.joiningCallbacks.push(callback)
    return this
  }

  leaving(callback: Callback): this {
    this.leavingCallbacks.push(callback)
    return this
  }

  listenForWhisper(name: string, callback: Callback): this {
    return this.listen(`client-${name}`, callback)
  }

  whisper(name: string, data: unknown): this {
    this.client.emitClientEvent(this.name, `client-${name}`, data)
    return this
  }

  override subscribed(members: unknown[] | undefined): void {
    this.hereCallbacks.forEach((callback) => callback(members ?? []))
  }

  override dispatch(event: string, data: unknown): void {
    if (event === 'presence.joining') this.joiningCallbacks.forEach((callback) => callback(data))
    else if (event === 'presence.leaving') this.leavingCallbacks.forEach((callback) => callback(data))
    else super.dispatch(event, data)
  }
}

class RealtimeClient {
  private readonly socket: Socket
  private readonly channels = new Map<string, Channel>()
  private readonly connectedListeners = new Set<() => void>()
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(url: string) {
    this.socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      // A function, so every (re)connect sends the current token
      auth: (callback) => callback({ token: hooks.getToken(), theme: hooks.getTheme() })
    })

    this.socket.on('connect', () => {
      setStatus('connected')
      for (const channel of this.channels.values()) this.subscribe(channel)
      this.connectedListeners.forEach((callback) => callback())
    })

    this.socket.on('disconnect', () => setStatus('reconnecting'))
    this.socket.io.on('reconnect_attempt', () => setStatus('reconnecting'))

    this.socket.on('connect_error', () => {
      setStatus('reconnecting')
      // Refused by the server (e.g. an expired token): socket.io does not retry those itself
      if (!this.socket.active && !this.retry) {
        this.retry = setTimeout(() => {
          this.retry = null
          this.socket.connect()
        }, 5_000)
      }
    })

    this.socket.on(CHANNEL_EVENT, ({ channel, event, data }: ChannelEvent) => this.channels.get(channel)?.dispatch(event, data))
  }

  private subscribe(channel: Channel): void {
    if (!this.socket.connected) return
    this.socket.emit('subscribe', { channel: channel.name }, (reply: { ok: boolean; members?: unknown[] } | undefined) => {
      if (reply?.ok && this.channels.get(channel.name) === channel) channel.subscribed(reply.members)
    })
  }

  private channel<T extends Channel>(name: string, make: () => T): T {
    const existing = this.channels.get(name)
    if (existing) return existing as T
    const created = make()
    this.channels.set(name, created)
    this.subscribe(created)
    return created
  }

  private(name: string): Channel {
    return this.channel(`private-${name}`, () => new Channel(`private-${name}`, this))
  }

  join(name: string): PresenceChannel {
    return this.channel(`presence-${name}`, () => new PresenceChannel(`presence-${name}`, this))
  }

  leaveChannel(fullName: string): void {
    if (!this.channels.delete(fullName)) return
    if (this.socket.connected) this.socket.emit('unsubscribe', { channel: fullName })
  }

  emitClientEvent(channel: string, event: string, data: unknown): void {
    if (this.socket.connected) this.socket.emit('client-event', { channel, event, data })
  }

  onConnected(callback: () => void): () => void {
    this.connectedListeners.add(callback)
    return () => this.connectedListeners.delete(callback)
  }

  socketId(): string | null {
    return this.socket.connected ? (this.socket.id ?? null) : null
  }

  disconnect(): void {
    if (this.retry) clearTimeout(this.retry)
    this.channels.clear()
    this.connectedListeners.clear()
    this.socket.removeAllListeners()
    this.socket.disconnect()
  }
}

const url = (import.meta.env.VITE_REALTIME_URL ?? '').replace(/\/+$/, '')
let client: RealtimeClient | null = null
const pendingConnected = new Set<() => void>()

export function isRealtimeConfigured(): boolean {
  return url !== ''
}

/** Called every time the socket (re)connects, so callers can resync what they missed */
export function onRealtimeConnected(callback: () => void): () => void {
  if (client) return client.onConnected(callback)
  pendingConnected.add(callback)
  return () => pendingConnected.delete(callback)
}

export function connectRealtime(): RealtimeClient | null {
  if (client) return client
  if (!isRealtimeConfigured()) {
    setStatus('unavailable')
    return null
  }

  setStatus('connecting')
  client = new RealtimeClient(url)
  for (const callback of pendingConnected) client.onConnected(callback)
  pendingConnected.clear()
  return client
}

export function realtime(): RealtimeClient | null {
  return client
}

/** Websocket connection id, sent as X-Socket-ID so the API skips echoing our own events back */
export function realtimeSocketId(): string | null {
  return client?.socketId() ?? null
}

/** Close the socket (sign-out, lost permission); the next connectRealtime() starts fresh */
export function disconnectRealtime(): void {
  if (!client) return
  client.disconnect()
  client = null
  setStatus('idle')
}
