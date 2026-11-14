import { db } from '../../db/database.ts'
import type { Tenant, User } from '../../db/schema.ts'
import { fail } from '../../http/validation.ts'
import { themeAllowed } from '../../tenancy/themes.ts'
import { t, type Ctx } from '../../support/context.ts'
import { checkPassword, hashPassword, needsRehash } from '../../support/hash.ts'
import { issueToken, revokeToken, type IssuedToken } from './tokens.ts'
import { findUserByEmail, tenantOfUser } from './users.ts'

export interface LoginResult {
  user: User
  tenant: Tenant
  token: IssuedToken
}

/**
 * Verify credentials and issue a personal access token (a signed JWT).
 * Failures are 422 validation errors on `email`, like Laravel's.
 */
export async function login(ctx: Ctx, email: string, password: string): Promise<LoginResult> {
  // Emails are globally unique; never let a tenant context hide an account
  const user = await findUserByEmail(email)
  const tenant = user ? await tenantOfUser(user) : undefined

  // Same error for unknown email, wrong password and accounts of another theme
  // (e.g. a clinic login on the market frontend), so accounts cannot be enumerated
  const valid = user !== undefined && (await checkPassword(password, user.password))

  if (!user || !valid || !themeAllowed(ctx, tenant?.type)) {
    fail('email', t(ctx, 'auth.failed'))
  }

  if (!user.is_active) {
    fail('email', t(ctx, 'messages.account_disabled'))
  }

  if (!tenant || !tenant.is_active) {
    fail('email', t(ctx, 'messages.tenant_unavailable'))
  }

  const now = new Date()
  const changes: { last_login_at: Date; updated_at: Date; password?: string } = { last_login_at: now, updated_at: now }
  if (needsRehash(user.password)) changes.password = await hashPassword(password)

  const updated = await db().updateTable('users').set(changes).where('id', '=', user.id).returningAll().executeTakeFirstOrThrow()

  return { user: updated, tenant, token: await issueToken(updated) }
}

export async function logout(ctx: Ctx): Promise<void> {
  if (ctx.tokenId) await revokeToken(ctx.tokenId)
}
