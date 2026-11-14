import { create } from 'zustand'
import type { AccessSnapshot } from '../types/models'

export type PermissionCheck = string | readonly string[]

interface AccessState {
  isAdmin: boolean
  roles: string[]
  permissions: string[]
  /** True if the user holds at least one of the permissions (or the single one given) */
  can: (check: PermissionCheck | undefined) => boolean
  canAll: (check: readonly string[]) => boolean
  hasRole: (role: string | readonly string[]) => boolean
  setAccess: (snapshot: AccessSnapshot) => void
  reset: () => void
}

/**
 * Checks bound to one permission set. They are rebuilt whenever access changes, so a
 * component selecting `can` re-renders when the user's permissions change.
 */
function checks(permissions: string[], roles: string[]) {
  const set = new Set(permissions)
  return {
    can: (check: PermissionCheck | undefined) => {
      if (check === undefined) return true
      const list = typeof check === 'string' ? [check] : check
      return list.length === 0 || list.some((p) => set.has(p))
    },
    canAll: (check: readonly string[]) => check.every((p) => set.has(p)),
    hasRole: (role: string | readonly string[]) => {
      const list = typeof role === 'string' ? [role] : role
      return list.some((r) => roles.includes(r))
    }
  }
}

/**
 * The current user's roles and effective permissions, as resolved by the API.
 * The API stays the authority; this store only drives what the UI shows.
 */
export const useAccessStore = create<AccessState>((set) => ({
  isAdmin: false,
  roles: [],
  permissions: [],
  ...checks([], []),

  setAccess: (snapshot) =>
    set({
      isAdmin: snapshot.is_admin,
      roles: [...snapshot.roles],
      permissions: [...snapshot.permissions],
      ...checks(snapshot.permissions, snapshot.roles)
    }),

  reset: () => set({ isAdmin: false, roles: [], permissions: [], ...checks([], []) })
}))
