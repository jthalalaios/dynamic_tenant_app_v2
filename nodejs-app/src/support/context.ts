import { config } from '../config/index.ts'
import type { TenantType } from '../domain/enums.ts'
import type { Tenant, User } from '../db/schema.ts'
import { trans, type Replacements } from './i18n.ts'
import { isValidTimezone, parseInZone, toIso } from './time.ts'

/**
 * Everything a request (or a console command / seeder) acts as: the port of
 * Laravel's request-scoped TenantContext and ClientContext plus the global helpers.
 *
 * Passed explicitly to services instead of living in a container, so a tenant can
 * never leak from one request into another, and every query's scope is visible
 * at the call site.
 */
export interface Ctx {
  /** Locale of messages: Accept-Language, then the user's saved preference */
  locale: string
  /** X-Timezone header, when valid */
  clientTimezone: string | null
  /** X-App-Theme of a standalone frontend; null for the multi frontend */
  theme: TenantType | null
  /** The tenant the request acts on (set by the tenant middleware) */
  tenant: Tenant | null
  /** The authenticated user */
  user: User | null
  /** Id (jti) of the access token the request was authenticated with */
  tokenId: string | null
  /** Websocket id from X-Socket-ID: broadcasts skip the sender's own socket */
  socketId: string | null
  /** Per-request memo (e.g. the chat directory's admin ids) */
  memo: Map<string, unknown>
}

export function createContext(overrides: Partial<Ctx> = {}): Ctx {
  return {
    locale: config.tenancy.locales[0] ?? 'en',
    clientTimezone: null,
    theme: null,
    tenant: null,
    user: null,
    tokenId: null,
    socketId: null,
    memo: new Map(),
    ...overrides
  }
}

/** A context acting as the given tenant (console commands, seeders, jobs) */
export function tenantContext(tenant: Tenant, overrides: Partial<Ctx> = {}): Ctx {
  return createContext({ tenant, locale: tenant.locale, ...overrides })
}

export function requireTenant(ctx: Ctx): Tenant {
  if (!ctx.tenant) throw new Error('No tenant bound to this context.')
  return ctx.tenant
}

export function requireUser(ctx: Ctx): User {
  if (!ctx.user) throw new Error('No authenticated user in this context.')
  return ctx.user
}

export function t(ctx: Ctx, key: string, replace?: Replacements): string {
  return trans(ctx.locale, key, replace)
}

/**
 * Timezone to present dates in: user preference > request header > tenant default > app default.
 */
export function userTimezone(ctx: Ctx, user: User | null = ctx.user): string {
  for (const timezone of [user?.timezone, ctx.clientTimezone, ctx.tenant?.timezone]) {
    if (isValidTimezone(timezone)) return timezone
  }
  return config.app.timezone
}

/** A (UTC) instant as ISO-8601 in the viewer's timezone, offset included */
export function toUserTimezone(ctx: Ctx, date: Date | null | undefined, timezone?: string): string | null {
  return toIso(date, timezone ?? userTimezone(ctx))
}

/**
 * Parse a client supplied date. Values without an explicit offset are read as the
 * viewer's local wall time; the result is an absolute instant (stored as UTC).
 */
export function fromUserTimezone(ctx: Ctx, value: string, timezone?: string): Date | null {
  return parseInZone(value, timezone ?? userTimezone(ctx))
}
