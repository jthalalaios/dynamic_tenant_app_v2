import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mailThemes } from '../src/config/branding.ts'
import type { Tenant } from '../src/db/schema.ts'
import { brandFor } from '../src/mail/branding.ts'
import { buildMail, mailLocaleFor, resetUrl, sendVerificationEmail, verificationUrl } from '../src/mail/notifications.ts'
import { e, templateName } from '../src/mail/templates.ts'
import { createTenant, createUser, fresh, mail, useTestApp } from './helpers.ts'

const { db } = useTestApp()

/*
| Transactional emails follow the recipient's theme (tenant type) and language.
*/
describe('branded emails', () => {
  let clinic: Tenant
  let shop: Tenant

  beforeEach(async () => {
    clinic = await createTenant('doctor', { name: 'Angel Clinic', locale: 'en' })
    shop = await createTenant('marketplace', { name: 'Test Shop', locale: 'en' })
  })

  it('sends clinic accounts the clinic template, as the clinic', async () => {
    const user = await createUser(clinic)
    const message = buildMail(user, clinic, 'verify-email', verificationUrl(user, clinic), 'en')

    assert.equal(templateName(message.theme, 'verify-email'), 'doctor.verify-email')
    assert.equal(message.subject, 'Confirm your email to open Angel Clinic')
    assert.deepEqual(message.from, { name: 'Angel Clinic', address: 'hello@example.com' })
    for (const text of ['Welcome to Angel Clinic', 'Book and manage appointments', '#0f66f0', e(message.url)]) {
      assert.ok(message.html.includes(text), text)
    }
    assert.ok(!message.html.includes('Laravel'))
  })

  it('sends shop accounts the store template, as the shop', async () => {
    const user = await createUser(shop)
    const message = buildMail(user, shop, 'verify-email', verificationUrl(user, shop), 'en')

    assert.equal(templateName(message.theme, 'verify-email'), 'marketplace.verify-email')
    assert.equal(message.subject, 'Activate your Test Shop store account')
    assert.ok(message.text.includes('Activate my account:'))
    assert.equal(message.from.name, 'Test Shop')
    for (const text of ['Your store is almost ready', 'Add products and keep stock', '#ef4444']) assert.ok(message.html.includes(text), text)
    assert.ok(!message.html.includes('#0f66f0'))
  })

  it('brands the password reset email per theme too', async () => {
    const doctorUser = await createUser(clinic)
    const sellerUser = await createUser(shop)
    const doctor = buildMail(doctorUser, clinic, 'reset-password', resetUrl(doctorUser, clinic, 'token'), 'en')
    const seller = buildMail(sellerUser, shop, 'reset-password', resetUrl(sellerUser, shop, 'token'), 'en')

    assert.equal(templateName(doctor.theme, 'reset-password'), 'doctor.reset-password')
    assert.equal(doctor.subject, 'Reset your Angel Clinic password')
    assert.equal(templateName(seller.theme, 'reset-password'), 'marketplace.reset-password')
    assert.ok(seller.html.includes('Let’s get you back to your store'))
    assert.ok(seller.html.includes('expires in 1 hour'))
  })

  it('writes in the recipient language: their own, else their organisation’s', async () => {
    const greek = await createUser(clinic, [], { locale: 'el' })
    assert.equal(mailLocaleFor(greek, clinic, 'en'), 'el')

    const greekShop = await createTenant('marketplace', { name: 'Κατάστημα', locale: 'el' })
    const byTenant = await createUser(greekShop)
    assert.equal(mailLocaleFor(byTenant, greekShop, 'en'), 'el')

    // A real send runs in that locale
    await sendVerificationEmail({ ...greek, email_verified_at: null }, 'en')
    assert.equal((mail.sent[0] as any).locale, 'el')
    assert.equal(mail.sent[0].subject, 'Επιβεβαιώστε το email σας για το Angel Clinic')
  })

  it('falls back to the generic template and wording for themes without their own', async () => {
    const user = await createUser(clinic)
    const saved = mailThemes.doctor
    delete mailThemes.doctor
    try {
      const message = buildMail(user, clinic, 'verify-email', verificationUrl(user, clinic), 'en')
      assert.equal(brandFor(clinic).theme, 'default')
      assert.equal(templateName(message.theme, 'verify-email'), 'default.verify-email')
      assert.equal(message.subject, 'Confirm your email address')
      assert.ok(message.html.includes('Angel Clinic'))
    } finally {
      mailThemes.doctor = saved
    }
  })

  it('delivers html and plain text parts through the mailer', async () => {
    const user = await createUser(shop, [], { email_verified_at: null })
    await sendVerificationEmail(await fresh('users', user.id), 'en')

    const sent = mail.sent[0]
    assert.ok(sent)
    assert.equal(sent.subject, 'Activate your Test Shop store account')
    assert.ok(sent.html.includes('Your store is almost ready'))
    assert.ok(sent.text.includes('Activate my account:'))
    assert.ok(sent.text.includes('/verify-email/'))
    assert.ok(!sent.text.includes('<'))
  })

  it('escapes user-controlled values in the HTML', async () => {
    const user = await createUser(clinic, [], { name: '<script>alert(1)</script>' })
    const message = buildMail(user, clinic, 'verify-email', verificationUrl(user, clinic), 'en')
    assert.ok(!message.html.includes('<script>'))
    assert.ok(message.html.includes('&lt;script&gt;'))
    void db
  })
})
