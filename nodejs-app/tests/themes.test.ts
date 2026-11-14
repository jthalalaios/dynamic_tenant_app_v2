import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../src/config/index.ts'
import type { Tenant, User } from '../src/db/schema.ts'
import { trans } from '../src/support/i18n.ts'
import { api, assertStatus, assertValidationErrors, createTenant, createUser, mail, useTestApp } from './helpers.ts'

const { db } = useTestApp()

const themed = (theme: string) => ({ 'x-app-theme': theme })

describe('themes and standalone frontends', () => {
  let clinic: Tenant
  let shop: Tenant
  let doctor: User
  let seller: User

  beforeEach(async () => {
    clinic = await createTenant('doctor')
    shop = await createTenant('marketplace')
    doctor = await createUser(clinic, ['doctor'])
    seller = await createUser(shop, ['manager'])
  })

  it('lets a multi frontend (no theme header) sign in to every theme', async () => {
    assertStatus(await api('POST', '/api/v1/auth/login', { body: { email: doctor.email, password: 'password' } }), 200)
    assertStatus(await api('POST', '/api/v1/auth/login', { body: { email: seller.email, password: 'password' } }), 200)
  })

  it('scopes login to the standalone frontend theme without revealing the account', async () => {
    const ok = await api('POST', '/api/v1/auth/login', { body: { email: doctor.email, password: 'password' }, headers: themed('doctor') })
    assertStatus(ok, 200)
    assert.equal(ok.body.session.tenant.type, 'doctor')

    // A clinic account on the market frontend gets the same error as wrong credentials
    assertValidationErrors(
      await api('POST', '/api/v1/auth/login', { body: { email: doctor.email, password: 'password' }, headers: themed('marketplace') }),
      { email: trans('en', 'auth.failed') }
    )
  })

  it('refuses tokens used from another theme frontend', async () => {
    assertStatus(await api('GET', '/api/v1/auth/me', { as: doctor, headers: themed('doctor') }), 200)

    const response = await api('GET', '/api/v1/auth/me', { as: doctor, headers: themed('marketplace') })
    assertStatus(response, 403)
    assert.equal(response.body.message, trans('en', 'messages.theme_mismatch'))
  })

  it('rejects unknown theme headers', async () => {
    assertStatus(await api('GET', '/api/v1/app', { headers: themed('bakery') }), 404)
  })

  it('registers on a standalone frontend without sending a type, and only for its theme', async () => {
    const created = await api('POST', '/api/v1/auth/register', {
      body: { name: 'Owner', email: 'owner@solo.test', password: 'Str0ng-Passw0rd!' },
      headers: themed('doctor')
    })
    assertStatus(created, 201)
    assert.equal(created.body.session.tenant.type, 'doctor')

    assertValidationErrors(
      await api('POST', '/api/v1/auth/register', {
        body: { type: 'marketplace', name: 'Owner', email: 'owner@sneaky.test', password: 'Str0ng-Passw0rd!' },
        headers: themed('doctor')
      }),
      ['type']
    )
  })

  it('only mails reset links to accounts of the frontend theme, pointing at that theme frontend', async () => {
    config.tenancy.themes.frontendUrls.doctor = 'https://clinic.example.test'

    assertStatus(await api('POST', '/api/v1/auth/forgot-password', { body: { email: seller.email }, headers: themed('doctor') }), 200)
    assert.equal(mail.sent.length, 0)

    assertStatus(await api('POST', '/api/v1/auth/forgot-password', { body: { email: doctor.email }, headers: themed('doctor') }), 200)
    assert.equal(mail.sent.length, 1)
    assert.equal(mail.sent[0].to, doctor.email)
    assert.ok((mail.sent[0] as any).url.startsWith('https://clinic.example.test/reset-password?'))
  })

  it('answers forgot-password identically for unknown emails', async () => {
    const known = await api('POST', '/api/v1/auth/forgot-password', { body: { email: doctor.email } })
    const unknown = await api('POST', '/api/v1/auth/forgot-password', { body: { email: 'nobody@example.com' } })
    assertStatus(unknown, 200)
    assert.deepEqual(unknown.body, known.body)
  })

  describe('a backend serving a single theme (TENANCY_THEMES=doctor)', () => {
    beforeEach(() => {
      config.tenancy.themes.enabled = ['doctor']
    })

    it('advertises only that theme', async () => {
      const response = await api('GET', '/api/v1/app')
      assertStatus(response, 200)
      assert.deepEqual(response.body.themes, ['doctor'])
      assertStatus(await api('GET', '/api/v1/app', { headers: themed('marketplace') }), 404)
    })

    it('locks out accounts and tokens of the disabled theme', async () => {
      assertStatus(await api('POST', '/api/v1/auth/login', { body: { email: seller.email, password: 'password' } }), 422)
      assertStatus(await api('GET', '/api/v1/marketplace/products', { as: seller }), 403)
      assertStatus(await api('GET', '/api/v1/doctor/patients', { as: doctor }), 200)
    })

    it('only registers members of that theme', async () => {
      assertValidationErrors(
        await api('POST', '/api/v1/auth/register', { body: { type: 'marketplace', name: 'O', email: 'o@shop.test', password: 'Str0ng-Passw0rd!' } }),
        ['type']
      )
      assert.equal(await db().selectFrom('users').select('id').where('email', '=', 'o@shop.test').executeTakeFirst(), undefined)
    })
  })
})
