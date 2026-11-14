import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('products')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('sku', 'varchar(64)', (col) => col.notNull())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('category', 'varchar(64)')
    // Money is stored as integer minor units to avoid float rounding
    .addColumn('price_cents', 'bigint', (col) => col.notNull().check(sql`price_cents >= 0`))
    .addColumn('currency', 'varchar(3)', (col) => col.notNull().defaultTo('EUR'))
    .addColumn('stock', 'integer', (col) => col.notNull().defaultTo(0).check(sql`stock >= 0`))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('products_tenant_id_sku_unique', ['tenant_id', 'sku'])
    .execute()
  await db.schema.createIndex('products_tenant_id_category_index').on('products').columns(['tenant_id', 'category']).execute()

  await db.schema
    .createTable('orders')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('tenant_id', 'bigint', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('number', 'varchar(32)', (col) => col.notNull())
    .addColumn('customer_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('customer_email', 'varchar(255)')
    .addColumn('status', 'varchar(32)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('total_cents', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('currency', 'varchar(3)', (col) => col.notNull().defaultTo('EUR'))
    .addColumn('placed_by', 'bigint', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('orders_tenant_id_number_unique', ['tenant_id', 'number'])
    .execute()
  await db.schema.createIndex('orders_tenant_id_status_index').on('orders').columns(['tenant_id', 'status']).execute()

  await db.schema
    .createTable('order_items')
    .addColumn('id', 'bigint', (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn('order_id', 'bigint', (col) => col.notNull().references('orders.id').onDelete('cascade'))
    .addColumn('product_id', 'bigint', (col) => col.references('products.id').onDelete('set null'))
    // Snapshot so historical orders stay correct when the product changes
    .addColumn('product_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('unit_price_cents', 'bigint', (col) => col.notNull())
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('line_total_cents', 'bigint', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('order_items_order_id_index').on('order_items').column('order_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('order_items').ifExists().execute()
  await db.schema.dropTable('orders').ifExists().execute()
  await db.schema.dropTable('products').ifExists().execute()
}
