import { create } from 'zustand'
import { initials } from '../helpers/text'
import type { SessionUser, Tenant, TenantType } from '../types/models'

interface UserState {
  user: SessionUser | null
  tenant: Tenant | null
  setProfile: (user: SessionUser, tenant: Tenant) => void
  reset: () => void
}

/**
 * The signed-in user's profile and their tenant (clinic or shop).
 */
export const useUserStore = create<UserState>((set) => ({
  user: null,
  tenant: null,
  setProfile: (user, tenant) => set({ user, tenant }),
  reset: () => set({ user: null, tenant: null })
}))

// Derived values (Pinia getters), usable with useUserStore(selector) or on getState()
export const selectTenantType = (s: UserState): TenantType | null => s.tenant?.type ?? null
export const selectIsDoctorTenant = (s: UserState) => s.tenant?.type === 'doctor'
export const selectIsMarketplaceTenant = (s: UserState) => s.tenant?.type === 'marketplace'
export const selectDisplayName = (s: UserState) => s.user?.name ?? ''
export const selectUserInitials = (s: UserState) => initials(s.user?.name ?? '')
export const selectMustVerifyEmail = (s: UserState) => s.user?.must_verify_email === true
