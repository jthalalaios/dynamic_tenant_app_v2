import type { FastifyInstance, FastifyRequest } from 'fastify'
import { db } from '../../db/database.ts'
import type { Order, OrderItem, Product } from '../../db/schema.ts'
import { ORDER_STATUSES, type OrderStatus } from '../../domain/enums.ts'
import { placeOrder, transitionOrder, type OrderInput } from '../../services/marketplace/orders.ts'
import { requireTenant, userTimezone, type Ctx } from '../../support/context.ts'
import { dayRange } from '../../support/time.ts'
import { actor, body, created, idParam, noContent, orNotFound, query, searchTerm } from '../helpers.ts'
import { featureGuards, permission, tenantType } from '../middleware.ts'
import { paginate } from '../pagination.ts'
import { orderResource, productResource } from '../resources.ts'
import {
  alpha,
  array,
  boolean,
  email,
  exists,
  integer,
  max,
  min,
  nullable,
  oneOf,
  required,
  size,
  sometimes,
  string,
  unique,
  validate
} from '../validation.ts'

const LOW_STOCK_THRESHOLD = 10
const REVENUE_STATUSES: OrderStatus[] = ['paid', 'shipped', 'delivered']

function products(ctx: Ctx) {
  return db().selectFrom('products').selectAll().where('tenant_id', '=', requireTenant(ctx).id).where('deleted_at', 'is', null)
}

function orders(ctx: Ctx) {
  return db().selectFrom('orders').selectAll().where('tenant_id', '=', requireTenant(ctx).id).where('deleted_at', 'is', null)
}

async function findProduct(request: FastifyRequest): Promise<Product> {
  return orNotFound(request.ctx, await products(request.ctx).where('id', '=', idParam(request, 'product')).executeTakeFirst())
}

async function findOrder(request: FastifyRequest): Promise<Order> {
  return orNotFound(request.ctx, await orders(request.ctx).where('id', '=', idParam(request, 'order')).executeTakeFirst())
}

async function itemCounts(orderIds: number[]): Promise<Map<number, number>> {
  if (!orderIds.length) return new Map()
  const rows = await db()
    .selectFrom('order_items')
    .select(['order_id', (eb) => eb.fn.countAll<number>().as('c')])
    .where('order_id', 'in', orderIds)
    .groupBy('order_id')
    .execute()
  return new Map(rows.map((r) => [r.order_id, Number(r.c)]))
}

async function placers(rows: Order[]): Promise<Map<number, { id: number; name: string }>> {
  const ids = [...new Set(rows.map((o) => o.placed_by).filter((id): id is number => id !== null))]
  if (!ids.length) return new Map()
  const users = await db().selectFrom('users').select(['id', 'name']).where('id', 'in', ids).execute()
  return new Map(users.map((u) => [u.id, u]))
}

/** An order with its items and who placed it */
async function orderDetails(ctx: Ctx, order: Order, items?: OrderItem[]) {
  const lines = items ?? (await db().selectFrom('order_items').selectAll().where('order_id', '=', order.id).orderBy('id').execute())
  const by = await placers([order])
  return orderResource(ctx, order, { items: lines, placedBy: order.placed_by !== null ? by.get(order.placed_by) ?? null : null })
}

function productRules(ctx: Ctx, creating: boolean, ignoreId: number | null) {
  const tenantId = requireTenant(ctx).id
  const req = creating ? required : sometimes
  return {
    sku: [req, string, max(64), unique('products', 'sku', (q) => q.where('tenant_id', '=', tenantId), ignoreId)],
    name: [req, string, max(160)],
    description: [sometimes, nullable, string, max(5000)],
    category: [sometimes, nullable, string, max(64)],
    price_cents: [req, integer, min(0), max(100_000_000)],
    currency: [sometimes, string, size(3), alpha],
    stock: [sometimes, integer, min(0), max(1_000_000)],
    is_active: [sometimes, boolean]
  }
}

function productPayload(data: Record<string, any>) {
  const payload = { ...data }
  if (typeof payload.currency === 'string') payload.currency = payload.currency.toUpperCase()
  return payload
}

/** Laravel's $request->boolean(): "1", "true", "on", "yes" → true */
function queryBoolean(value: unknown): boolean {
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase())
}

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  const base = [...featureGuards, tenantType('marketplace')]

  app.get('/marketplace/dashboard', { preHandler: [...base, permission('products.view', 'orders.view')] }, async (request) => {
    const ctx = request.ctx
    const tenantId = requireTenant(ctx).id
    const [startOfDay] = dayRange(userTimezone(ctx))
    const countProducts = (q: ReturnType<typeof products>) =>
      q.clearSelect().select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst().then((r) => Number(r?.c ?? 0))
    const countOrders = (q: ReturnType<typeof orders>) =>
      q.clearSelect().select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst().then((r) => Number(r?.c ?? 0))

    const [all, active, units, low, ordersToday, pending, revenue, lowStock, recent] = await Promise.all([
      countProducts(products(ctx)),
      countProducts(products(ctx).where('is_active', '=', true)),
      db()
        .selectFrom('products')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('stock'), eb.lit(0)).as('s'))
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
      countProducts(products(ctx).where('stock', '<', LOW_STOCK_THRESHOLD)),
      countOrders(orders(ctx).where('created_at', '>=', startOfDay)),
      countOrders(orders(ctx).where('status', '=', 'pending')),
      db()
        .selectFrom('orders')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('total_cents'), eb.lit(0)).as('s'))
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .where('status', 'in', REVENUE_STATUSES)
        .executeTakeFirst(),
      products(ctx).where('stock', '<', LOW_STOCK_THRESHOLD).orderBy('stock').orderBy('id').limit(5).execute(),
      orders(ctx).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(5).execute()
    ])

    const counts = await itemCounts(recent.map((o) => o.id))

    return {
      data: {
        stats: {
          products: all,
          active_products: active,
          units_in_stock: Number(units?.s ?? 0),
          low_stock: low,
          orders_today: ordersToday,
          pending_orders: pending,
          revenue_cents: Number(revenue?.s ?? 0)
        },
        low_stock: lowStock.map((p) => productResource(ctx, p)),
        recent_orders: recent.map((o) => orderResource(ctx, o, { itemsCount: counts.get(o.id) ?? 0 }))
      }
    }
  })

  /** Best sellers by units sold (cancelled orders excluded) */
  app.get('/marketplace/insights/top-products', { preHandler: [...base, permission('marketing.view')] }, async (request) => {
    const rows = await db()
      .selectFrom('order_items')
      .innerJoin('orders', 'orders.id', 'order_items.order_id')
      .select((eb) => [
        'order_items.product_name as name',
        eb.fn.sum<number>('order_items.quantity').as('units'),
        eb.fn.sum<number>('order_items.line_total_cents').as('revenue_cents')
      ])
      .where('orders.tenant_id', '=', requireTenant(request.ctx).id)
      .where('orders.deleted_at', 'is', null)
      .where('orders.status', '!=', 'cancelled')
      .groupBy('order_items.product_name')
      .orderBy('units', 'desc')
      .orderBy('order_items.product_name')
      .limit(10)
      .execute()

    return { data: rows.map((r) => ({ name: r.name, units: Number(r.units), revenue_cents: Number(r.revenue_cents) })) }
  })

  // -------------------------------------------------------------------- products

  app.get('/marketplace/products', { preHandler: [...base, permission('products.view')] }, async (request) => {
    const ctx = request.ctx
    const term = searchTerm(request)
    const filters = query(request)
    let q = products(ctx)

    if (term) q = q.where((eb) => eb.or([eb('name', 'ilike', `%${term}%`), eb('sku', 'ilike', `%${term}%`)]))
    if (typeof filters.category === 'string' && filters.category !== '') q = q.where('category', '=', filters.category)
    if (Object.hasOwn(filters, 'active')) q = q.where('is_active', '=', queryBoolean(filters.active))

    return paginate(request, q.orderBy('name').orderBy('id'), (rows) => rows.map((p) => productResource(ctx, p)))
  })

  app.post('/marketplace/products', { preHandler: [...base, permission('products.create')] }, async (request, reply) => {
    const ctx = request.ctx
    const data = productPayload(await validate(ctx, body(request), productRules(ctx, true, null)))
    const product = await db()
      .insertInto('products')
      .values({ ...(data as { sku: string; name: string; price_cents: number }), tenant_id: requireTenant(ctx).id })
      .returningAll()
      .executeTakeFirstOrThrow()
    return created(reply, { data: productResource(ctx, product) })
  })

  app.get('/marketplace/products/:product', { preHandler: [...base, permission('products.view')] }, async (request) => ({
    data: productResource(request.ctx, await findProduct(request))
  }))

  const updateProduct = async (request: FastifyRequest) => {
    const ctx = request.ctx
    const product = await findProduct(request)
    const data = productPayload(await validate(ctx, body(request), productRules(ctx, false, product.id)))
    const updated = await db().updateTable('products').set({ ...data, updated_at: new Date() }).where('id', '=', product.id).returningAll().executeTakeFirstOrThrow()
    return { data: productResource(ctx, updated) }
  }
  app.patch('/marketplace/products/:product', { preHandler: [...base, permission('products.update')] }, updateProduct)
  app.put('/marketplace/products/:product', { preHandler: [...base, permission('products.update')] }, updateProduct)

  app.delete('/marketplace/products/:product', { preHandler: [...base, permission('products.delete')] }, async (request, reply) => {
    const product = await findProduct(request)
    await db().updateTable('products').set({ deleted_at: new Date(), updated_at: new Date() }).where('id', '=', product.id).execute()
    return noContent(reply)
  })

  // ---------------------------------------------------------------------- orders

  app.get('/marketplace/orders', { preHandler: [...base, permission('orders.view')] }, async (request) => {
    const ctx = request.ctx
    const term = searchTerm(request)
    const status = query(request).status
    let q = orders(ctx)

    if (typeof status === 'string' && (ORDER_STATUSES as readonly string[]).includes(status)) q = q.where('status', '=', status as OrderStatus)
    if (term) q = q.where((eb) => eb.or([eb('number', 'ilike', `%${term}%`), eb('customer_name', 'ilike', `%${term}%`)]))

    return paginate(request, q.orderBy('created_at', 'desc').orderBy('id', 'desc'), async (rows) => {
      const [counts, by] = await Promise.all([itemCounts(rows.map((o) => o.id)), placers(rows)])
      return rows.map((o) =>
        orderResource(ctx, o, { itemsCount: counts.get(o.id) ?? 0, placedBy: o.placed_by !== null ? by.get(o.placed_by) ?? null : null })
      )
    })
  })

  app.post('/marketplace/orders', { preHandler: [...base, permission('orders.create')] }, async (request, reply) => {
    const ctx = request.ctx
    const tenantId = requireTenant(ctx).id
    const data = await validate(ctx, body(request), {
      customer_name: [required, string, max(160)],
      customer_email: [nullable, email, max(255)],
      items: [required, array, min(1), max(100)],
      'items.*.product_id': [required, integer, exists('products', 'id', (q) => q.where('tenant_id', '=', tenantId).where('deleted_at', 'is', null))],
      'items.*.quantity': [required, integer, min(1), max(1000)]
    })

    const { order, items } = await placeOrder(ctx, data as OrderInput, actor(request).user)
    return created(reply, { data: await orderDetails(ctx, order, items) })
  })

  app.get('/marketplace/orders/:order', { preHandler: [...base, permission('orders.view')] }, async (request) => ({
    data: await orderDetails(request.ctx, await findOrder(request))
  }))

  app.patch('/marketplace/orders/:order/status', { preHandler: [...base, permission('orders.update')] }, async (request) => {
    const ctx = request.ctx
    const order = await findOrder(request)
    const data = await validate(ctx, body(request), {
      status: [required, oneOf(ORDER_STATUSES.filter((s) => s !== 'pending'))]
    })
    return { data: await orderDetails(ctx, await transitionOrder(ctx, order, data.status)) }
  })
}
