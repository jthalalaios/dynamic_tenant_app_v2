import type { FastifyInstance, FastifyRequest } from 'fastify'
import { config } from '../../config/index.ts'
import { db } from '../../db/database.ts'
import { MailTransportError } from '../../mail/mailer.ts'
import { sendPasswordResetEmail } from '../../mail/notifications.ts'
import { login, logout, type LoginResult } from '../../services/auth/authService.ts'
import { registerMember } from '../../services/auth/memberRegistrar.ts'
import { createResetToken, deleteResetToken, resetTokenIsValid } from '../../services/auth/passwordBroker.ts'
import { revokeAllTokens } from '../../services/auth/tokens.ts'
import { findUser, findUserByEmail, mustVerifyEmail, sendEmailVerificationNotification, tenantOfUser } from '../../services/auth/users.ts'
import { enabledThemes, allowedThemes, themeAllowed } from '../../tenancy/themes.ts'
import { workspaceSlugFor } from '../../tenancy/workspaces.ts'
import { requireTenant, requireUser, t } from '../../support/context.ts'
import { HttpError } from '../../support/errors.ts'
import { hashPassword, safeEqual, sha1 } from '../../support/hash.ts'
import { verifySignedPath } from '../../support/signedUrl.ts'
import { body, created, noContent } from '../helpers.ts'
import { sessionGuards, throttle } from '../middleware.ts'
import { sessionResource } from '../resources.ts'
import {
  confirmed,
  currentPassword,
  email,
  fail,
  isEmptyValue,
  max,
  min,
  nullable,
  oneOf,
  required,
  requiredWith,
  sometimes,
  string,
  timezone,
  unique,
  validate
} from '../validation.ts'

/** Password::defaults(): at least 8 characters */
const passwordRules = [string, min(8)]

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Public bootstrap info for frontends: which themes this backend serves and
   * which auth features are on. A multi frontend uses it to only offer the
   * enabled themes; a standalone one to confirm its theme is served.
   */
  app.get('/app', async (request) => {
    const workspaces: Record<string, string> = {}

    for (const type of enabledThemes()) {
      // The workspace each theme's sign-ups join, by display name ("You will join Acme Clinic")
      const tenant = await db()
        .selectFrom('tenants')
        .select('name')
        .where('slug', '=', workspaceSlugFor(type))
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
      workspaces[type] = tenant?.name ?? config.tenancy.workspaces[type].name
    }

    return {
      themes: enabledThemes(),
      workspaces,
      theme: request.ctx.theme,
      locales: config.tenancy.locales,
      features: {
        registration: true,
        email_verification: config.tenancy.auth.verifyEmail
      }
    }
  })

  const authThrottle = { preHandler: [throttle('auth')] }

  app.post('/auth/login', authThrottle, async (request) => {
    const data = await validate(request.ctx, body(request), {
      email: [required, string, email, max(255)],
      password: [required, string, max(255)]
    })

    return tokenResponse(request, await login(request.ctx, data.email, data.password))
  })

  app.post('/auth/register', authThrottle, async (request, reply) => {
    const input = { ...body(request) }

    // `type` picks the workspace to join; a standalone frontend (X-App-Theme) need not send it
    if (request.ctx.theme !== null && isEmptyValue(input.type)) input.type = request.ctx.theme

    const data = await validate(request.ctx, input, {
      // Only themes this backend serves, and only the frontend's own theme when it is standalone
      type: [required, string, oneOf(allowedThemes(request.ctx))],
      name: [required, string, max(120)],
      email: [required, string, email, max(255), unique('users', 'email')],
      password: [required, ...passwordRules],
      timezone: [nullable, timezone],
      locale: [nullable, oneOf(config.tenancy.locales)]
    })

    await registerMember(request.ctx, {
      type: data.type,
      name: data.name,
      email: data.email,
      password: data.password,
      timezone: data.timezone,
      locale: data.locale
    })

    return created(reply, await tokenResponse(request, await login(request.ctx, data.email, data.password)))
  })

  app.post('/auth/forgot-password', authThrottle, async (request) => {
    const data = await validate(request.ctx, body(request), { email: [required, string, email, max(255)] })
    const user = await findUserByEmail(data.email)
    const tenant = user ? await tenantOfUser(user) : undefined

    // Only accounts of a theme this frontend serves get a link (a market frontend never mails clinic staff)
    if (user && themeAllowed(request.ctx, tenant?.type)) {
      const { status, token } = await createResetToken(user)
      if (status === 'passwords.sent' && token) {
        try {
          await sendPasswordResetEmail(user, token, request.ctx.locale)
        } catch (error) {
          request.log.error({ err: error }, 'Password reset email failed')
        }
      }
    }

    // Identical response whether or not the email exists (no account enumeration)
    return { message: t(request.ctx, 'messages.reset_link_sent') }
  })

  app.post('/auth/reset-password', authThrottle, async (request) => {
    const data = await validate(request.ctx, body(request), {
      token: [required, string],
      email: [required, string, email, max(255)],
      password: [required, ...passwordRules, confirmed]
    })

    const user = await findUserByEmail(data.email)
    if (!user) fail('email', t(request.ctx, 'passwords.user'))
    if (!(await resetTokenIsValid(user.email, data.token))) fail('email', t(request.ctx, 'passwords.token'))

    const password = await hashPassword(data.password)
    const now = new Date()

    await db()
      .transaction()
      .execute(async (trx) => {
        // Following the emailed link also proves ownership of the address
        await trx
          .updateTable('users')
          .set({ password, email_verified_at: user.email_verified_at ?? now, updated_at: now })
          .where('id', '=', user.id)
          .execute()
        // Sign out every device after a password reset
        await revokeAllTokens(user.id, trx)
      })
    await deleteResetToken(user.email)

    return { message: t(request.ctx, 'passwords.reset') }
  })

  /**
   * Confirm an email from the emailed link. The frontend forwards the link's
   * id/hash/expires/signature here; the signature (over path + query) is the proof,
   * so no session is needed and the link also works on another device.
   */
  app.post<{ Params: { id: string; hash: string } }>('/auth/email/verify/:id/:hash', authThrottle, async (request) => {
    const [path, search = ''] = request.url.split('?')
    if (verifySignedPath(path, new URLSearchParams(search)) !== 'valid') {
      throw new HttpError(403, t(request.ctx, 'messages.verification_link_invalid'), 'invalid_signature')
    }

    const { id, hash } = request.params
    const user = /^\d{1,18}$/.test(id) ? await findUser(Number(id)) : undefined

    if (!user || !safeEqual(sha1(user.email), hash)) {
      throw new HttpError(403, t(request.ctx, 'messages.verification_link_invalid'))
    }

    if (user.email_verified_at !== null) {
      return { message: t(request.ctx, 'messages.email_already_verified'), verified: true }
    }

    await db().updateTable('users').set({ email_verified_at: new Date(), updated_at: new Date() }).where('id', '=', user.id).execute()

    return { message: t(request.ctx, 'messages.email_verified'), verified: true }
  })

  // --------------------------------------------------------- session endpoints
  // Reachable before the email is verified

  app.get('/auth/me', { preHandler: sessionGuards }, async (request) => ({
    data: await sessionResource(request.ctx, requireUser(request.ctx), requireTenant(request.ctx))
  }))

  app.post('/auth/logout', { preHandler: sessionGuards }, async (request, reply) => {
    await logout(request.ctx)
    return noContent(reply)
  })

  app.patch('/auth/profile', { preHandler: sessionGuards }, async (request) => {
    const ctx = request.ctx
    const user = requireUser(ctx)

    const data = await validate(ctx, body(request), {
      name: [sometimes, required, string, max(120)],
      timezone: [sometimes, nullable, timezone],
      locale: [sometimes, nullable, oneOf(config.tenancy.locales)],
      current_password: [requiredWith('password'), currentPassword],
      password: [sometimes, required, ...passwordRules, confirmed]
    })

    const changes: { name?: string; timezone?: string | null; locale?: string | null; password?: string } = {}
    if (data.name !== undefined) changes.name = data.name
    if (data.timezone !== undefined) changes.timezone = data.timezone
    if (data.locale !== undefined) changes.locale = data.locale
    if (data.password !== undefined) changes.password = await hashPassword(data.password)

    const updated = Object.keys(changes).length
      ? await db().updateTable('users').set({ ...changes, updated_at: new Date() }).where('id', '=', user.id).returningAll().executeTakeFirstOrThrow()
      : user

    if (changes.locale !== undefined && changes.locale !== null && changes.locale !== user.locale) ctx.locale = changes.locale
    ctx.user = updated

    return { data: await sessionResource(ctx, updated, requireTenant(ctx)) }
  })

  /** Send a fresh verification link to the signed-in user */
  app.post('/auth/email/resend', { preHandler: [...sessionGuards, throttle('verification')] }, async (request, reply) => {
    const ctx = request.ctx
    const user = requireUser(ctx)

    if (!mustVerifyEmail(user)) {
      return { message: t(ctx, 'messages.email_already_verified'), verified: true }
    }

    try {
      await sendEmailVerificationNotification(user, ctx.locale)
    } catch (error) {
      if (!(error instanceof MailTransportError)) throw error
      // SMTP down or rejecting our credentials: say so, without leaking server details
      request.log.error({ err: error }, 'Verification email failed')
      return reply.code(503).send({ message: t(ctx, 'messages.verification_mail_failed'), code: 'mail_unavailable' })
    }

    return { message: t(ctx, 'messages.verification_link_sent'), verified: false }
  })
}

async function tokenResponse(request: FastifyRequest, result: LoginResult) {
  // Login runs outside the tenant middleware; bind it so the session payload resolves tenant defaults
  request.ctx.tenant = result.tenant
  request.ctx.user = result.user

  return {
    token_type: 'Bearer',
    access_token: result.token.accessToken,
    expires_in: result.token.expiresIn,
    session: await sessionResource(request.ctx, result.user, result.tenant)
  }
}
