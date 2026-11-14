import { flushTenantAcl } from '../../authorization/permissionCache.ts'
import { db, type Executor } from '../../db/database.ts'
import type { Role } from '../../db/schema.ts'
import { requireTenant, t, type Ctx } from '../../support/context.ts'
import { BusinessRuleError } from '../../support/errors.ts'
import { slugify } from '../../support/strings.ts'

export interface RoleInput {
  name?: string
  description?: string | null
  is_admin?: boolean
  /** Already validated against the tenant's permission scopes */
  permissions?: string[]
}

async function uniqueSlug(executor: Executor, tenantId: number, name: string): Promise<string> {
  const base = slugify(name) || 'role'
  let slug = base
  let i = 2

  while (await executor.selectFrom('roles').select('id').where('tenant_id', '=', tenantId).where('slug', '=', slug).executeTakeFirst()) {
    slug = `${base}-${i++}`
  }

  return slug
}

async function syncPermissions(executor: Executor, roleId: number, names: string[]): Promise<void> {
  await executor.deleteFrom('permission_role').where('role_id', '=', roleId).execute()
  if (!names.length) return

  const ids = await executor.selectFrom('permissions').select('id').where('name', 'in', names).execute()
  if (ids.length) {
    await executor
      .insertInto('permission_role')
      .values(ids.map(({ id }) => ({ role_id: roleId, permission_id: id })))
      .execute()
  }
}

export async function createRole(ctx: Ctx, data: RoleInput & { name: string }): Promise<Role> {
  const tenant = requireTenant(ctx)

  const role = await db()
    .transaction()
    .execute(async (trx) => {
      const created = await trx
        .insertInto('roles')
        .values({
          tenant_id: tenant.id,
          name: data.name,
          slug: await uniqueSlug(trx, tenant.id, data.name),
          description: data.description ?? null,
          is_admin: data.is_admin ?? false
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      await syncPermissions(trx, created.id, data.permissions ?? [])
      return created
    })

  await flushTenantAcl(tenant.id)
  return role
}

export async function updateRole(ctx: Ctx, role: Role, data: RoleInput): Promise<Role> {
  if (role.is_system && data.is_admin !== undefined && data.is_admin !== role.is_admin) {
    throw new BusinessRuleError(t(ctx, 'messages.system_role_locked'), 'system_role_locked', 422)
  }

  const updated = await db()
    .transaction()
    .execute(async (trx) => {
      const changes: Partial<Pick<Role, 'name' | 'description' | 'is_admin'>> = {}
      if (data.name !== undefined) changes.name = data.name
      if (data.description !== undefined) changes.description = data.description
      if (data.is_admin !== undefined) changes.is_admin = data.is_admin

      const saved = await trx
        .updateTable('roles')
        .set({ ...changes, updated_at: new Date() })
        .where('id', '=', role.id)
        .returningAll()
        .executeTakeFirstOrThrow()

      if (data.permissions !== undefined) await syncPermissions(trx, role.id, data.permissions)
      return saved
    })

  // Any change to a role (e.g. toggling is_admin) changes the effective permissions of its users
  await flushTenantAcl(role.tenant_id)
  return updated
}

export async function deleteRole(ctx: Ctx, role: Role): Promise<void> {
  if (role.is_system) {
    throw new BusinessRuleError(t(ctx, 'messages.system_role_locked'), 'system_role_locked', 422)
  }

  await db().deleteFrom('roles').where('id', '=', role.id).execute()
  await flushTenantAcl(role.tenant_id)
}
