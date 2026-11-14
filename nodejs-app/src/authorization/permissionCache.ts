import { config } from '../config/index.ts'
import { db, type Executor } from '../db/database.ts'
import type { User } from '../db/schema.ts'
import { isTenantType } from '../domain/enums.ts'
import { cache } from '../support/cache.ts'
import { permissionNamesFor } from './permissionRegistry.ts'

/**
 * Caches each user's effective roles/permissions.
 *
 * Invalidation is version based: every tenant has a counter that is bumped on
 * any role, permission or assignment change, which orphans all cached entries
 * for that tenant at once. Works with every cache store (no tags required).
 */
export interface AclSnapshot {
  is_admin: boolean
  roles: string[]
  permissions: string[]
}

function versionKey(tenantId: number | null): string {
  return `acl:t${tenantId ?? 'none'}:version`
}

export async function aclVersion(tenantId: number | null): Promise<number> {
  return Number((await cache().get<number>(versionKey(tenantId))) ?? 1)
}

export async function flushTenantAcl(tenantId: number | null): Promise<void> {
  const key = versionKey(tenantId)
  // add() is a no-op when the key exists, so increment always has a base to work from
  await cache().add(key, 1)
  await cache().increment(key)
}

export async function aclSnapshot(user: User, executor: Executor = db()): Promise<AclSnapshot> {
  const version = await aclVersion(user.tenant_id)
  const key = `acl:t${user.tenant_id ?? 'none'}:v${version}:u${user.id}`

  return cache().remember(key, config.permissionsCacheTtl, () => buildSnapshot(user, executor))
}

async function buildSnapshot(user: User, executor: Executor): Promise<AclSnapshot> {
  if (user.tenant_id === null) return { is_admin: false, roles: [], permissions: [] }

  // Only roles of the user's own tenant can ever grant anything
  const roles = await executor
    .selectFrom('roles')
    .innerJoin('role_user', 'role_user.role_id', 'roles.id')
    .where('role_user.user_id', '=', user.id)
    .where('roles.tenant_id', '=', user.tenant_id)
    .select(['roles.id', 'roles.slug', 'roles.is_admin'])
    .orderBy('roles.id')
    .execute()

  const tenant = await executor.selectFrom('tenants').where('id', '=', user.tenant_id).select('type').executeTakeFirst()
  const tenantType = tenant && isTenantType(tenant.type) ? tenant.type : null
  const isAdmin = roles.some((role) => role.is_admin)

  let permissions: string[]

  if (isAdmin && tenantType !== null) {
    permissions = permissionNamesFor(tenantType)
  } else {
    const allowed = new Set(tenantType ? permissionNamesFor(tenantType) : [])
    const granted = roles.length
      ? await executor
          .selectFrom('permission_role')
          .innerJoin('permissions', 'permissions.id', 'permission_role.permission_id')
          .where(
            'permission_role.role_id',
            'in',
            roles.map((role) => role.id)
          )
          .select('permissions.name')
          .distinct()
          .execute()
      : []

    // Intersect with the registry so stale or foreign-scope rows can never grant access
    permissions = granted.map((row) => row.name).filter((name) => allowed.has(name))
  }

  permissions = [...new Set(permissions)].sort()

  return {
    is_admin: isAdmin,
    roles: roles.map((role) => role.slug),
    permissions
  }
}
