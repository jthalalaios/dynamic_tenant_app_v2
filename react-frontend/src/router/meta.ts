import type { UIMatch } from 'react-router'
import type { PermissionCheck } from '../stores/access'
import type { TenantType } from '../types/models'

/** Route metadata (vue-router's RouteMeta), declared in each route's `handle.meta` */
export interface RouteMeta {
  /** Requires a signed-in user */
  requiresAuth?: boolean
  /** Reachable by signed-in users before they verify their email */
  allowUnverified?: boolean
  /** Only for guests (sign-in, register...) */
  guestOnly?: boolean
  /** Restricts the route to one tenant type */
  tenant?: TenantType
  /** Any of these permissions grants access */
  permission?: PermissionCheck
  /** i18n key for the document title */
  title?: string
}

export interface RouteHandle {
  /** Route name, like vue-router's `name` */
  name?: string
  meta?: RouteMeta
}

/** A match from useMatches() (`handle`) or from router.state.matches (`route.handle`) */
type AnyMatch = UIMatch | { route: { handle?: unknown } }

/** Meta merged parent → child, like vue-router: a child inherits `requiresAuth` / `tenant` from its group */
export function mergedMeta(matches: readonly AnyMatch[]): RouteMeta & { name?: string } {
  let meta: RouteMeta & { name?: string } = {}
  for (const match of matches) {
    const handle = ('route' in match ? match.route.handle : match.handle) as RouteHandle | undefined
    if (handle?.meta) meta = { ...meta, ...handle.meta }
    if (handle?.name) meta.name = handle.name
  }
  return meta
}
