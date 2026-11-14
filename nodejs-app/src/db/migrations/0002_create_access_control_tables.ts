import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Global catalogue, synced from src/config/permissions.ts
  await db.schema
    .createTable('permissions')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('name', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('group', 'varchar(64)', (col) => col.notNull())
    // common | doctor | marketplace — which tenant types may grant it
    .addColumn('scope', 'varchar(32)', (col) => col.notNull())
    .addColumn('description', 'varchar(255)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('permissions_group_index').on('permissions').column('group').execute()
  await db.schema.createIndex('permissions_scope_index').on('permissions').column('scope').execute()

  await db.schema
    .createTable('roles')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('slug', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'varchar(255)')
    // Admin roles implicitly hold every permission available to the tenant
    .addColumn('is_admin', 'boolean', (col) => col.notNull().defaultTo(false))
    // System roles are seeded per tenant: they cannot be deleted and their admin flag is fixed
    .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('roles_tenant_id_slug_unique', ['tenant_id', 'slug'])
    .execute()

  await db.schema
    .createTable('permission_role')
    .addColumn('role_id', 'bigint', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('permission_id', 'bigint', (col) => col.notNull().references('permissions.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('permission_role_pkey', ['role_id', 'permission_id'])
    .execute()

  await db.schema
    .createTable('role_user')
    .addColumn('role_id', 'bigint', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('role_user_pkey', ['role_id', 'user_id'])
    .execute()
  await db.schema.createIndex('role_user_user_id_index').on('role_user').column('user_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('role_user').ifExists().execute()
  await db.schema.dropTable('permission_role').ifExists().execute()
  await db.schema.dropTable('roles').ifExists().execute()
  await db.schema.dropTable('permissions').ifExists().execute()
}
