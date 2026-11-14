import { create } from 'zustand'
import { chatApi, type ChatMutePayload, type ChatRoomPayload } from '../api'
import { connectRealtime, disconnectRealtime, onRealtimeConnected, realtime, realtimeStatus } from '../services/realtime'
import type { ChatMember, ChatMessage, ChatMute, ChatRoleOption, ChatRoom } from '../types/models'
import { useAccessStore } from './access'
import { selectDisplayName, useUserStore } from './user'

/** How long a "typing" whisper stays visible without a new one */
const TYPING_TTL_MS = 4_000
/** Minimum gap between our own "typing" whispers */
const TYPING_THROTTLE_MS = 2_500
/** Resync interval while the websocket is down or not configured */
const POLL_MS = 10_000

type MuteEvent = { action: 'muted' | 'unmuted'; mute: ChatMute }
type DeletedEvent = { id: number; room_id: number; deleted_by: number }

/** Merge two id-sorted message lists, newest wins on duplicates */
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>()
  for (const m of current) byId.set(m.id, m)
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

interface ChatState {
  rooms: ChatRoom[]
  mutes: ChatMute[]
  /** Workspace roles to pick a room audience from (room managers only) */
  roles: ChatRoleOption[]
  /** Members who may enter each room (loaded when the room is opened) */
  membersByRoom: Record<number, ChatMember[]>
  messages: Record<number, ChatMessage[]>
  hasMore: Record<number, boolean>
  online: Record<number, ChatMember[]>
  /** roomId → userId → name of who is typing */
  typing: Record<number, Record<number, string>>
  activeRoomId: number | null
  started: boolean
  ready: boolean
  loadingHistory: boolean
  /** Ticks so mute countdowns and expiries update on screen */
  now: number

  start: () => Promise<void>
  stop: () => void
  refreshRooms: () => Promise<void>
  loadMembers: (roomId: number) => Promise<void>
  loadOlder: (roomId: number) => Promise<void>
  openRoom: (roomId: number) => Promise<void>
  closeRoom: () => void
  scheduleRead: (delay?: number) => void
  send: (body: string) => Promise<void>
  deleteMessage: (message: ChatMessage) => Promise<void>
  mute: (payload: ChatMutePayload) => Promise<ChatMute>
  unmute: (target: ChatMute) => Promise<void>
  createRoom: (payload: ChatRoomPayload) => Promise<ChatRoom>
  updateRoom: (id: number, payload: Partial<ChatRoomPayload>) => Promise<ChatRoom>
  deleteRoom: (room: ChatRoom) => Promise<void>
  notifyTyping: () => void
}

// ------------------------------------------------------- non-reactive internals

let tenantChannel: string | null = null
let presenceChannel: string | null = null
/** Room ids whose message feed we are subscribed to */
const feeds = new Set<number>()
let clock: ReturnType<typeof setInterval> | null = null
let poller: ReturnType<typeof setInterval> | null = null
let offConnected: (() => void) | null = null
let connectedOnce = false
let starting: Promise<void> | null = null
let lastTypingSent = 0
let readTimer: ReturnType<typeof setTimeout> | null = null
let roomsRefreshTimer: ReturnType<typeof setTimeout> | null = null
let lastReadSent: Record<number, number> = {}
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

const me = () => useUserStore.getState().user?.id ?? null

/**
 * Live chat state: the rooms the member may enter (with unread counts), message
 * history per room, active mutes, room presence and typing indicators.
 *
 * Realtime channels (authorised by the server):
 * - `private-chat.feed.{room}`: one per room we may enter, carrying its messages.
 *   Restricted rooms (admins / roles) are never subscribed by others.
 * - `private-chat.tenant.{id}`: workspace signals; a room change only says "rooms
 *   changed", and we re-fetch the list the API filters for us.
 * - `presence-chat.room.{room}`: who has the open room on screen, plus "typing".
 *
 * The API is the authority: moderation rules mirrored here only decide which
 * buttons to show.
 */
export const useChatStore = create<ChatState>((set, get) => {
  const activeRoom = () => get().rooms.find((r) => r.id === get().activeRoomId) ?? null

  const patchRoom = (roomId: number, patch: (room: ChatRoom) => Partial<ChatRoom>) =>
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, ...patch(r) } : r)) }))

  // ------------------------------------------------------------------ typing

  function stopTyping(roomId: number, userId: number): void {
    const key = `${roomId}:${userId}`
    const timer = typingTimers.get(key)
    if (timer) clearTimeout(timer)
    typingTimers.delete(key)
    if (!get().typing[roomId]?.[userId]) return
    set((s) => {
      const { [userId]: _gone, ...rest } = s.typing[roomId] ?? {}
      return { typing: { ...s.typing, [roomId]: rest } }
    })
  }

  function clearTyping(roomId: number): void {
    for (const [key, timer] of typingTimers) {
      if (key.startsWith(`${roomId}:`)) {
        clearTimeout(timer)
        typingTimers.delete(key)
      }
    }
    set((s) => {
      const { [roomId]: _gone, ...rest } = s.typing
      return { typing: rest }
    })
  }

  function startTyping(roomId: number, event: { id: number; name: string }): void {
    if (event.id === me()) return
    const key = `${roomId}:${event.id}`
    const existing = typingTimers.get(key)
    if (existing) clearTimeout(existing)
    typingTimers.set(key, setTimeout(() => stopTyping(roomId, event.id), TYPING_TTL_MS))
    set((s) => ({ typing: { ...s.typing, [roomId]: { ...(s.typing[roomId] ?? {}), [event.id]: event.name } } }))
  }

  // ---------------------------------------------------------------- messages

  function receive(message: ChatMessage): void {
    const list = get().messages[message.room_id]
    // Rooms never opened load their history on first open; no need to keep a partial list
    if (list) set((s) => ({ messages: { ...s.messages, [message.room_id]: mergeMessages(list, [message]) } }))

    const room = get().rooms.find((r) => r.id === message.room_id)
    if (room) {
      const own = message.user?.id === me()
      const isNewest = !room.last_message || room.last_message.id <= message.id
      const visibleHere = room.id === get().activeRoomId && document.visibilityState === 'visible'

      patchRoom(room.id, (r) => ({
        ...(isNewest ? { last_message: message } : {}),
        ...(!own && !visibleHere ? { unread_count: (r.unread_count ?? 0) + 1 } : {})
      }))
      if (!own && visibleHere) get().scheduleRead()
    }
    if (message.user) stopTyping(message.room_id, message.user.id)
  }

  function removeMessage(roomId: number, id: number): void {
    const list = get().messages[roomId]
    if (list) set((s) => ({ messages: { ...s.messages, [roomId]: list.filter((m) => m.id !== id) } }))

    const room = get().rooms.find((r) => r.id === roomId)
    if (room?.last_message?.id === id) {
      const remaining = get().messages[roomId]
      patchRoom(roomId, () => ({ last_message: remaining?.length ? remaining[remaining.length - 1] : null }))
    }
    refreshRoomsSoon()
  }

  function applyMuteChange({ action, mute: changed }: MuteEvent): void {
    // Re-muting replaces the previous terms server side (same user + scope)
    const rest = get().mutes.filter((m) => m.id !== changed.id && !(m.user?.id === changed.user?.id && m.room_id === changed.room_id))
    set({ mutes: action === 'muted' ? [...rest, changed] : rest })
  }

  /** Newest page; replaces the list when it no longer overlaps (we missed more than a page) */
  async function loadLatest(roomId: number): Promise<void> {
    const response = await chatApi.messages(roomId)
    const current = get().messages[roomId]
    const overlaps = current?.length && response.data.length && response.data[0].id <= current[current.length - 1].id

    if (!current || !overlaps) {
      set((s) => ({ messages: { ...s.messages, [roomId]: response.data }, hasMore: { ...s.hasMore, [roomId]: response.meta.has_more } }))
    } else {
      set((s) => ({ messages: { ...s.messages, [roomId]: mergeMessages(current, response.data) } }))
    }
  }

  // --------------------------------------------------------------- lifecycle

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') get().scheduleRead()
  }

  /** Catch up after a reconnect or while polling */
  async function resync(): Promise<void> {
    try {
      await get().refreshRooms()
      const active = get().activeRoomId
      if (active !== null) await loadLatest(active)
    } catch {
      // Offline: the next tick or reconnect tries again
    }
  }

  /** Debounced: several signals in a row cost one request */
  function refreshRoomsSoon(): void {
    if (roomsRefreshTimer) clearTimeout(roomsRefreshTimer)
    roomsRefreshTimer = setTimeout(() => void get().refreshRooms().catch(() => {}), 400)
  }

  function reset(): void {
    for (const timer of typingTimers.values()) clearTimeout(timer)
    typingTimers.clear()
    lastReadSent = {}
    set({ rooms: [], mutes: [], roles: [], activeRoomId: null, ready: false, membersByRoom: {}, messages: {}, hasMore: {}, online: {}, typing: {} })
  }

  // -------------------------------------------------------------- live events

  function subscribeTenant(): void {
    const echo = connectRealtime()
    const tenantId = useUserStore.getState().tenant?.id
    if (!echo || !tenantId) return

    tenantChannel = `chat.tenant.${tenantId}`
    echo
      .private(tenantChannel)
      .listen('.room.changed', () => refreshRoomsSoon())
      .listen('.mute.changed', (event: MuteEvent) => applyMuteChange(event))
  }

  /** Subscribe to the feed of every room we may enter, and leave the others */
  function syncFeeds(): void {
    const echo = realtime()
    if (!echo) return
    const wanted = new Set(get().rooms.map((r) => r.id))

    for (const id of [...feeds]) {
      if (!wanted.has(id)) {
        echo.leaveChannel(`private-chat.feed.${id}`)
        feeds.delete(id)
      }
    }
    for (const id of wanted) {
      if (feeds.has(id)) continue
      echo
        .private(`chat.feed.${id}`)
        .listen('.message.sent', (message: ChatMessage) => receive(message))
        .listen('.message.deleted', (event: DeletedEvent) => removeMessage(event.room_id, event.id))
      feeds.add(id)
    }
  }

  function joinPresence(roomId: number): void {
    const echo = realtime()
    if (!echo) return
    presenceChannel = `chat.room.${roomId}`
    set((s) => ({ online: { ...s.online, [roomId]: [] } }))

    echo
      .join(presenceChannel)
      .here((list: ChatMember[]) => set((s) => ({ online: { ...s.online, [roomId]: list } })))
      .joining((member: ChatMember) => {
        if (!get().online[roomId]?.some((m) => m.id === member.id)) {
          set((s) => ({ online: { ...s.online, [roomId]: [...(s.online[roomId] ?? []), member] } }))
        }
      })
      .leaving((member: ChatMember) => {
        set((s) => ({ online: { ...s.online, [roomId]: (s.online[roomId] ?? []).filter((m) => m.id !== member.id) } }))
        stopTyping(roomId, member.id)
      })
      .listenForWhisper('typing', (event: { id: number; name: string }) => startTyping(roomId, event))
  }

  function leavePresence(): void {
    // Only the presence channel: the room's message feed stays subscribed for unread counts
    if (presenceChannel) realtime()?.leaveChannel(`presence-${presenceChannel}`)
    const active = get().activeRoomId
    if (active !== null) {
      set((s) => {
        const { [active]: _gone, ...rest } = s.online
        return { online: rest }
      })
      clearTyping(active)
    }
    presenceChannel = null
  }

  async function run(): Promise<void> {
    clock = setInterval(() => set({ now: Date.now() }), 15_000)
    document.addEventListener('visibilitychange', onVisibilityChange)

    try {
      await get().refreshRooms()
    } catch (err) {
      // Roll back so the next start() (e.g. the chat page retrying) begins clean
      get().stop()
      throw err
    }
    if (!get().started) return
    set({ ready: true })

    subscribeTenant()
    syncFeeds()
    offConnected = onRealtimeConnected(() => {
      // The first connect follows the initial load; later ones are reconnects that may have missed events
      if (connectedOnce) void resync()
      connectedOnce = true
    })
    poller = setInterval(() => {
      if (realtimeStatus() !== 'connected') void resync()
    }, POLL_MS)
  }

  return {
    rooms: [],
    mutes: [],
    roles: [],
    membersByRoom: {},
    messages: {},
    hasMore: {},
    online: {},
    typing: {},
    activeRoomId: null,
    started: false,
    ready: false,
    loadingHistory: false,
    now: Date.now(),

    /** Idempotent; concurrent callers share one boot and all see its outcome */
    start: () => {
      if (get().started) return starting ?? Promise.resolve()
      set({ started: true })
      const boot = run()
      starting = boot
      boot.then(
        () => (starting = null),
        () => (starting = null)
      )
      return boot
    },

    stop: () => {
      if (!get().started) return
      set({ started: false })
      if (clock) clearInterval(clock)
      if (poller) clearInterval(poller)
      if (readTimer) clearTimeout(readTimer)
      if (roomsRefreshTimer) clearTimeout(roomsRefreshTimer)
      clock = poller = readTimer = roomsRefreshTimer = null
      offConnected?.()
      offConnected = null
      connectedOnce = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      disconnectRealtime()
      tenantChannel = presenceChannel = null
      feeds.clear()
      reset()
    },

    /** The rooms we may enter (the API filters by audience), then follow exactly their feeds */
    refreshRooms: async () => {
      const response = await chatApi.rooms()
      const visible = new Set(response.data.map((r) => r.id))

      set((s) => ({
        rooms: response.data,
        mutes: response.meta.mutes,
        roles: response.meta.roles ?? [],
        // A room taken away from us (deleted, audience narrowed): forget it
        messages: Object.fromEntries(Object.entries(s.messages).filter(([id]) => visible.has(Number(id))))
      }))

      const active = get().activeRoomId
      if (active !== null && !visible.has(active)) get().closeRoom()
      if (get().started) syncFeeds()
    },

    loadMembers: async (roomId) => {
      try {
        const members = await chatApi.members(roomId)
        set((s) => ({ membersByRoom: { ...s.membersByRoom, [roomId]: members } }))
      } catch {
        set((s) => ({ membersByRoom: { ...s.membersByRoom, [roomId]: [] } }))
      }
    },

    loadOlder: async (roomId) => {
      const current = get().messages[roomId]
      if (get().loadingHistory || !current?.length || !get().hasMore[roomId]) return
      set({ loadingHistory: true })
      try {
        const response = await chatApi.messages(roomId, current[0].id)
        set((s) => ({
          messages: { ...s.messages, [roomId]: mergeMessages(s.messages[roomId] ?? [], response.data) },
          hasMore: { ...s.hasMore, [roomId]: response.meta.has_more }
        }))
      } finally {
        set({ loadingHistory: false })
      }
    },

    openRoom: async (roomId) => {
      if (get().activeRoomId === roomId && get().messages[roomId]) return
      leavePresence()
      set({ activeRoomId: roomId })
      joinPresence(roomId)
      void get().loadMembers(roomId)

      if (!get().messages[roomId]) {
        set({ loadingHistory: true })
        try {
          await loadLatest(roomId)
        } finally {
          set({ loadingHistory: false })
        }
      }
      get().scheduleRead(0)
    },

    closeRoom: () => {
      leavePresence()
      set({ activeRoomId: null })
    },

    /** Mark the open room read up to its newest message (only when the tab is visible) */
    scheduleRead: (delay = 400) => {
      if (readTimer) clearTimeout(readTimer)
      readTimer = setTimeout(() => {
        const room = activeRoom()
        const list = room ? get().messages[room.id] : undefined
        if (!room || !list?.length || document.visibilityState !== 'visible') return

        const lastId = list[list.length - 1].id
        if (room.unread_count) patchRoom(room.id, () => ({ unread_count: 0 }))
        if ((lastReadSent[room.id] ?? 0) >= lastId) return
        lastReadSent[room.id] = lastId
        void chatApi.markRead(room.id, lastId).catch(() => delete lastReadSent[room.id])
      }, delay)
    },

    send: async (body) => {
      const room = activeRoom()
      if (!room) return
      const message = await chatApi.send(room.id, body)
      lastTypingSent = 0
      receive(message)
    },

    deleteMessage: async (message) => {
      await chatApi.deleteMessage(message.id)
      removeMessage(message.room_id, message.id)
    },

    mute: async (payload) => {
      const created = await chatApi.mute(payload)
      applyMuteChange({ action: 'muted', mute: created })
      return created
    },

    unmute: async (target) => {
      await chatApi.unmute(target.id)
      applyMuteChange({ action: 'unmuted', mute: target })
    },

    /** Room changes re-fetch the list: the API decides which rooms we may see */
    createRoom: async (payload) => {
      const room = await chatApi.createRoom(payload)
      await get().refreshRooms()
      return room
    },

    updateRoom: async (id, payload) => {
      const room = await chatApi.updateRoom(id, payload)
      await get().refreshRooms()
      // The audience may have changed who belongs here
      if (get().membersByRoom[id]) void get().loadMembers(id)
      return room
    },

    deleteRoom: async (room) => {
      await chatApi.deleteRoom(room.id)
      await get().refreshRooms()
    },

    /** Tell the room we are typing (throttled; whispers never touch the API) */
    notifyTyping: () => {
      const echo = realtime()
      const id = me()
      if (!echo || !presenceChannel || id === null) return
      if (Date.now() - lastTypingSent < TYPING_THROTTLE_MS) return
      lastTypingSent = Date.now()
      echo.join(presenceChannel).whisper('typing', { id, name: selectDisplayName(useUserStore.getState()) })
    }
  }
})

// ---------------------------------------------------------------- selectors

export const selectActiveRoom = (s: ChatState) => s.rooms.find((r) => r.id === s.activeRoomId) ?? null
export const selectDefaultRoom = (s: ChatState) => s.rooms.find((r) => r.is_default) ?? s.rooms[0] ?? null
export const selectTotalUnread = (s: ChatState) => s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0)

function isLive(mute: ChatMute, now: number): boolean {
  return mute.expires_at === null || Date.parse(mute.expires_at) > now
}

/** Mute checks, bound to the current state (use inside components with the selected values) */
export function muteOf(mutes: ChatMute[], now: number, userId: number, roomId: number | null): ChatMute | null {
  // The mute silencing a member in a room: permanent beats timed, then the one ending last
  const covering = mutes.filter((m) => isLive(m, now) && m.user?.id === userId && (m.room_id === null || m.room_id === roomId))
  if (!covering.length) return null
  return covering.reduce((best, m) => {
    if (best.expires_at === null) return best
    if (m.expires_at === null) return m
    return Date.parse(m.expires_at) > Date.parse(best.expires_at) ? m : best
  })
}

export function liveMutes(mutes: ChatMute[], now: number): ChatMute[] {
  return mutes.filter((m) => isLive(m, now))
}

export function typingNames(typing: ChatState['typing'], roomId: number): string[] {
  return Object.values(typing[roomId] ?? {})
}

/**
 * Moderation helpers mirrored from the API: admins moderate everyone; chat.mute
 * holders everyone but admins; never yourself.
 */
export function useChatModeration() {
  const isAdmin = useAccessStore((s) => s.isAdmin)
  const can = useAccessStore((s) => s.can)
  const myId = useUserStore((s) => s.user?.id ?? null)
  const mutes = useChatStore((s) => s.mutes)
  const now = useChatStore((s) => s.now)

  const canModerate = (target: ChatMember | null | undefined): boolean => {
    if (!target || target.id === myId) return false
    if (isAdmin) return true
    return can('chat.mute') && !target.is_admin
  }

  const canDelete = (message: ChatMessage): boolean => {
    if (message.user && message.user.id === myId) return true
    if (!message.user) return isAdmin || can('chat.mute')
    return canModerate(message.user)
  }

  const myMute = (roomId: number | null): ChatMute | null => (myId === null ? null : muteOf(mutes, now, myId, roomId))

  const canPost = (room: ChatRoom | null): boolean => {
    if (!room) return false
    if (room.is_locked && !isAdmin) return false
    return myMute(room.id) === null
  }

  return { canModerate, canDelete, canPost, myMute, muteOf: (userId: number, roomId: number | null) => muteOf(mutes, now, userId, roomId) }
}
