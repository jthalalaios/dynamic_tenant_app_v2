import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('patients')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('first_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('last_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)')
    .addColumn('phone', 'varchar(32)')
    .addColumn('date_of_birth', 'date')
    .addColumn('gender', 'varchar(16)')
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute()
  await db.schema.createIndex('patients_tenant_id_last_name_index').on('patients').columns(['tenant_id', 'last_name']).execute()

  await db.schema
    .createTable('appointments')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('patient_id', 'bigint', (col) => col.notNull().references('patients.id').onDelete('cascade'))
    .addColumn('doctor_id', 'bigint', (col) => col.references('users.id').onDelete('set null'))
    // Always stored in UTC; converted to the viewer's timezone on output
    .addColumn('scheduled_at', 'timestamptz', (col) => col.notNull())
    .addColumn('duration_minutes', 'smallint', (col) => col.notNull().defaultTo(30))
    .addColumn('reason', 'varchar(32)', (col) => col.notNull())
    .addColumn('status', 'varchar(32)', (col) => col.notNull().defaultTo('scheduled'))
    .addColumn('checked_in_at', 'timestamptz')
    .addColumn('checked_in_by', 'bigint', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('completed_at', 'timestamptz')
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute()
  await db.schema.createIndex('appointments_tenant_id_scheduled_at_index').on('appointments').columns(['tenant_id', 'scheduled_at']).execute()
  await db.schema.createIndex('appointments_tenant_id_status_index').on('appointments').columns(['tenant_id', 'status']).execute()

  // A user is "online" while they have an open session with a recent heartbeat
  await db.schema
    .createTable('presence_sessions')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_heartbeat_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ended_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('presence_sessions_user_id_ended_at_index').on('presence_sessions').columns(['user_id', 'ended_at']).execute()
  await db.schema.createIndex('presence_sessions_tenant_id_ended_at_index').on('presence_sessions').columns(['tenant_id', 'ended_at']).execute()

  // At most one open session per user, enforced by the database
  await sql`CREATE UNIQUE INDEX presence_sessions_one_open_per_user ON presence_sessions (user_id) WHERE ended_at IS NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('presence_sessions').ifExists().execute()
  await db.schema.dropTable('appointments').ifExists().execute()
  await db.schema.dropTable('patients').ifExists().execute()
}
