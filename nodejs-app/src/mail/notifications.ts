import { config } from '../config/index.ts'
import { db } from '../db/database.ts'
import type { Tenant, User } from '../db/schema.ts'
import { frontendUrl } from '../tenancy/themes.ts'
import { sha1 } from '../support/hash.ts'
import { humanizeMinutes, supportedLocale } from '../support/i18n.ts'
import { signPath } from '../support/signedUrl.ts'
import { MailCopy, brandFor } from './branding.ts'
import { mailer, type MailMessage } from './mailer.ts'
import { renderHtml, renderText, type MailView } from './templates.ts'

/**
 * The branded call-to-action emails: email verification and password reset.
 *
 * Written in the recipient's language (their own, else their organisation's, else
 * the language of the request that triggered it) and sent "as" the organisation.
 */
export type MailTemplate = 'verify-email' | 'reset-password'

export function mailLocaleFor(user: User, tenant: Tenant | null, fallback: string): string {
  for (const locale of [user.locale, tenant?.locale]) {
    if (supportedLocale(locale)) return locale
  }
  return supportedLocale(fallback) ? fallback : config.app.locale
}

async function tenantOf(user: User): Promise<Tenant | null> {
  if (user.tenant_id === null) return null
  return (await db().selectFrom('tenants').selectAll().where('id', '=', user.tenant_id).executeTakeFirst()) ?? null
}

export function verificationPath(user: User): string {
  return `/api/v1/auth/email/verify/${user.id}/${sha1(user.email)}`
}

/**
 * Signs the API route (relative, so it survives proxies / differing hosts), then hands
 * its parameters to the frontend page of the account's theme, which posts them back.
 */
export function verificationUrl(user: User, tenant: Tenant | null): string {
  const { expires, signature } = signPath(verificationPath(user), config.tenancy.auth.verificationTtlMinutes)
  const hash = sha1(user.email)
  return `${frontendUrl(tenant?.type)}/verify-email/${user.id}/${hash}?${new URLSearchParams({ expires, signature })}`
}

/** The reset link opens the frontend of the account's own theme */
export function resetUrl(user: User, tenant: Tenant | null, token: string): string {
  return `${frontendUrl(tenant?.type)}/reset-password?${new URLSearchParams({ token, email: user.email })}`
}

export interface BuiltMail extends MailMessage {
  /** Rendered template, e.g. "doctor.verify-email" (tests, previews) */
  theme: string
  url: string
  locale: string
}

export function buildMail(user: User, tenant: Tenant | null, template: MailTemplate, url: string, locale: string): BuiltMail {
  const brand = brandFor(tenant)
  const copy = new MailCopy(template, brand.theme, locale, { organization: brand.organization, name: user.name })
  const expiresMinutes = template === 'verify-email' ? config.tenancy.auth.verificationTtlMinutes : config.tenancy.auth.passwordResetExpireMinutes
  const view: MailView = { brand, copy, url, locale, expiresIn: humanizeMinutes(locale, expiresMinutes) }

  return {
    to: user.email,
    // Sent "as" the organisation, from the configured (authenticated) mailbox
    from: { name: brand.organization, address: config.mail.fromAddress },
    subject: copy.get('subject'),
    html: renderHtml(template, view),
    text: renderText(view),
    theme: brand.theme,
    url,
    locale
  }
}

/** Throws MailTransportError when the mail server is unavailable */
export async function sendVerificationEmail(user: User, fallbackLocale: string): Promise<void> {
  const tenant = await tenantOf(user)
  const locale = mailLocaleFor(user, tenant, fallbackLocale)
  await mailer().send(buildMail(user, tenant, 'verify-email', verificationUrl(user, tenant), locale))
}

export async function sendPasswordResetEmail(user: User, token: string, fallbackLocale: string): Promise<void> {
  const tenant = await tenantOf(user)
  const locale = mailLocaleFor(user, tenant, fallbackLocale)
  await mailer().send(buildMail(user, tenant, 'reset-password', resetUrl(user, tenant, token), locale))
}
