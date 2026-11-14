/**
 * Realtime channel names, shared by the API (publisher) and the websocket server.
 *
 * - `private-chat.feed.{room}`:  a room's messages; only members who may enter the
 *   room can join, so restricted rooms (admins, roles) never leak.
 * - `private-chat.tenant.{id}`:  workspace-wide signals (rooms changed, mutes).
 * - `presence-chat.room.{room}`: who has the room open, plus "typing" whispers.
 */
export function tenantChannel(tenantId: number): string {
  return `private-chat.tenant.${tenantId}`
}

export function roomChannel(roomId: number): string {
  return `private-chat.feed.${roomId}`
}

export function presenceChannel(roomId: number): string {
  return `presence-chat.room.${roomId}`
}

export type ParsedChannel =
  | { kind: 'tenant'; id: number }
  | { kind: 'feed'; id: number }
  | { kind: 'presence'; id: number }

export function parseChannel(name: unknown): ParsedChannel | null {
  if (typeof name !== 'string') return null
  const match = /^(private-chat\.tenant|private-chat\.feed|presence-chat\.room)\.(\d{1,18})$/.exec(name)
  if (!match) return null
  const id = Number(match[2])
  if (!Number.isSafeInteger(id)) return null
  const kind = match[1] === 'private-chat.tenant' ? 'tenant' : match[1] === 'private-chat.feed' ? 'feed' : 'presence'
  return { kind, id }
}

/** What a socket receives for every channel event */
export interface ChannelEvent {
  channel: string
  event: string
  data: unknown
}

/** The single Socket.IO event name carrying channel events */
export const CHANNEL_EVENT = 'channel:event'
