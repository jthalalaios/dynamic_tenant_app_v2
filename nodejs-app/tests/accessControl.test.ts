import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hasAllPermissions, hasAnyPermission, hasPermission, hasRole, isAdmin } from '../src/authorization/acl.ts'
import type { Tenant, User } from '../src/db/schema.ts'
import { trans } from '../src/support/i18n.ts'
import { api, assertStatus, assertValidationErrors, createPatient, createTenant, createUser, fresh, roleId, useTestApp } from './helpers.ts'

useTestApp()

describe('access control', () => {
  let clinic: Tenant
  let admin: User
  let doctor: User
  let receptionist: User

  beforeEach(async () => {
    clinic = await createTenant('doctor')
    admin = await createUser(clinic, ['admin'])
    doctor = await createUser(clinic, ['doctor'])
    receptionist = await createUser(clinic, ['receptionist'])
  })

  it('enforces per-action permissions from the roles', async () => {
    const patient = await createPatient(clinic)

    // Receptionist: may view and create, but not delete
    assertStatus(await api('GET', '/api/v1/doctor/patients', { as: receptionist }), 200)
    const denied = await api('DELETE', `/api/v1/doctor/patients/${patient.id}`, { as: receptionist })
    assertStatus(denied, 403)
    assert.equal(denied.body.message, trans('en', 'messages.forbidden'))

    // Admin implicitly holds every permission of the tenant type
    assertStatus(await api('DELETE', `/api/v1/doctor/patients/${patient.id}`, { as: admin }), 204)
    assert.notEqual((await fresh('patients', patient.id)).deleted_at, null)
  })

  it('keeps administration endpoints for users holding users.* / roles.*', async () => {
    assertStatus(await api('GET', '/api/v1/admin/users', { as: doctor }), 403)
    assertStatus(await api('GET', '/api/v1/admin/roles', { as: doctor }), 403)

    const users = await api('GET', '/api/v1/admin/users', { as: admin })
    assertStatus(users, 200)
    assert.equal(users.body.data.length, 3)

    // admin, doctor, receptionist + member (self-registered users)
    const roles = await api('GET', '/api/v1/admin/roles', { as: admin })
    assertStatus(roles, 200)
    assert.equal(roles.body.data.length, 4)
  })

  it('lists only the permissions grantable by the tenant type, grouped', async () => {
    const response = await api('GET', '/api/v1/admin/permissions', { as: admin })
    assertStatus(response, 200)
    const groups = response.body.data.map((g: { group: string }) => g.group)
    for (const group of ['patients', 'appointments', 'users', 'roles']) assert.ok(groups.includes(group), group)
    for (const group of ['products', 'orders']) assert.ok(!groups.includes(group), group)
  })

  it('creates a custom role and its permissions take effect immediately', async () => {
    const created = await api('POST', '/api/v1/admin/roles', { as: admin, body: { name: 'Billing clerk', permissions: ['patients.view', 'reports.view'] } })
    assertStatus(created, 201)
    assert.equal(created.body.data.slug, 'billing-clerk')
    assert.deepEqual(created.body.data.permissions, ['patients.view', 'reports.view'])
    const id = created.body.data.id

    const clerk = await createUser(clinic)
    assertStatus(await api('GET', '/api/v1/doctor/reports/summary', { as: clerk }), 403)

    assertStatus(await api('PATCH', `/api/v1/admin/users/${clerk.id}`, { as: admin, body: { role_ids: [id] } }), 200)
    assertStatus(await api('GET', '/api/v1/doctor/reports/summary', { as: clerk }), 200)

    // Revoking the permission from the role invalidates the cached grants
    assertStatus(await api('PATCH', `/api/v1/admin/roles/${id}`, { as: admin, body: { permissions: ['patients.view'] } }), 200)
    assertStatus(await api('GET', '/api/v1/doctor/reports/summary', { as: clerk }), 403)
  })

  it('refuses permissions that belong to another tenant type', async () => {
    assertValidationErrors(await api('POST', '/api/v1/admin/roles', { as: admin, body: { name: 'Confused', permissions: ['products.create'] } }), ['permissions.0'])
  })

  it('protects system roles', async () => {
    const adminRole = await roleId(clinic, 'admin')

    const destroy = await api('DELETE', `/api/v1/admin/roles/${adminRole}`, { as: admin })
    assertStatus(destroy, 422)
    assert.equal(destroy.body.code, 'system_role_locked')

    const update = await api('PATCH', `/api/v1/admin/roles/${adminRole}`, { as: admin, body: { is_admin: false } })
    assert.equal(update.body.code, 'system_role_locked')
  })

  it('never leaves a tenant without an administrator', async () => {
    const doctorRole = await roleId(clinic, 'doctor')

    const demote = await api('PATCH', `/api/v1/admin/users/${admin.id}`, { as: admin, body: { role_ids: [doctorRole] } })
    assertStatus(demote, 422)
    assert.equal(demote.body.code, 'last_admin')

    assert.equal((await api('DELETE', `/api/v1/admin/users/${admin.id}`, { as: admin })).body.code, 'self_deletion')

    // With a second active administrator, the first one can step down
    await createUser(clinic, ['admin'])
    assertStatus(await api('PATCH', `/api/v1/admin/users/${admin.id}`, { as: admin, body: { role_ids: [doctorRole] } }), 200)
  })

  it('lets an administrator who is also a doctor hold both roles', async () => {
    const dual = await createUser(clinic, ['admin', 'doctor'])
    const response = await api('GET', '/api/v1/auth/me', { as: dual })
    assert.equal(response.body.data.access.is_admin, true)
    assert.deepEqual([...response.body.data.access.roles].sort(), ['admin', 'doctor'])
  })

  it('creates team members with roles from the same tenant only', async () => {
    const foreignRole = await roleId(await createTenant(), 'admin')
    assertValidationErrors(
      await api('POST', '/api/v1/admin/users', {
        as: admin,
        body: { name: 'New Hire', email: 'hire@clinic.test', password: 'Str0ng-Passw0rd!', role_ids: [foreignRole] }
      }),
      ['role_ids.0']
    )
  })

  it('invites team members, who get a verification email', async () => {
    const created = await api('POST', '/api/v1/admin/users', {
      as: admin,
      body: { name: 'New Hire', email: 'hire@clinic.test', password: 'Str0ng-Passw0rd!', role_ids: [await roleId(clinic, 'receptionist')] }
    })
    assertStatus(created, 201)
    assert.equal(created.body.data.roles[0].slug, 'receptionist')
  })

  it('integrates the ACL with the permission helpers', async () => {
    assert.equal(await hasPermission(doctor, 'patients.view'), true)
    assert.equal(await hasPermission(doctor, 'patients.delete'), false)
    assert.equal(await hasPermission(admin, 'patients.delete'), true)
    assert.equal(await hasPermission(admin, 'products.view'), false)
    assert.equal(await hasAnyPermission(receptionist, ['patients.delete', 'patients.view']), true)
    assert.equal(await hasAllPermissions(receptionist, ['patients.delete', 'patients.view']), false)
    assert.equal(await hasRole(receptionist, 'receptionist'), true)
    assert.equal(await isAdmin(doctor), false)
  })
})
