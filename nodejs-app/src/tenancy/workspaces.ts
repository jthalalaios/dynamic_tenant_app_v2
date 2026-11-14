import { provisionMissingRoles } from '../authorization/permissionSynchronizer.ts'
import { config } from '../config/index.ts'
import { db, type Database } from '../db/database.ts'
import type { Tenant } from '../db/schema.ts'
import type { TenantType } from '../domain/enums.ts'

/**
 * The single organization (tenant) of each theme: everyone who signs up for the
 * clinic joins the clinic workspace, everyone who signs up for the shop joins the
 * shop workspace. Configured in config.tenancy.workspaces.
 */
export function workspaceSlugFor(type: TenantType): string {
  const slug = config.tenancy.workspaces[type]?.slug
  if (!slug) throw new Error(`No workspace configured for the ${type} theme (tenancy.workspaces).`)
  return slug
}

/**
 * The theme's workspace, created (with its system roles) when it does not exist yet.
 * Safe under concurrent sign-ups: the slug is unique.
 */
export async function workspaceFor(type: TenantType, database: Database = db()): Promise<Tenant> {
  const slug = workspaceSlugFor(type)
  let tenant = await database.selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirst()

  if (tenant?.deleted_at) {
    tenant = await database
      .updateTable('tenants')
      .set({ deleted_at: null, updated_at: new Date() })
      .where('id', '=', tenant.id)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  if (!tenant) {
    // createOrFirst: insert, or read the row a concurrent request created first
    await database
      .insertInto('tenants')
      .values({
        name: config.tenancy.workspaces[type]?.name || type.charAt(0).toUpperCase() + type.slice(1),
        slug,
        type,
        timezone: config.tenancy.workspaces.timezone || config.app.timezone,
        locale: config.app.locale,
        is_active: true
      })
      .onConflict((oc) => oc.column('slug').doNothing())
      .execute()
    tenant = await database.selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirstOrThrow()
  }

  if (tenant.type !== type) {
    throw new Error(`Workspace '${slug}' is a ${tenant.type} tenant, not ${type}.`)
  }

  // New workspace, or a role added to config since: create only what is missing
  await provisionMissingRoles(tenant, database)

  return tenant
}

export function isWorkspace(tenant: Tenant): boolean {
  return tenant.slug === config.tenancy.workspaces[tenant.type as TenantType]?.slug
}
