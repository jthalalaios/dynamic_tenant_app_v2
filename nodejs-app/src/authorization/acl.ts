import { db, type Executor } from '../db/database.ts'
import type { User } from '../db/schema.ts'
import { aclSnapshot, aclVersion, flushTenantAcl, type AclSnapshot } from './permissionCache.ts'

/**
 * Role / permission API for users (the port of the HasRoles trait), backed by the ACL cache.
 *
 * The snapshot is memoised per user object and cache version, so a long-lived
 * object never serves stale grants after roles change.
 */
const memo = new WeakMap<User, { version: number; data: AclSnapshot }>()

export async function acl(user: User, executor: Executor = db()): Promise<AclSnapshot> {
  const version = await aclVersion(user.tenant_id)
  const cached = memo.get(user)
  if (cached && cached.version === version) return cached.data

  const data = await aclSnapshot(user, executor)
  memo.set(user, { version, data })
  return data
}

export async function isAdmin(user: User): Promise<boolean> {
  return (await acl(user)).is_admin
}

export async function hasPermission(user: User, permission: string): Promise<boolean> {
  return (await acl(user)).permissions.includes(permission)
}

/** True when the user holds at least one of the given permissions */
export async function hasAnyPermission(user: User, permissions: readonly string[]): Promise<boolean> {
  const granted = (await acl(user)).permissions
  return permissions.some((p) => granted.includes(p))
}

export async function hasAllPermissions(user: User, permissions: readonly string[]): Promise<boolean> {
  const granted = (await acl(user)).permissions
  return permissions.every((p) => granted.includes(p))
}

export async function hasRole(user: User, roles: string | readonly string[]): Promise<boolean> {
  const list = typeof roles === 'string' ? [roles] : roles
  const slugs = (await acl(user)).roles
  return list.some((r) => slugs.includes(r))
}

/** Ids of the roles assigned to the user */
export async function roleIdsOf(user: User, executor: Executor = db()): Promise<number[]> {
  const rows = await executor.selectFrom('role_user').where('user_id', '=', user.id).select('role_id').execute()
  return rows.map((row) => row.role_id)
}

/**
 * Replace the user's roles. Callers must pass role ids that belong to the user's tenant.
 * The ACL cache is flushed here; callers inside a transaction flush again after commit.
 */
export async function syncRoles(executor: Executor, user: User, roleIds: readonly number[]): Promise<void> {
  const unique = [...new Set(roleIds)]
  await executor.deleteFrom('role_user').where('user_id', '=', user.id).execute()
  if (unique.length) {
    await executor
      .insertInto('role_user')
      .values(unique.map((roleId) => ({ role_id: roleId, user_id: user.id })))
      .execute()
  }
  await flushTenantAcl(user.tenant_id)
}
