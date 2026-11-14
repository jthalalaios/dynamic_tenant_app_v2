import { sql, type Kysely } from 'kysely'

/**
 * Live chat. Rooms are scoped by audience inside each workspace (everyone /
 * admins / roles); each workspace has its own "Global" room (its default room).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('chat_rooms')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('name', 'varchar(60)', (col) => col.notNull())
    .addColumn('slug', 'varchar(80)', (col) => col.notNull())
    .addColumn('description', 'varchar(240)')
    .addColumn('icon', 'varchar(32)', (col) => col.notNull().defaultTo('comments'))
    // The tenant's default room can be edited but never deleted
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    // Locked room: only administrators may post ("mute everyone")
    .addColumn('is_locked', 'boolean', (col) => col.notNull().defaultTo(false))
    // everyone | admins | roles (see chat_room_role)
    .addColumn('audience', 'varchar(16)', (col) => col.notNull().defaultTo('everyone'))
    .addColumn('created_by', 'bigint', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('chat_rooms_tenant_id_slug_unique', ['tenant_id', 'slug'])
    .execute()

  // Roles allowed in when the audience is "roles"
  await db.schema
    .createTable('chat_room_role')
    .addColumn('room_id', 'bigint', (col) => col.notNull().references('chat_rooms.id').onDelete('cascade'))
    .addColumn('role_id', 'bigint', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('chat_room_role_pkey', ['room_id', 'role_id'])
    .execute()

  await db.schema
    .createTable('chat_messages')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('room_id', 'bigint', (col) => col.notNull().references('chat_rooms.id').onDelete('cascade'))
    .addColumn('user_id', 'bigint', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('deleted_by', 'bigint', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute()
  // History is paged backwards by id within a room
  await db.schema.createIndex('chat_messages_room_id_id_index').on('chat_messages').columns(['room_id', 'id']).execute()

  // room_id NULL = muted in every room of the tenant; expires_at NULL = until lifted
  await db.schema
    .createTable('chat_mutes')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('room_id', 'bigint', (col) => col.references('chat_rooms.id').onDelete('cascade'))
    .addColumn('muted_by', 'bigint', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('reason', 'varchar(240)')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('chat_mutes_user_id_room_id_index').on('chat_mutes').columns(['user_id', 'room_id']).execute()
  await db.schema.createIndex('chat_mutes_tenant_id_expires_at_index').on('chat_mutes').columns(['tenant_id', 'expires_at']).execute()

  // Per user read marker, drives the unread badges
  await db.schema
    .createTable('chat_room_reads')
    .addColumn('room_id', 'bigint', (col) => col.notNull().references('chat_rooms.id').onDelete('cascade'))
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('last_read_message_id', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz')
    .addPrimaryKeyConstraint('chat_room_reads_pkey', ['room_id', 'user_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('chat_room_reads').ifExists().execute()
  await db.schema.dropTable('chat_mutes').ifExists().execute()
  await db.schema.dropTable('chat_messages').ifExists().execute()
  await db.schema.dropTable('chat_room_role').ifExists().execute()
  await db.schema.dropTable('chat_rooms').ifExists().execute()
}
