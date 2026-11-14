import { syncRoles } from '../../authorization/acl.ts'
import { flushTenantAcl } from '../../authorization/permissionCache.ts'
import { db, type Executor } from '../../db/database.ts'
import type { User } from '../../db/schema.ts'
import { requireTenant, t, type Ctx } from '../../support/context.ts'
import { BusinessRuleError } from '../../support/errors.ts'
import { hashPassword } from '../../support/hash.ts'
import { revokeAllTokens } from '../auth/tokens.ts'
import { sendEmailVerificationNotification } from '../auth/users.ts'

export interface TeamMemberInput {
  name?: string
  email?: string
  password?: string | null
  timezone?: string | null
  locale?: string | null
  is_active?: boolean
  /** Already restricted to the tenant's roles */
  role_ids?: number[]
}

export async function createTeamMember(ctx: Ctx, data: TeamMemberInput & { name: string; email: string; password: string }): Promise<User> {
  const tenant = requireTenant(ctx)
  const password = await hashPassword(data.password)

  const user = await db()
    .transaction()
    .execute(async (trx) => {
      const created = await trx
        .insertInto('users')
        .values({
          tenant_id: tenant.id,
          name: data.name,
          email: data.email,
          password,
          timezone: data.timezone ?? null,
          locale: data.locale ?? null,
          ...(data.is_active !== undefined ? { is_active: data.is_active } : {})
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      await syncRoles(trx, created, data.role_ids ?? [])
      return created
    })

  await flushTenantAcl(tenant.id)

  // Team members confirm their address too; a mail outage must not fail the creation
  try {
    await sendEmailVerificationNotification(user, ctx.locale)
  } catch (error) {
    console.error('[mail] verification email failed for a new team member', error)
  }

  return user
}

export async function updateTeamMember(ctx: Ctx, user: User, actor: User, data: TeamMemberInput): Promise<User> {
  const updated = await db()
    .transaction()
    .execute(async (trx) => {
      if (user.id === actor.id && data.is_active === false) {
        throw new BusinessRuleError(t(ctx, 'messages.cannot_deactivate_self'), 'self_deactivation', 422)
      }

      if (data.role_ids !== undefined) await guardLastAdmin(ctx, trx, user, data.role_ids)
      if (data.is_active === false) await guardLastAdmin(ctx, trx, user, [])

      const changes: { name?: string; email?: string; password?: string; timezone?: string | null; locale?: string | null; is_active?: boolean } = {}
      if (data.name !== undefined) changes.name = data.name
      if (data.email !== undefined) changes.email = data.email
      if (data.timezone !== undefined) changes.timezone = data.timezone
      if (data.locale !== undefined) changes.locale = data.locale
      if (data.is_active !== undefined) changes.is_active = data.is_active
      // An empty password field means "keep the current one"
      if (data.password) changes.password = await hashPassword(data.password)

      const saved = await trx
        .updateTable('users')
        .set({ ...changes, updated_at: new Date() })
        .where('id', '=', user.id)
        .returningAll()
        .executeTakeFirstOrThrow()

      if (data.role_ids !== undefined) await syncRoles(trx, saved, data.role_ids)
      return saved
    })

  await flushTenantAcl(user.tenant_id)
  return updated
}

export async function deleteTeamMember(ctx: Ctx, user: User, actor: User): Promise<void> {
  if (user.id === actor.id) {
    throw new BusinessRuleError(t(ctx, 'messages.cannot_delete_self'), 'self_deletion', 422)
  }

  await db()
    .transaction()
    .execute(async (trx) => {
      await guardLastAdmin(ctx, trx, user, [])
      await revokeAllTokens(user.id, trx)
      await trx.deleteFrom('users').where('id', '=', user.id).execute()
    })

  await flushTenantAcl(user.tenant_id)
}

/**
 * Refuse changes that would leave the tenant without an active administrator.
 * The other administrators' rows are locked, so two concurrent demotions cannot
 * both pass.
 */
async function guardLastAdmin(ctx: Ctx, trx: Executor, user: User, nextRoleIds: number[]): Promise<void> {
  const tenant = requireTenant(ctx)
  const adminRoleIds = (
    await trx.selectFrom('roles').select('id').where('tenant_id', '=', tenant.id).where('is_admin', '=', true).execute()
  ).map((r) => r.id)

  if (!adminRoleIds.length) return

  const isAdminNow = await trx
    .selectFrom('role_user')
    .select('role_id')
    .where('user_id', '=', user.id)
    .where('role_id', 'in', adminRoleIds)
    .executeTakeFirst()
  const staysAdmin = nextRoleIds.some((id) => adminRoleIds.includes(id))

  if (!isAdminNow || staysAdmin) return

  const otherAdmins = await trx
    .selectFrom('users')
    .select('users.id')
    .where('users.tenant_id', '=', tenant.id)
    .where('users.id', '!=', user.id)
    .where('users.is_active', '=', true)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('role_user')
          .select('role_user.role_id')
          .whereRef('role_user.user_id', '=', 'users.id')
          .where('role_user.role_id', 'in', adminRoleIds)
      )
    )
    .forUpdate()
    .execute()

  if (otherAdmins.length === 0) {
    throw new BusinessRuleError(t(ctx, 'messages.last_admin'), 'last_admin', 422)
  }
}
