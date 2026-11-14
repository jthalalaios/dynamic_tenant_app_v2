import { create } from 'zustand'
import { presenceApi } from '../api'
import type { Presence } from '../types/models'

const DEFAULT_TIMEOUT_MINUTES = 5

interface PresenceStore {
  state: Presence | null
  busy: boolean
  refresh: () => Promise<void>
  goOnline: () => Promise<void>
  goOffline: () => Promise<void>
  /** Local cleanup on sign-out (the server session expires on its own) */
  reset: () => void
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Online/offline state for clinic staff. While online, a heartbeat keeps the
 * server-side session alive; check-in is only allowed while it is live.
 */
export const usePresenceStore = create<PresenceStore>((set, get) => {
  // Beat at half the server timeout (at most once a minute) so one missed beat never drops the session
  const heartbeatMs = () => Math.min(60_000, ((get().state?.timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000) / 2)

  function stopHeartbeat(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  function startHeartbeat(): void {
    stopHeartbeat()
    timer = setInterval(async () => {
      try {
        apply(await presenceApi.heartbeat())
      } catch {
        // Transient network errors: keep trying; a 401 is handled globally
      }
    }, heartbeatMs())
  }

  function apply(next: Presence): void {
    const wasOnline = get().state?.online ?? false
    set({ state: next })
    if (!next.online) stopHeartbeat()
    else if (!wasOnline || !timer) startHeartbeat()
  }

  return {
    state: null,
    busy: false,

    refresh: async () => apply(await presenceApi.show()),

    goOnline: async () => {
      set({ busy: true })
      try {
        apply(await presenceApi.online())
      } finally {
        set({ busy: false })
      }
    },

    goOffline: async () => {
      set({ busy: true })
      try {
        apply(await presenceApi.offline())
      } finally {
        set({ busy: false })
      }
    },

    reset: () => {
      stopHeartbeat()
      set({ state: null })
    }
  }
})

export const selectOnline = (s: PresenceStore) => s.state?.online ?? false
export const selectSince = (s: PresenceStore) => s.state?.started_at ?? null
