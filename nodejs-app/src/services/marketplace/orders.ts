import { sql } from 'kysely'
import { db, type Executor } from '../../db/database.ts'
import type { Order, OrderItem, User } from '../../db/schema.ts'
import { orderCanTransition, type OrderStatus } from '../../domain/enums.ts'
import { fail } from '../../http/validation.ts'
import { requireTenant, t, type Ctx } from '../../support/context.ts'
import { BusinessRuleError, NotFoundError } from '../../support/errors.ts'
import { randomString } from '../../support/strings.ts'
import { utcStamp } from '../../support/time.ts'

export interface OrderInput {
  customer_name: string
  customer_email?: string | null
  items: { product_id: number; quantity: number }[]
}

/**
 * Place an order, reserving stock atomically.
 */
export async function placeOrder(ctx: Ctx, data: OrderInput, actor: User): Promise<{ order: Order; items: OrderItem[] }> {
  const tenant = requireTenant(ctx)

  return db()
    .transaction()
    .execute(async (trx) => {
      // Merge duplicate lines, then lock rows in a stable order to avoid deadlocks
      const quantities = new Map<number, number>()
      for (const line of data.items) quantities.set(line.product_id, (quantities.get(line.product_id) ?? 0) + line.quantity)
      const productIds = [...quantities.keys()].sort((a, b) => a - b)

      const products = new Map(
        (
          await trx
            .selectFrom('products')
            .selectAll()
            .where('id', 'in', productIds)
            .where('tenant_id', '=', tenant.id)
            .where('deleted_at', 'is', null)
            .orderBy('id')
            .forUpdate()
            .execute()
        ).map((p) => [p.id, p])
      )

      const currencies = new Set([...products.values()].map((p) => p.currency))
      if (currencies.size > 1) {
        throw new BusinessRuleError(t(ctx, 'messages.mixed_currencies'), 'mixed_currencies', 422)
      }

      const lines: Omit<OrderItem, 'id' | 'order_id' | 'created_at' | 'updated_at'>[] = []

      for (const productId of productIds) {
        const quantity = quantities.get(productId)!
        const product = products.get(productId)

        if (!product || !product.is_active) {
          fail('items', t(ctx, 'messages.product_unavailable'))
        }

        if (product.stock < quantity) {
          fail('items', t(ctx, 'messages.insufficient_stock', { product: product.name, stock: product.stock }))
        }

        await trx
          .updateTable('products')
          .set({ stock: sql`stock - ${quantity}`, updated_at: new Date() })
          .where('id', '=', product.id)
          .execute()

        lines.push({
          product_id: product.id,
          product_name: product.name,
          unit_price_cents: product.price_cents,
          quantity,
          line_total_cents: product.price_cents * quantity
        })
      }

      const order = await trx
        .insertInto('orders')
        .values({
          tenant_id: tenant.id,
          number: await nextNumber(trx, tenant.id),
          customer_name: data.customer_name,
          customer_email: data.customer_email ?? null,
          status: 'pending',
          total_cents: lines.reduce((sum, line) => sum + line.line_total_cents, 0),
          currency: [...currencies][0] ?? 'EUR',
          placed_by: actor.id
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const items = lines.length
        ? await trx
            .insertInto('order_items')
            .values(lines.map((line) => ({ ...line, order_id: order.id })))
            .returningAll()
            .execute()
        : []

      return { order, items: items.sort((a, b) => a.id - b.id) }
    })
}

export async function transitionOrder(ctx: Ctx, order: Order, next: OrderStatus): Promise<Order> {
  const tenant = requireTenant(ctx)

  return db()
    .transaction()
    .execute(async (trx) => {
      const locked = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', order.id)
        .where('tenant_id', '=', tenant.id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst()

      if (!locked) throw new NotFoundError(t(ctx, 'messages.not_found'))

      if (!orderCanTransition(locked.status as OrderStatus, next)) {
        throw new BusinessRuleError(
          t(ctx, 'messages.invalid_transition', { from: locked.status, to: next }),
          'invalid_status_transition',
          422
        )
      }

      // Cancelling releases the reserved stock back to the catalogue (soft-deleted products too)
      if (next === 'cancelled') {
        const items = await trx.selectFrom('order_items').selectAll().where('order_id', '=', locked.id).execute()
        for (const item of items) {
          if (item.product_id !== null) {
            await trx
              .updateTable('products')
              .set({ stock: sql`stock + ${item.quantity}`, updated_at: new Date() })
              .where('id', '=', item.product_id)
              .execute()
          }
        }
      }

      return trx
        .updateTable('orders')
        .set({ status: next, updated_at: new Date() })
        .where('id', '=', locked.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    })
}

async function nextNumber(trx: Executor, tenantId: number): Promise<string> {
  for (;;) {
    const number = `ORD-${utcStamp(new Date(), 'yyMMdd')}-${randomString(6).toUpperCase()}`
    const taken = await trx.selectFrom('orders').select('id').where('tenant_id', '=', tenantId).where('number', '=', number).executeTakeFirst()
    if (!taken) return number
  }
}
