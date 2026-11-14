import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('tenants')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('slug', 'varchar(255)', (col) => col.notNull().unique())
    // doctor | marketplace — drives available features, permissions and the frontend theme
    .addColumn('type', 'varchar(32)', (col) => col.notNull())
    .addColumn('timezone', 'varchar(64)', (col) => col.notNull().defaultTo('UTC'))
    .addColumn('locale', 'varchar(8)', (col) => col.notNull().defaultTo('en'))
    .addColumn('settings', 'jsonb')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute()
  await db.schema.createIndex('tenants_type_index').on('tenants').column('type').execute()

  await db.schema
    .createTable('users')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    // Nullable at the schema level; the API refuses users without a tenant
    .addColumn('tenant_id', 'bigint', (col) => col.references('tenants.id').onDelete('cascade'))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('email_verified_at', 'timestamptz')
    .addColumn('password', 'varchar(255)', (col) => col.notNull())
    .addColumn('timezone', 'varchar(64)')
    .addColumn('locale', 'varchar(8)')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('users_tenant_id_index').on('users').column('tenant_id').execute()

  await db.schema
    .createTable('password_reset_tokens')
    .addColumn('email', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('token', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .execute()

  // Personal access tokens (the JWT's jti), so every token can be revoked
  await db.schema
    .createTable('access_tokens')
    .addColumn('id', 'varchar(80)', (col) => col.primaryKey())
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('name', 'varchar(255)')
    .addColumn('revoked', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute()
  await db.schema.createIndex('access_tokens_user_id_index').on('access_tokens').column('user_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('access_tokens').ifExists().execute()
  await db.schema.dropTable('password_reset_tokens').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()
  await db.schema.dropTable('tenants').ifExists().execute()
}
