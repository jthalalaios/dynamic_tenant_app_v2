import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../src/config/index.ts'
import type { Tenant } from '../src/db/schema.ts'
import { SmtpMailer, setMailer } from '../src/mail/mailer.ts'
import { sendVerificationEmail } from '../src/mail/notifications.ts'
import { sha1 } from '../src/support/hash.ts'
import { trans } from '../src/support/i18n.ts'
import { signPath } from '../src/support/signedUrl.ts'
import { api, assertStatus, createTenant, createUser, fresh, mail, useTestApp } from './helpers.ts'

const { db } = useTestApp()

/** Turn the emailed frontend link into the API call the frontend makes */
function verificationApiUrl(frontendLink: string): string {
  const url = new URL(frontendLink)
  return `/api/v1/auth/email/verify/${url.pathname.slice('/verify-email/'.length)}${url.search}`
}

describe('email verification', () => {
  let tenant: Tenant

  beforeEach(async () => {
    tenant = await createTenant('doctor')
  })

  it('emails a verification link pointing at the account theme frontend on sign up', async () => {
    config.tenancy.themes.frontendUrls.marketplace = 'https://market.example.test'

    const response = await api('POST', '/api/v1/auth/register', {
      body: { type: 'marketplace', name: 'Owner', email: 'owner@shop.test', password: 'Str0ng-Passw0rd!' }
    })
    assertStatus(response, 201)
    assert.equal(response.body.session.user.must_verify_email, true)
    assert.equal(response.body.session.user.email_verified_at, null)

    const user = await db().selectFrom('users').selectAll().where('email', '=', 'owner@shop.test').executeTakeFirstOrThrow()
    assert.equal(mail.sent.length, 1)
    assert.equal(mail.sent[0].to, user.email)
    assert.ok((mail.sent[0] as any).url.startsWith(`https://market.example.test/verify-email/${user.id}/`))
  })

  it('lets unverified users reach their session but not the app features', async () => {
    const user = await createUser(tenant, ['doctor'], { email_verified_at: null })

    const me = await api('GET', '/api/v1/auth/me', { as: user })
    assertStatus(me, 200)
    assert.equal(me.body.data.user.must_verify_email, true)

    const patients = await api('GET', '/api/v1/doctor/patients', { as: user })
    assertStatus(patients, 403)
    assert.equal(patients.body.code, 'email_unverified')
  })

  it('verifies the email from the signed link, without a session', async () => {
    const user = await createUser(tenant, ['doctor'], { email_verified_at: null })
    await sendVerificationEmail(user, 'en')
    const link = (mail.sent[0] as any).url as string

    const verified = await api('POST', verificationApiUrl(link))
    assertStatus(verified, 200)
    assert.equal(verified.body.verified, true)
    assert.notEqual((await fresh('users', user.id)).email_verified_at, null)

    assertStatus(await api('GET', '/api/v1/doctor/patients', { as: await fresh('users', user.id) }), 200)

    // Re-opening the link is harmless
    const again = await api('POST', verificationApiUrl(link))
    assertStatus(again, 200)
    assert.equal(again.body.message, trans('en', 'messages.email_already_verified'))
  })

  it('rejects tampered or expired links', async () => {
    const user = await createUser(tenant, [], { email_verified_at: null })
    const hash = sha1(user.email)

    const forged = await api('POST', `/api/v1/auth/email/verify/${user.id}/${hash}?expires=9999999999&signature=forged`)
    assertStatus(forged, 403)
    assert.equal(forged.body.code, 'invalid_signature')

    const path = `/api/v1/auth/email/verify/${user.id}/${hash}`
    const { signature } = signPath(path, 60)
    // A real signature, but over different parameters (an earlier expiry)
    const expired = await api('POST', `${path}?expires=1&signature=${signature}`)
    assertStatus(expired, 403)
    assert.equal(expired.body.code, 'invalid_signature')

    assert.equal((await fresh('users', user.id)).email_verified_at, null)
  })

  it('rejects a validly signed link for a different email hash', async () => {
    const user = await createUser(tenant, [], { email_verified_at: null })
    const path = `/api/v1/auth/email/verify/${user.id}/${sha1('other@example.com')}`
    const { expires, signature } = signPath(path, 60)

    assertStatus(await api('POST', `${path}?${new URLSearchParams({ expires, signature })}`), 403)
    assert.equal((await fresh('users', user.id)).email_verified_at, null)
  })

  it('resends the link to signed-in unverified users only', async () => {
    const unverified = await createUser(tenant, [], { email_verified_at: null })
    const verified = await createUser(tenant)

    const first = await api('POST', '/api/v1/auth/email/resend', { as: unverified })
    assertStatus(first, 200)
    assert.equal(first.body.verified, false)
    assert.equal(mail.sent.length, 1)
    assert.equal(mail.sent[0].to, unverified.email)

    const second = await api('POST', '/api/v1/auth/email/resend', { as: verified })
    assertStatus(second, 200)
    assert.equal(second.body.verified, true)
    assert.equal(mail.sent.length, 1)
  })

  it('reports a mail outage on resend instead of crashing', async () => {
    // Nothing listens on port 1: the SMTP transport fails like a down or misconfigured server
    Object.assign(config.mail, { mailer: 'smtp', host: '127.0.0.1', port: 1, username: '', password: '' })
    setMailer(new SmtpMailer())
    const user = await createUser(tenant, [], { email_verified_at: null })

    const response = await api('POST', '/api/v1/auth/email/resend', { as: user })
    assertStatus(response, 503)
    assert.equal(response.body.code, 'mail_unavailable')
    assert.equal(response.body.message, trans('en', 'messages.verification_mail_failed'))
  })

  it('can be switched off entirely', async () => {
    config.tenancy.auth.verifyEmail = false
    const user = await createUser(tenant, ['doctor'], { email_verified_at: null })

    assertStatus(await api('GET', '/api/v1/doctor/patients', { as: user }), 200)
    assert.equal((await api('POST', '/api/v1/auth/email/resend', { as: user })).body.verified, true)
    assert.equal(mail.sent.length, 0)
  })

  it('throttles resends', async () => {
    const user = await createUser(tenant, [], { email_verified_at: null })
    for (let i = 0; i < 3; i++) assertStatus(await api('POST', '/api/v1/auth/email/resend', { as: user }), 200)
    assertStatus(await api('POST', '/api/v1/auth/email/resend', { as: user }), 429)
  })
})
