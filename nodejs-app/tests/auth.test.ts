import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Tenant } from '../src/db/schema.ts'
import { config } from '../src/config/index.ts'
import { issueToken } from '../src/services/auth/tokens.ts'
import { trans } from '../src/support/i18n.ts'
import { api, assertStatus, assertValidationErrors, createTenant, createUser, fresh, mail, useTestApp } from './helpers.ts'

const { db } = useTestApp()

describe('authentication', () => {
  let tenant: Tenant

  beforeEach(async () => {
    tenant = await createTenant('doctor')
  })

  it('logs in with valid credentials and returns a bearer token plus the session', async () => {
    const user = await createUser(tenant, ['doctor'])

    const response = await api('POST', '/api/v1/auth/login', { body: { email: user.email, password: 'password' } })
    assertStatus(response, 200)
    assert.equal(response.body.token_type, 'Bearer')
    assert.equal(response.body.session.user.id, user.id)
    assert.equal(response.body.session.tenant.type, 'doctor')
    assert.equal(response.body.session.access.is_admin, false)
    assert.deepEqual(response.body.session.access.roles, ['doctor'])
    assert.ok(typeof response.body.access_token === 'string' && response.body.access_token.length > 0)
    assert.ok(response.body.session.access.permissions.includes('appointments.check-in'))
    assert.ok(!response.body.session.access.permissions.includes('patients.delete'))

    // The issued JWT authenticates subsequent requests
    const me = await api('GET', '/api/v1/auth/me', { token: response.body.access_token })
    assertStatus(me, 200)
    assert.equal(me.body.data.user.email, user.email)

    assert.notEqual((await fresh('users', user.id)).last_login_at, null)
  })

  for (const email of ['known@example.com', 'unknown@example.com']) {
    it(`rejects wrong credentials without revealing whether the email exists (${email})`, async () => {
      await createUser(tenant, ['doctor'], { email: 'known@example.com' })

      const response = await api('POST', '/api/v1/auth/login', { body: { email, password: 'wrong-password' } })
      assertValidationErrors(response, { email: trans('en', 'auth.failed') })
    })
  }

  it('refuses disabled accounts and inactive tenants', async () => {
    const disabled = await createUser(tenant, [], { is_active: false })
    assertStatus(await api('POST', '/api/v1/auth/login', { body: { email: disabled.email, password: 'password' } }), 422)

    const inactiveTenant = await createTenant('doctor', { is_active: false })
    const user = await createUser(inactiveTenant)
    assertStatus(await api('POST', '/api/v1/auth/login', { body: { email: user.email, password: 'password' } }), 422)
  })

  it('revokes the token on logout', async () => {
    const user = await createUser(tenant, ['doctor'])
    const token = (await api('POST', '/api/v1/auth/login', { body: { email: user.email, password: 'password' } })).body.access_token

    assertStatus(await api('POST', '/api/v1/auth/logout', { token }), 204)
    assertStatus(await api('GET', '/api/v1/auth/me', { token }), 401)
  })

  it('returns a JSON 401 for unauthenticated requests', async () => {
    const response = await api('GET', '/api/v1/auth/me')
    assertStatus(response, 401)
    assert.equal(typeof response.body.message, 'string')
  })

  it('registers into the theme workspace as a chat-only member', async () => {
    const response = await api('POST', '/api/v1/auth/register', {
      body: { type: 'marketplace', name: 'Newcomer', email: 'new@sunrise.test', password: 'Str0ng-Passw0rd!', timezone: 'Europe/Athens' }
    })
    assertStatus(response, 201)
    assert.equal(response.body.session.tenant.type, 'marketplace')
    assert.equal(response.body.session.tenant.slug, config.tenancy.workspaces.marketplace.slug)
    assert.equal(response.body.session.access.is_admin, false)
    assert.deepEqual(response.body.session.access.roles, ['member'])
    assert.deepEqual(response.body.session.access.permissions, ['chat.view'])

    // A second sign-up joins the same workspace: one organization per theme
    const second = await api('POST', '/api/v1/auth/register', {
      body: { type: 'marketplace', name: 'Second', email: 'second@sunrise.test', password: 'Str0ng-Passw0rd!' }
    })
    assertStatus(second, 201)
    assert.equal(second.body.session.tenant.id, response.body.session.tenant.id)

    const workspaces = await db().selectFrom('tenants').selectAll().where('type', '=', 'marketplace').execute()
    assert.equal(workspaces.length, 1)
    const roles = await db().selectFrom('roles').select('slug').where('tenant_id', '=', workspaces[0].id).orderBy('slug').execute()
    assert.deepEqual(roles.map((r) => r.slug), ['admin', 'manager', 'member', 'sales'])
  })

  it('ignores a sent organization name: there is nothing to create', async () => {
    const response = await api('POST', '/api/v1/auth/register', {
      body: { organization: 'My Own Clinic', type: 'doctor', name: 'Doc', email: 'doc@own.test', password: 'Str0ng-Passw0rd!' }
    })
    assertStatus(response, 201)
    assert.equal(response.body.session.tenant.slug, config.tenancy.workspaces.doctor.slug)
    assert.equal(await db().selectFrom('tenants').select('id').where('name', '=', 'My Own Clinic').executeTakeFirst(), undefined)
  })

  it('validates sign-up input with Laravel-style messages', async () => {
    const response = await api('POST', '/api/v1/auth/register', { body: { type: 'doctor', name: '', email: 'not-an-email', password: 'short' } })
    assertValidationErrors(response, {
      name: 'The name field is required.',
      email: 'The email field must be a valid email address.',
      password: 'The password field must be at least 8 characters.'
    })
    assert.equal(response.body.message, 'The name field is required. (and 2 more errors)')
  })

  it('updates profile preferences and rejects invalid timezones', async () => {
    const user = await createUser(tenant, ['doctor'])

    const response = await api('PATCH', '/api/v1/auth/profile', { as: user, body: { timezone: 'Europe/Athens', locale: 'el' } })
    assertStatus(response, 200)
    assert.equal(response.body.data.user.timezone, 'Europe/Athens')
    assert.equal(response.body.data.preferences.locale, 'el')

    assertValidationErrors(await api('PATCH', '/api/v1/auth/profile', { as: user, body: { timezone: 'Mars/Olympus' } }), ['timezone'])
  })

  it('changes the password only with the current one', async () => {
    const user = await createUser(tenant, ['doctor'])

    assertValidationErrors(
      await api('PATCH', '/api/v1/auth/profile', { as: user, body: { password: 'N3w-Passw0rd!', password_confirmation: 'N3w-Passw0rd!' } }),
      ['current_password']
    )
    assertValidationErrors(
      await api('PATCH', '/api/v1/auth/profile', {
        as: user,
        body: { current_password: 'wrong', password: 'N3w-Passw0rd!', password_confirmation: 'N3w-Passw0rd!' }
      }),
      ['current_password']
    )
    assertStatus(
      await api('PATCH', '/api/v1/auth/profile', {
        as: user,
        body: { current_password: 'password', password: 'N3w-Passw0rd!', password_confirmation: 'N3w-Passw0rd!' }
      }),
      200
    )
    assertStatus(await api('POST', '/api/v1/auth/login', { body: { email: user.email, password: 'N3w-Passw0rd!' } }), 200)
  })

  it('throttles repeated login attempts for the same email', async () => {
    for (let i = 0; i < 5; i++) {
      assertStatus(await api('POST', '/api/v1/auth/login', { body: { email: 'victim@example.com', password: 'guess' } }), 422)
    }

    const response = await api('POST', '/api/v1/auth/login', { body: { email: 'victim@example.com', password: 'guess' } })
    assertStatus(response, 429)
    assert.ok(response.headers['retry-after'])
  })

  it('resets the password from the emailed token and signs out every device', async () => {
    const user = await createUser(tenant, ['doctor'], { email: 'forgetful@clinic.test' })
    // Issued directly: the auth endpoints allow 5 attempts per email and minute, and this test needs them all
    const oldToken = (await issueToken(user)).accessToken

    assertStatus(await api('POST', '/api/v1/auth/forgot-password', { body: { email: user.email } }), 200)
    const url = new URL((mail.sent.at(-1) as any).url)
    assert.equal(url.pathname, '/reset-password')
    const token = url.searchParams.get('token')!

    assertValidationErrors(
      await api('POST', '/api/v1/auth/reset-password', { body: { token: 'wrong', email: user.email, password: 'N3w-Passw0rd!', password_confirmation: 'N3w-Passw0rd!' } }),
      { email: trans('en', 'passwords.token') }
    )

    const reset = await api('POST', '/api/v1/auth/reset-password', {
      body: { token, email: user.email, password: 'N3w-Passw0rd!', password_confirmation: 'N3w-Passw0rd!' }
    })
    assertStatus(reset, 200)
    assert.equal(reset.body.message, trans('en', 'passwords.reset'))

    assertStatus(await api('GET', '/api/v1/auth/me', { token: oldToken }), 401)
    assertStatus(await api('POST', '/api/v1/auth/login', { body: { email: user.email, password: 'N3w-Passw0rd!' } }), 200)
    // The token is single use
    assertStatus(
      await api('POST', '/api/v1/auth/reset-password', { body: { token, email: user.email, password: 'An0ther-Pass!', password_confirmation: 'An0ther-Pass!' } }),
      422
    )
  })
})
