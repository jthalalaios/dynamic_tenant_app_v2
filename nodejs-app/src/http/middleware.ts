import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { hasAnyPermission } from '../authorization/acl.ts'
import { config } from '../config/index.ts'
import { isTenantType, type TenantType } from '../domain/enums.ts'
import { validSocketId } from '../realtime/broadcaster.ts'
import { authenticateToken } from '../services/auth/tokens.ts'
import { mustVerifyEmail, tenantOfUser } from '../services/auth/users.ts'
import { isOnline } from '../services/doctor/presence.ts'
import { isThemeEnabled, themeAllowed } from '../tenancy/themes.ts'
import { createContext, requireUser, t, type Ctx } from '../support/context.ts'
import { BusinessRuleError, HttpError } from '../support/errors.ts'
import { preferredLocale, supportedLocale } from '../support/i18n.ts'
import { attempt, type Limit } from '../support/rateLimiter.ts'
import { isValidTimezone } from '../support/time.ts'

/**
 * Request middleware (the port of app/Http/Middleware and bootstrap/app.php).
 *
 * Every authenticated feature route runs, in order:
 *   authenticate → resolveTenant → verified → userLocale → throttle('api') → permission(...)
 * and only then loads the records it acts on, always scoped to the resolved tenant.
 */
declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Locale (Accept-Language), timezone (X-Timezone), websocket id (X-Socket-ID) and the
 * standalone frontend's theme (X-App-Theme). Locale first, so a refused theme is
 * reported in the client's language. An unknown theme, or one this backend does not
 * serve (TENANCY_THEMES), is refused up front so a misconfigured frontend fails loudly.
 */
export async function clientPreferences(request: FastifyRequest): Promise<void> {
  const timezone = header(request, 'x-timezone')

  request.ctx = createContext({
    locale: preferredLocale(header(request, 'accept-language')),
    clientTimezone: isValidTimezone(timezone) ? timezone : null,
    socketId: validSocketId(header(request, 'x-socket-id'))
  })

  const theme = header(request, config.tenancy.themes.header)
  if (typeof theme === 'string' && theme !== '') {
    const requested = theme.trim().toLowerCase()
    if (!isThemeEnabled(requested)) throw new HttpError(404, t(request.ctx, 'messages.theme_unavailable'))
    request.ctx.theme = requested
  }
}

/** Bearer token → user. Pure token API: a 401, never a redirect */
export const authenticate: preHandlerAsyncHookHandler = async (request) => {
  const authorization = header(request, 'authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  const result = match ? await authenticateToken(match[1]) : null

  if (!result) throw new HttpError(401, t(request.ctx, 'messages.unauthenticated'))

  request.ctx.user = result.user
  request.ctx.tokenId = result.tokenId
}

/**
 * Binds the authenticated user's tenant to the request, provided it is active, its
 * theme is served by this backend and matches the calling frontend (X-App-Theme).
 */
export const resolveTenant: preHandlerAsyncHookHandler = async (request) => {
  const { ctx } = request
  const user = ctx.user
  if (!user) throw new HttpError(401, t(ctx, 'messages.unauthenticated'))

  const tenant = await tenantOfUser(user)

  if (!tenant || !tenant.is_active) throw new HttpError(403, t(ctx, 'messages.tenant_unavailable'))
  if (!user.is_active) throw new HttpError(403, t(ctx, 'messages.account_disabled'))
  // Theme disabled on this backend (TENANCY_THEMES) or a token used from another theme's frontend
  if (!themeAllowed(ctx, tenant.type)) throw new HttpError(403, t(ctx, 'messages.theme_mismatch'))

  ctx.tenant = tenant
}

/** Blocks unverified users from the app's features (code `email_unverified`); a no-op when AUTH_VERIFY_EMAIL is off */
export const verified: preHandlerAsyncHookHandler = async (request) => {
  const user = request.ctx.user
  if (user && mustVerifyEmail(user)) {
    throw new HttpError(403, t(request.ctx, 'messages.email_unverified'), 'email_unverified')
  }
}

/** Overrides the request locale with the user's saved preference */
export const userLocale: preHandlerAsyncHookHandler = async (request) => {
  const locale = request.ctx.user?.locale
  if (supportedLocale(locale)) request.ctx.locale = locale
}

/** `permission('a.view', 'a.update')` passes when the user holds any of them */
export function permission(...permissions: string[]): preHandlerAsyncHookHandler {
  return async (request) => {
    const user = request.ctx.user
    if (!user || !(await hasAnyPermission(user, permissions))) {
      throw new HttpError(403, t(request.ctx, 'messages.forbidden'))
    }
  }
}

/** Restricts a route group to tenants of a given type */
export function tenantType(type: TenantType): preHandlerAsyncHookHandler {
  return async (request) => {
    const current = request.ctx.tenant?.type
    if (!isTenantType(current) || current !== type) {
      throw new HttpError(403, t(request.ctx, 'messages.feature_unavailable'))
    }
  }
}

/** Rejects the request unless the user currently has a live presence session */
export const online: preHandlerAsyncHookHandler = async (request) => {
  if (!(await isOnline(requireUser(request.ctx)))) {
    throw new BusinessRuleError(t(request.ctx, 'messages.must_be_online'), 'user_offline')
  }
}

// ------------------------------------------------------------------ throttling

function bodyEmail(request: FastifyRequest): string {
  const body = request.body as Record<string, unknown> | undefined
  return typeof body?.email === 'string' ? body.email.toLowerCase() : ''
}

const LIMITERS: Record<string, (request: FastifyRequest) => Limit[]> = {
  auth: (request) => [
    { key: `auth-ip:${request.ip}`, maxAttempts: 10, decaySeconds: 60 },
    { key: `auth-email:${bodyEmail(request)}|${request.ip}`, maxAttempts: 5, decaySeconds: 60 }
  ],
  api: (request) => [{ key: `api:${request.ctx.user?.id ?? request.ip}`, maxAttempts: 120, decaySeconds: 60 }],
  // Chat messages per member; also caps how fast a client can flood a room
  chat: (request) => [{ key: `chat:${request.ctx.user?.id ?? request.ip}`, maxAttempts: 30, decaySeconds: 60 }],
  verification: (request) => [{ key: `verify:${request.ctx.user?.id ?? request.ip}`, maxAttempts: 3, decaySeconds: 60 }]
}

export function throttle(name: keyof typeof LIMITERS): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { exceeded, tightest } = await attempt(LIMITERS[name](request))

    if (exceeded) {
      throw new HttpError(429, t(request.ctx, 'messages.too_many_requests'), null, {
        'retry-after': String(exceeded.retryAfter),
        'x-ratelimit-limit': String(exceeded.limit.maxAttempts),
        'x-ratelimit-remaining': '0'
      })
    }

    if (tightest) {
      reply.header('x-ratelimit-limit', String(tightest.limit.maxAttempts))
      reply.header('x-ratelimit-remaining', String(Math.max(0, tightest.limit.maxAttempts - tightest.attempts)))
    }
  }
}

// ---------------------------------------------------------------------- groups

/** Session endpoints: reachable before the email is verified */
export const sessionGuards = [authenticate, resolveTenant, userLocale, throttle('api')]

/** App features: also require a verified email */
export const featureGuards = [authenticate, resolveTenant, verified, userLocale, throttle('api')]
