import { randomBytes } from 'node:crypto'
import { config } from '../../config/index.ts'
import { db } from '../../db/database.ts'
import type { User } from '../../db/schema.ts'
import { checkPassword, hashPassword } from '../../support/hash.ts'

/**
 * Password reset tokens (Laravel's DatabaseTokenRepository + PasswordBroker):
 * one hashed token per email, valid for `expire` minutes, and a new one can
 * only be requested every `throttle` seconds.
 */
export type ResetStatus = 'passwords.sent' | 'passwords.throttled' | 'passwords.user' | 'passwords.token' | 'passwords.reset'

export async function createResetToken(user: User): Promise<{ status: ResetStatus; token: string | null }> {
  const existing = await db().selectFrom('password_reset_tokens').selectAll().where('email', '=', user.email).executeTakeFirst()
  const throttle = config.tenancy.auth.passwordResetThrottleSeconds * 1000

  if (existing && existing.created_at.getTime() + throttle > Date.now()) {
    return { status: 'passwords.throttled', token: null }
  }

  const token = randomBytes(32).toString('hex')
  await db()
    .insertInto('password_reset_tokens')
    .values({ email: user.email, token: await hashPassword(token), created_at: new Date() })
    .onConflict((oc) => oc.column('email').doUpdateSet((eb) => ({ token: eb.ref('excluded.token'), created_at: eb.ref('excluded.created_at') })))
    .execute()

  return { status: 'passwords.sent', token }
}

/** Valid, unexpired token for the email; consumed by `deleteResetToken` once the password is set */
export async function resetTokenIsValid(email: string, token: string): Promise<boolean> {
  const row = await db().selectFrom('password_reset_tokens').selectAll().where('email', '=', email).executeTakeFirst()
  if (!row) return false

  const expired = row.created_at.getTime() + config.tenancy.auth.passwordResetExpireMinutes * 60_000 < Date.now()
  return !expired && (await checkPassword(token, row.token))
}

export async function deleteResetToken(email: string): Promise<void> {
  await db().deleteFrom('password_reset_tokens').where('email', '=', email).execute()
}
