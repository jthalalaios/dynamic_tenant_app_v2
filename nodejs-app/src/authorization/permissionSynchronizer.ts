import { sql } from 'kysely'
import { db, type Executor } from '../db/database.ts'
import type { Tenant } from '../db/schema.ts'
import { isTenantType } from '../domain/enums.ts'
import { flushTenantAcl } from './permissionCache.ts'
import { allPermissions, defaultRoles } from './permissionRegistry.ts'

/**
 * Upsert the registry into the permissions table and prune removed entries.
 */
export async function syncPermissions(executor: Executor = db()): Promise<{ synced: number; pruned: number }> {
  const definitions = allPermissions()
  const names = definitions.map((p) => p.name)
  const now = new Date()

  const pruned = await executor.transaction().execute(async (trx) => {
    await trx
      .insertInto('permissions')
      .values(definitions.map((p) => ({ ...p, created_at: now, updated_at: now })))
      .onConflict((oc) =>
        oc.column('name').doUpdateSet({
          group: (eb) => eb.ref('excluded.group'),
          scope: (eb) => eb.ref('excluded.scope'),
          description: (eb) => eb.ref('excluded.description'),
          updated_at: now
        })
      )
      .execute()

    const result = await trx.deleteFrom('permissions').where('name', 'not in', names).executeTakeFirst()
    return Number(result.numDeletedRows)
  })

  // Every tenant's cached grants may reference changed or removed permissions
  const tenants = await executor.selectFrom('tenants').select('id').execute()
  for (const { id } of tenants) await flushTenantAcl(id)

  return { synced: definitions.length, pruned }
}

async function permissionIdsByName(executor: Executor): Promise<Map<string, number>> {
  const rows = await executor.selectFrom('permissions').select(['id', 'name']).execute()
  return new Map(rows.map((row) => [row.name, row.id]))
}

async function syncRolePermissions(executor: Executor, roleId: number, names: string[], ids: Map<string, number>): Promise<void> {
  const permissionIds = names.map((name) => ids.get(name)).filter((id): id is number => id !== undefined)
  await executor.deleteFrom('permission_role').where('role_id', '=', roleId).execute()
  if (permissionIds.length) {
    await executor
      .insertInto('permission_role')
      .values(permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId })))
      .execute()
  }
}

/**
 * Create the system roles a tenant is missing (e.g. one added to config later),
 * leaving existing roles and their customised permissions untouched.
 */
export async function provisionMissingRoles(tenant: Tenant, executor: Executor = db()): Promise<void> {
  if (!isTenantType(tenant.type)) return

  const created = await executor.transaction().execute(async (trx) => {
    const existing = new Set(
      (await trx.selectFrom('roles').where('tenant_id', '=', tenant.id).select('slug').execute()).map((r) => r.slug)
    )
    const ids = await permissionIdsByName(trx)
    let any = false

    for (const [slug, definition] of Object.entries(defaultRoles(tenant.type))) {
      if (existing.has(slug)) continue

      // Concurrent provisioning (two first sign-ups) may race: the unique (tenant_id, slug) decides
      const role = await trx
        .insertInto('roles')
        .values({ tenant_id: tenant.id, slug, name: definition.name, is_admin: definition.is_admin, is_system: true })
        .onConflict((oc) => oc.columns(['tenant_id', 'slug']).doNothing())
        .returning('id')
        .executeTakeFirst()

      if (role) {
        await syncRolePermissions(trx, role.id, definition.permissions, ids)
        any = true
      }
    }

    return any
  })

  if (created) await flushTenantAcl(tenant.id)
}

/**
 * Create (or refresh) the system roles a tenant of this type starts with.
 */
export async function provisionTenantRoles(tenant: Tenant, executor: Executor = db()): Promise<void> {
  if (!isTenantType(tenant.type)) return

  await executor.transaction().execute(async (trx) => {
    const ids = await permissionIdsByName(trx)

    for (const [slug, definition] of Object.entries(defaultRoles(tenant.type))) {
      const role = await trx
        .insertInto('roles')
        .values({ tenant_id: tenant.id, slug, name: definition.name, is_admin: definition.is_admin, is_system: true })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'slug']).doUpdateSet({
            name: definition.name,
            is_admin: definition.is_admin,
            is_system: true,
            updated_at: sql`now()`
          })
        )
        .returning('id')
        .executeTakeFirstOrThrow()

      await syncRolePermissions(trx, role.id, definition.permissions, ids)
    }
  })

  await flushTenantAcl(tenant.id)
}
