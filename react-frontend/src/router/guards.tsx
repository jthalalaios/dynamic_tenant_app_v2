import type { ReactNode } from 'react'
import { Navigate, useLocation, useMatches } from 'react-router'
import { homePathFor } from '../config/navigation'
import { useAccessStore, useIsAuthenticated, useUserStore } from '../stores'
import { selectMustVerifyEmail, selectTenantType } from '../stores/user'
import { mergedMeta } from './meta'

/** Only follow same-app relative redirects (no open redirect via ?redirect=https://evil) */
export function safeRedirect(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null
}

/**
 * Route guard (the port of the global beforeEach guard). Meta is merged parent →
 * child, so a child inherits `requiresAuth` / `tenant` from its group. The session
 * was restored before the router rendered (see main.tsx).
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const matches = useMatches()
  const location = useLocation()
  const signedIn = useIsAuthenticated()
  const mustVerifyEmail = useUserStore(selectMustVerifyEmail)
  const tenantType = useUserStore(selectTenantType)
  const can = useAccessStore((s) => s.can)
  const meta = mergedMeta(matches)

  const landing = mustVerifyEmail ? '/verify-email' : tenantType ? homePathFor(tenantType, can) : '/settings'

  // Signed-in users skip the marketing landing page and the guest-only screens
  if (signedIn && (meta.name === 'home' || meta.guestOnly)) {
    const requested = meta.guestOnly && !mustVerifyEmail ? safeRedirect(new URLSearchParams(location.search).get('redirect')) : null
    return <Navigate to={requested ?? landing} replace />
  }

  if (meta.requiresAuth && !signedIn) {
    const redirect = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/signin?${new URLSearchParams({ redirect })}`} replace />
  }

  // App features stay locked until the email is verified (the API enforces the same)
  if (signedIn && mustVerifyEmail && meta.requiresAuth && !meta.allowUnverified) {
    return <Navigate to="/verify-email" replace />
  }

  if (signedIn && meta.name === 'verify-email' && !mustVerifyEmail) {
    return <Navigate to={landing} replace />
  }

  if (meta.tenant && meta.tenant !== tenantType) {
    return <Navigate to="/forbidden" replace />
  }

  if (meta.permission !== undefined && !can(meta.permission)) {
    return <Navigate to="/forbidden" replace />
  }

  return <>{children}</>
}
