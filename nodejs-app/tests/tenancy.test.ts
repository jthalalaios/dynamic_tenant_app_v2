import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Tenant, User } from '../src/db/schema.ts'
import { trans } from '../src/support/i18n.ts'
import { api, assertStatus, assertValidationErrors, createPatient, createProduct, createTenant, createUser, fresh, useTestApp } from './helpers.ts'

const { db } = useTestApp()

describe('tenancy', () => {
  let clinicA: Tenant
  let clinicB: Tenant
  let admin: User

  beforeEach(async () => {
    clinicA = await createTenant('doctor')
    clinicB = await createTenant('doctor')
    admin = await createUser(clinicA, ['admin'])
  })

  it('lists only the current tenant records', async () => {
    for (let i = 0; i < 2; i++) await createPatient(clinicA)
    for (let i = 0; i < 3; i++) await createPatient(clinicB)

    const response = await api('GET', '/api/v1/doctor/patients', { as: admin })
    assertStatus(response, 200)
    assert.equal(response.body.data.length, 2)
    assert.equal(response.body.meta.total, 2)
  })

  it("cannot read, update or delete another tenant's record through route binding", async () => {
    const foreign = await createPatient(clinicB)

    const show = await api('GET', `/api/v1/doctor/patients/${foreign.id}`, { as: admin })
    assertStatus(show, 404)
    assert.equal(show.body.message, trans('en', 'messages.not_found'))
    assertStatus(await api('PUT', `/api/v1/doctor/patients/${foreign.id}`, { as: admin, body: { first_name: 'Hacked' } }), 404)
    assertStatus(await api('DELETE', `/api/v1/doctor/patients/${foreign.id}`, { as: admin }), 404)

    const after = await fresh('patients', foreign.id)
    assert.notEqual(after.first_name, 'Hacked')
    assert.equal(after.deleted_at, null)
  })

  it('stamps the tenant on create and ignores a client supplied tenant_id', async () => {
    assertStatus(
      await api('POST', '/api/v1/doctor/patients', { as: admin, body: { first_name: 'Ada', last_name: 'Lovelace', tenant_id: clinicB.id } }),
      201
    )
    const row = await db().selectFrom('patients').select('tenant_id').where('last_name', '=', 'Lovelace').executeTakeFirstOrThrow()
    assert.equal(row.tenant_id, clinicA.id)
  })

  it('rejects foreign keys that point into another tenant', async () => {
    const foreignPatient = await createPatient(clinicB)
    const response = await api('POST', '/api/v1/doctor/appointments', {
      as: admin,
      body: { patient_id: foreignPatient.id, scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), reason: 'consultation' }
    })
    assertValidationErrors(response, ['patient_id'])
  })

  it("hides other tenants' users from administrators", async () => {
    const other = await createUser(clinicB, ['admin'])
    assertStatus(await api('GET', `/api/v1/admin/users/${other.id}`, { as: admin }), 404)
  })

  it('blocks features of the other tenant type', async () => {
    const shop = await createTenant('marketplace')
    const shopAdmin = await createUser(shop, ['admin'])

    const response = await api('GET', '/api/v1/doctor/patients', { as: shopAdmin })
    assertStatus(response, 403)
    assert.equal(response.body.message, trans('en', 'messages.feature_unavailable'))
    assertStatus(await api('GET', '/api/v1/marketplace/products', { as: admin }), 403)
  })

  it('locks out users of a deactivated tenant immediately', async () => {
    const token = (await api('POST', '/api/v1/auth/login', { body: { email: admin.email, password: 'password' } })).body.access_token
    await db().updateTable('tenants').set({ is_active: false }).where('id', '=', clinicA.id).execute()
    assertStatus(await api('GET', '/api/v1/auth/me', { token }), 403)
  })

  it('scopes marketplace products per tenant', async () => {
    const shopA = await createTenant('marketplace')
    const shopB = await createTenant('marketplace')
    await createProduct(shopA, { sku: 'SAME-1' })

    // The same SKU is allowed in another tenant
    assertStatus(
      await api('POST', '/api/v1/marketplace/products', { as: await createUser(shopB, ['admin']), body: { sku: 'SAME-1', name: 'Thing', price_cents: 1000 } }),
      201
    )
  })

  it('returns a 404 for malformed ids instead of a database error', async () => {
    assertStatus(await api('GET', '/api/v1/doctor/patients/abc', { as: admin }), 404)
  })
})
