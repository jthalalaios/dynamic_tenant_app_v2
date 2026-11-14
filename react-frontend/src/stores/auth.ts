import { create } from 'zustand'
import { authApi, type LoginPayload, type RegisterPayload } from '../api'
import { storage } from '../helpers/storage'
import type { Session, TokenResponse } from '../types/models'
import { useAccessStore } from './access'
import { usePreferencesStore } from './preferences'
import { usePresenceStore } from './presence'
import { useThemeStore } from './theme'
import { useUserStore } from './user'

const TOKEN_KEY = 'auth.token'
const EXPIRES_KEY = 'auth.expiresAt'

interface AuthState {
  token: string | null
  expiresAt: number
  ready: boolean
  login: (payload: LoginPayload) => Promise<Session>
  register: (payload: RegisterPayload) => Promise<Session>
  /** Re-fetch the session (after role or profile changes) */
  refreshSession: () => Promise<void>
  /** Restore a stored session once per page load; concurrent callers share the same promise */
  bootstrap: () => Promise<void>
  logout: () => Promise<void>
  applySession: (session: Session) => Promise<void>
  clearSession: () => void
}

let bootstrapping: Promise<void> | null = null

/**
 * Session lifecycle: bearer token storage, login/logout and bootstrapping the
 * user, access and preference stores from the API's session payload.
 */
export const useAuthStore = create<AuthState>((set, get) => {
  const isExpired = () => get().expiresAt > 0 && Date.now() >= get().expiresAt

  function storeToken(response: TokenResponse): void {
    const expiresAt = Date.now() + response.expires_in * 1000
    set({ token: response.access_token, expiresAt })
    storage.set(TOKEN_KEY, response.access_token)
    storage.set(EXPIRES_KEY, String(expiresAt))
  }

  return {
    token: storage.get(TOKEN_KEY),
    expiresAt: Number(storage.get(EXPIRES_KEY)) || 0,
    ready: false,

    applySession: async (session) => {
      useUserStore.getState().setProfile(session.user, session.tenant)
      useAccessStore.getState().setAccess(session.access)
      useThemeStore.getState().lockTo(session.tenant.type)
      await usePreferencesStore.getState().applyServer(session.preferences)
    },

    login: async (payload) => {
      const response = await authApi.login(payload)
      storeToken(response)
      await get().applySession(response.session)
      return response.session
    },

    register: async (payload) => {
      const response = await authApi.register(payload)
      storeToken(response)
      await get().applySession(response.session)
      return response.session
    },

    refreshSession: async () => {
      await get().applySession(await authApi.me())
    },

    bootstrap: () => {
      if (get().ready) return Promise.resolve()

      bootstrapping ??= (async () => {
        try {
          if (get().token && !isExpired()) await get().refreshSession()
          else if (get().token) get().clearSession()
        } catch {
          get().clearSession()
        } finally {
          set({ ready: true })
          bootstrapping = null
        }
      })()

      return bootstrapping
    },

    logout: async () => {
      try {
        if (get().token) await authApi.logout()
      } catch {
        // The token may already be invalid; local sign-out still proceeds
      } finally {
        get().clearSession()
      }
    },

    clearSession: () => {
      set({ token: null, expiresAt: 0 })
      storage.remove(TOKEN_KEY)
      storage.remove(EXPIRES_KEY)
      useUserStore.getState().reset()
      useAccessStore.getState().reset()
      usePresenceStore.getState().reset()
      useThemeStore.getState().unlock()
    }
  }
})

function signedIn(token: string | null, expiresAt: number, hasUser: boolean): boolean {
  return !!token && !(expiresAt > 0 && Date.now() >= expiresAt) && hasUser
}

/** Outside React: whether a valid session is active */
export function isAuthenticated(): boolean {
  const { token, expiresAt } = useAuthStore.getState()
  return signedIn(token, expiresAt, useUserStore.getState().user !== null)
}

/** In components: re-renders on sign-in / sign-out */
export function useIsAuthenticated(): boolean {
  const token = useAuthStore((s) => s.token)
  const expiresAt = useAuthStore((s) => s.expiresAt)
  const hasUser = useUserStore((s) => s.user !== null)
  return signedIn(token, expiresAt, hasUser)
}
