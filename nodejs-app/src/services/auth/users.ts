import { config } from '../../config/index.ts'
import { db, type Executor } from '../../db/database.ts'
import type { Tenant, User } from '../../db/schema.ts'
import { sendVerificationEmail } from '../../mail/notifications.ts'

/**
 * Account helpers shared by the auth, admin and realtime layers.
 */

/** Whether this user still has to confirm their email before using the app */
export function mustVerifyEmail(user: User): boolean {
  return config.tenancy.auth.verifyEmail && user.email_verified_at === null
}

/**
 * Sends the verification link only while verification is enabled (AUTH_VERIFY_EMAIL).
 * Throws MailTransportError when the mail server is unavailable.
 */
export async function sendEmailVerificationNotification(user: User, fallbackLocale: string): Promise<void> {
  if (mustVerifyEmail(user)) await sendVerificationEmail(user, fallbackLocale)
}

/** Emails are globally unique; never scoped to a tenant */
export async function findUserByEmail(email: string, executor: Executor = db()): Promise<User | undefined> {
  return executor.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
}

export async function findUser(id: number, executor: Executor = db()): Promise<User | undefined> {
  return executor.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
}

export async function tenantOfUser(user: User, executor: Executor = db()): Promise<Tenant | undefined> {
  if (user.tenant_id === null) return undefined
  return executor.selectFrom('tenants').selectAll().where('id', '=', user.tenant_id).where('deleted_at', 'is', null).executeTakeFirst()
}
