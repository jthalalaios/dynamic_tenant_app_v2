import type { FastifyInstance, FastifyRequest } from 'fastify'
import { sql } from 'kysely'
import { permissionNamesFor } from '../../authorization/permissionRegistry.ts'
import { config } from '../../config/index.ts'
import { db } from '../../db/database.ts'
import type { Role, User } from '../../db/schema.ts'
import { permissionScopes, type TenantType } from '../../domain/enums.ts'
import { createRole, deleteRole, updateRole } from '../../services/admin/roleService.ts'
import { createTeamMember, deleteTeamMember, updateTeamMember } from '../../services/admin/userService.ts'
import { requireTenant, type Ctx } from '../../support/context.ts'
import { actor, body, created, idParam, noContent, orNotFound, query, searchTerm } from '../helpers.ts'
import { featureGuards, permission } from '../middleware.ts'
import { paginate } from '../pagination.ts'
import { permissionResource, roleResource, userResource } from '../resources.ts'
import {
  array,
  boolean,
  distinct,
  email,
  exists,
  integer,
  isIntegerLike,
  max,
  min,
  nullable,
  oneOf,
  present,
  required,
  sometimes,
  string,
  timezone,
  unique,
  validate
} from '../validation.ts'

/**
 * Administration: available to every tenant type, gated by users.* / roles.* permissions.
 */
async function rolesByUser(userIds: number[]): Promise<Map<number, Role[]>> {
  const byUser = new Map<number, Role[]>()
  if (!userIds.length) return byUser

  const rows = await db()
    .selectFrom('roles')
    .innerJoin('role_user', 'role_user.role_id', 'roles.id')
    .selectAll('roles')
    .select('role_user.user_id')
    .where('role_user.user_id', 'in', userIds)
    .orderBy('roles.id')
    .execute()

  for (const { user_id, ...role } of rows) {
    const list = byUser.get(user_id) ?? []
    list.push(role)
    byUser.set(user_id, list)
  }

  return byUser
}

async function userWithRoles(ctx: Ctx, user: User) {
  return userResource(ctx, user, (await rolesByUser([user.id])).get(user.id) ?? [])
}

async function findTeamMember(request: FastifyRequest): Promise<User> {
  const tenant = requireTenant(request.ctx)
  const user = await db()
    .selectFrom('users')
    .selectAll()
    .where('id', '=', idParam(request, 'user'))
    .where('tenant_id', '=', tenant.id)
    .executeTakeFirst()
  return orNotFound(request.ctx, user)
}

async function findRole(request: FastifyRequest): Promise<Role> {
  const tenant = requireTenant(request.ctx)
  const role = await db().selectFrom('roles').selectAll().where('id', '=', idParam(request, 'role')).where('tenant_id', '=', tenant.id).executeTakeFirst()
  return orNotFound(request.ctx, role)
}

async function roleDetails(role: Role) {
  const [permissions, users] = await Promise.all([
    db()
      .selectFrom('permission_role')
      .innerJoin('permissions', 'permissions.id', 'permission_role.permission_id')
      .select('permissions.name')
      .where('permission_role.role_id', '=', role.id)
      .orderBy('permissions.id')
      .execute(),
    db().selectFrom('role_user').select((eb) => eb.fn.countAll<number>().as('count')).where('role_id', '=', role.id).executeTakeFirst()
  ])
  return roleResource(role, { permissions: permissions.map((p) => p.name), usersCount: Number(users?.count ?? 0) })
}

/** Create (POST) and partial update (PATCH / PUT) of a team member */
function userRules(request: FastifyRequest, creating: boolean, ignoreId: number | null) {
  const tenantId = requireTenant(request.ctx).id
  const req = creating ? required : sometimes

  return {
    name: [req, string, max(120)],
    email: [req, string, email, max(255), unique('users', 'email', undefined, ignoreId)],
    password: creating ? [required, string, min(8)] : [sometimes, nullable, string, min(8)],
    timezone: [sometimes, nullable, timezone],
    locale: [sometimes, nullable, oneOf(config.tenancy.locales)],
    is_active: [sometimes, boolean],
    role_ids: [creating ? present : sometimes, array],
    'role_ids.*': [integer, distinct, exists('roles', 'id', (q) => q.where('tenant_id', '=', tenantId))]
  }
}

function roleRules(request: FastifyRequest, creating: boolean) {
  const type = requireTenant(request.ctx).type as TenantType

  return {
    name: [creating ? required : sometimes, string, max(80)],
    description: [sometimes, nullable, string, max(255)],
    is_admin: [sometimes, boolean],
    permissions: [sometimes, array],
    // Only permissions valid for this tenant type can be granted (no doctor perms in a shop)
    'permissions.*': [string, distinct, oneOf(permissionNamesFor(type))]
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ----------------------------------------------------------------- users

  app.get('/admin/users', { preHandler: [...featureGuards, permission('users.view')] }, async (request) => {
    const ctx = request.ctx
    const term = searchTerm(request)
    const roleId = query(request).role_id

    let q = db().selectFrom('users').selectAll().where('tenant_id', '=', requireTenant(ctx).id)
    if (term) q = q.where((eb) => eb.or([eb('name', 'ilike', `%${term}%`), eb('email', 'ilike', `%${term}%`)]))
    if (roleId !== undefined && roleId !== null && roleId !== '') {
      const id = isIntegerLike(roleId) ? Number(roleId) : 0
      q = q.where((eb) => eb.exists(eb.selectFrom('role_user').select('role_id').whereRef('role_user.user_id', '=', 'users.id').where('role_user.role_id', '=', id)))
    }

    return paginate(request, q.orderBy('name').orderBy('id'), async (users) => {
      const roles = await rolesByUser(users.map((u) => u.id))
      return users.map((user) => userResource(ctx, user, roles.get(user.id) ?? []))
    })
  })

  app.post('/admin/users', { preHandler: [...featureGuards, permission('users.create')] }, async (request, reply) => {
    const data = await validate(request.ctx, body(request), userRules(request, true, null))
    const user = await createTeamMember(request.ctx, data as Parameters<typeof createTeamMember>[1])
    return created(reply, { data: await userWithRoles(request.ctx, user) })
  })

  app.get('/admin/users/:user', { preHandler: [...featureGuards, permission('users.view')] }, async (request) => ({
    data: await userWithRoles(request.ctx, await findTeamMember(request))
  }))

  const updateUser = async (request: FastifyRequest) => {
    const user = await findTeamMember(request)
    const data = await validate(request.ctx, body(request), userRules(request, false, user.id))
    const updated = await updateTeamMember(request.ctx, user, actor(request).user, data)
    return { data: await userWithRoles(request.ctx, updated) }
  }
  app.patch('/admin/users/:user', { preHandler: [...featureGuards, permission('users.update')] }, updateUser)
  app.put('/admin/users/:user', { preHandler: [...featureGuards, permission('users.update')] }, updateUser)

  app.delete('/admin/users/:user', { preHandler: [...featureGuards, permission('users.delete')] }, async (request, reply) => {
    await deleteTeamMember(request.ctx, await findTeamMember(request), actor(request).user)
    return noContent(reply)
  })

  // ----------------------------------------------------------------- roles

  /** Roles are few per tenant, so the list is not paginated */
  app.get('/admin/roles', { preHandler: [...featureGuards, permission('roles.view')] }, async (request) => {
    const tenant = requireTenant(request.ctx)
    const roles = await db()
      .selectFrom('roles')
      .selectAll('roles')
      .select((eb) =>
        eb.selectFrom('role_user').select(eb.fn.countAll<number>().as('c')).whereRef('role_user.role_id', '=', 'roles.id').as('users_count')
      )
      .where('roles.tenant_id', '=', tenant.id)
      .orderBy('roles.is_admin', 'desc')
      .orderBy('roles.name')
      .orderBy('roles.id')
      .execute()

    const names = roles.length
      ? await db()
          .selectFrom('permission_role')
          .innerJoin('permissions', 'permissions.id', 'permission_role.permission_id')
          .select(['permission_role.role_id', 'permissions.name'])
          .where('permission_role.role_id', 'in', roles.map((r) => r.id))
          .orderBy('permissions.id')
          .execute()
      : []

    return {
      data: roles.map(({ users_count, ...role }) =>
        roleResource(role, {
          permissions: names.filter((n) => n.role_id === role.id).map((n) => n.name),
          usersCount: Number(users_count ?? 0)
        })
      )
    }
  })

  app.post('/admin/roles', { preHandler: [...featureGuards, permission('roles.create')] }, async (request, reply) => {
    const data = await validate(request.ctx, body(request), roleRules(request, true))
    const role = await createRole(request.ctx, data as Parameters<typeof createRole>[1])
    return created(reply, { data: await roleDetails(role) })
  })

  app.get('/admin/roles/:role', { preHandler: [...featureGuards, permission('roles.view')] }, async (request) => ({
    data: await roleDetails(await findRole(request))
  }))

  const updateRoleRoute = async (request: FastifyRequest) => {
    const role = await findRole(request)
    const data = await validate(request.ctx, body(request), roleRules(request, false))
    return { data: await roleDetails(await updateRole(request.ctx, role, data)) }
  }
  app.patch('/admin/roles/:role', { preHandler: [...featureGuards, permission('roles.update')] }, updateRoleRoute)
  app.put('/admin/roles/:role', { preHandler: [...featureGuards, permission('roles.update')] }, updateRoleRoute)

  app.delete('/admin/roles/:role', { preHandler: [...featureGuards, permission('roles.delete')] }, async (request, reply) => {
    await deleteRole(request.ctx, await findRole(request))
    return noContent(reply)
  })

  // ---------------------------------------------------------- permissions

  /** Permissions this tenant may grant, grouped for a role editor matrix */
  app.get(
    '/admin/permissions',
    { preHandler: [...featureGuards, permission('roles.view', 'roles.create', 'roles.update')] },
    async (request) => {
      const type = requireTenant(request.ctx).type as TenantType
      const permissions = await db()
        .selectFrom('permissions')
        .selectAll()
        .where('scope', 'in', permissionScopes(type))
        .orderBy(sql`"group"`)
        .orderBy('name')
        .execute()

      const groups = new Map<string, ReturnType<typeof permissionResource>[]>()
      for (const p of permissions) {
        const list = groups.get(p.group) ?? []
        list.push(permissionResource(p))
        groups.set(p.group, list)
      }

      return { data: [...groups].map(([group, items]) => ({ group, permissions: items })) }
    }
  )
}
