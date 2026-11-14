import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../src/config/index.ts'
import { workspaceFor } from '../src/tenancy/workspaces.ts'
import { api, assertStatus, createTenant, roleId, useTestApp } from './helpers.ts'
import { syncPermissions } from '../src/authorization/permissionSynchronizer.ts'

const { db } = useTestApp()

/*
| One workspace (organization) per theme: sign-ups join it.
*/
describe('workspaces', () => {
  it('creates a missing workspace once, with every system role', async () => {
    await syncPermissions()
    const clinic = await workspaceFor('doctor')
    const again = await workspaceFor('doctor')

    assert.equal(again.id, clinic.id)
    assert.equal(clinic.slug, config.tenancy.workspaces.doctor.slug)
    assert.equal(clinic.name, config.tenancy.workspaces.doctor.name)
    const roles = await db().selectFrom('roles').select('slug').where('tenant_id', '=', clinic.id).orderBy('slug').execute()
    assert.deepEqual(roles.map((r) => r.slug), ['admin', 'doctor', 'member', 'receptionist'])
  })

  it('adds roles introduced later without touching customised ones', async () => {
    const clinic = await createTenant('doctor', { slug: config.tenancy.workspaces.doctor.slug })
    await db().deleteFrom('roles').where('tenant_id', '=', clinic.id).where('slug', '=', 'member').execute()
    const doctorRole = await roleId(clinic, 'doctor')
    await db().deleteFrom('permission_role').where('role_id', '=', doctorRole).execute()

    await workspaceFor('doctor')

    assert.ok(await db().selectFrom('roles').select('id').where('tenant_id', '=', clinic.id).where('slug', '=', 'member').executeTakeFirst())
    const grants = await db().selectFrom('permission_role').select('permission_id').where('role_id', '=', doctorRole).execute()
    assert.equal(grants.length, 0)
  })

  it('refuses sign-ups while the workspace is deactivated', async () => {
    await createTenant('doctor', { slug: config.tenancy.workspaces.doctor.slug, is_active: false })

    const response = await api('POST', '/api/v1/auth/register', {
      body: { type: 'doctor', name: 'Doc', email: 'doc@closed.test', password: 'Str0ng-Passw0rd!' }
    })
    assertStatus(response, 422)
    assert.equal(response.body.code, 'registration_closed')
    assert.equal(await db().selectFrom('users').select('id').where('email', '=', 'doc@closed.test').executeTakeFirst(), undefined)
  })

  it('names each theme workspace in the public app config', async () => {
    await createTenant('doctor', { slug: config.tenancy.workspaces.doctor.slug, name: 'Renamed Clinic' })

    const response = await api('GET', '/api/v1/app')
    assertStatus(response, 200)
    assert.deepEqual(response.body.workspaces, { doctor: 'Renamed Clinic', marketplace: config.tenancy.workspaces.marketplace.name })
    assert.deepEqual(response.body.features, { registration: true, email_verification: true })
  })
})
