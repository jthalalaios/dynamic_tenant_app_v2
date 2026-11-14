import { syncRoles } from '../../authorization/acl.ts'
import { flushTenantAcl } from '../../authorization/permissionCache.ts'
import { config } from '../../config/index.ts'
import { db } from '../../db/database.ts'
import type { User } from '../../db/schema.ts'
import type { TenantType } from '../../domain/enums.ts'
import { workspaceFor } from '../../tenancy/workspaces.ts'
import { t, type Ctx } from '../../support/context.ts'
import { BusinessRuleError } from '../../support/errors.ts'
import { hashPassword } from '../../support/hash.ts'
import { sendEmailVerificationNotification } from './users.ts'

export interface RegisterInput {
  type: TenantType
  name: string
  email: string
  password: string
  timezone?: string | null
  locale?: string | null
}

/**
 * Self-service sign up: joins the workspace of the chosen theme (the clinic or the
 * shop) with the least privileged role, tenancy.registration.role. Administrators
 * promote members from the Team page.
 */
export async function registerMember(ctx: Ctx, data: RegisterInput): Promise<User> {
  // Idempotent (creates the workspace and its roles on first use), so it runs before the transaction
  const tenant = await workspaceFor(data.type)

  if (!tenant.is_active) {
    throw new BusinessRuleError(t(ctx, 'messages.registration_closed'), 'registration_closed', 422)
  }

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
          locale: data.locale ?? null
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const role = await trx
        .selectFrom('roles')
        .select('id')
        .where('tenant_id', '=', tenant.id)
        .where('slug', '=', config.tenancy.registration.role)
        .executeTakeFirstOrThrow()

      await syncRoles(trx, created, [role.id])

      return created
    })

  await flushTenantAcl(tenant.id)

  // Sends the verification email; a mail outage must not fail the sign up (the user can resend)
  try {
    await sendEmailVerificationNotification(user, ctx.locale)
  } catch (error) {
    console.error('[mail] verification email failed on sign up', error)
  }

  return user
}
