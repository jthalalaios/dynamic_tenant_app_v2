import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Product, Tenant, User } from '../src/db/schema.ts'
import { api, assertStatus, assertValidationErrors, createProduct, createTenant, createUser, fresh, useTestApp } from './helpers.ts'

useTestApp()

describe('orders', () => {
  let shop: Tenant
  let sales: User
  let manager: User
  let product: Product

  beforeEach(async () => {
    shop = await createTenant('marketplace')
    sales = await createUser(shop, ['sales'])
    manager = await createUser(shop, ['manager'])
    product = await createProduct(shop, { price_cents: 1250, stock: 5 })
  })

  it('places an order, snapshots prices and reserves stock', async () => {
    const response = await api('POST', '/api/v1/marketplace/orders', {
      as: sales,
      body: {
        customer_name: 'Jane',
        items: [
          { product_id: product.id, quantity: 2 },
          { product_id: product.id, quantity: 1 }
        ]
      }
    })
    assertStatus(response, 201)
    assert.equal(response.body.data.status, 'pending')
    assert.equal(response.body.data.total_cents, 3750)
    assert.equal(response.body.data.items.length, 1)
    assert.equal(response.body.data.items[0].quantity, 3)
    assert.deepEqual(response.body.data.allowed_transitions, ['paid', 'cancelled'])
    assert.equal(response.body.data.placed_by.id, sales.id)
    assert.match(response.body.data.number, /^ORD-\d{6}-[A-Z0-9]{6}$/)

    assert.equal((await fresh('products', product.id)).stock, 2)
  })

  it('rejects orders exceeding stock and leaves stock untouched', async () => {
    assertValidationErrors(
      await api('POST', '/api/v1/marketplace/orders', { as: sales, body: { customer_name: 'Jane', items: [{ product_id: product.id, quantity: 6 }] } }),
      ['items']
    )
    assert.equal((await fresh('products', product.id)).stock, 5)
  })

  it('releases stock when an order is cancelled', async () => {
    const orderId = (
      await api('POST', '/api/v1/marketplace/orders', { as: sales, body: { customer_name: 'Jane', items: [{ product_id: product.id, quantity: 4 }] } })
    ).body.data.id

    // Sales associates cannot change order status
    assertStatus(await api('PATCH', `/api/v1/marketplace/orders/${orderId}/status`, { as: sales, body: { status: 'cancelled' } }), 403)

    const cancelled = await api('PATCH', `/api/v1/marketplace/orders/${orderId}/status`, { as: manager, body: { status: 'cancelled' } })
    assertStatus(cancelled, 200)
    assert.equal(cancelled.body.data.status, 'cancelled')
    assert.equal((await fresh('products', product.id)).stock, 5)

    // A final state has no way out
    const again = await api('PATCH', `/api/v1/marketplace/orders/${orderId}/status`, { as: manager, body: { status: 'paid' } })
    assertStatus(again, 422)
    assert.equal(again.body.code, 'invalid_status_transition')
  })

  it('cannot order products of another tenant', async () => {
    const foreign = await createProduct(await createTenant('marketplace'), { stock: 10 })
    assertValidationErrors(
      await api('POST', '/api/v1/marketplace/orders', { as: sales, body: { customer_name: 'Jane', items: [{ product_id: foreign.id, quantity: 1 }] } }),
      ['items.0.product_id']
    )
    assert.equal((await fresh('products', foreign.id)).stock, 10)
  })

  it('refuses orders mixing currencies', async () => {
    const dollars = await createProduct(shop, { currency: 'USD', stock: 3 })
    const response = await api('POST', '/api/v1/marketplace/orders', {
      as: sales,
      body: { customer_name: 'Jane', items: [{ product_id: product.id, quantity: 1 }, { product_id: dollars.id, quantity: 1 }] }
    })
    assertStatus(response, 422)
    assert.equal(response.body.code, 'mixed_currencies')
  })

  it('summarises the shop on the dashboard and ranks best sellers', async () => {
    await api('POST', '/api/v1/marketplace/orders', { as: sales, body: { customer_name: 'Jane', items: [{ product_id: product.id, quantity: 2 }] } })

    const dashboard = await api('GET', '/api/v1/marketplace/dashboard', { as: manager })
    assertStatus(dashboard, 200)
    assert.equal(dashboard.body.data.stats.products, 1)
    assert.equal(dashboard.body.data.stats.units_in_stock, 3)
    assert.equal(dashboard.body.data.stats.orders_today, 1)
    assert.equal(dashboard.body.data.stats.pending_orders, 1)
    assert.equal(dashboard.body.data.stats.revenue_cents, 0)
    assert.equal(dashboard.body.data.recent_orders[0].items_count, 1)

    const top = await api('GET', '/api/v1/marketplace/insights/top-products', { as: manager })
    assertStatus(top, 200)
    assert.deepEqual(top.body.data, [{ name: product.name, units: 2, revenue_cents: 2500 }])
    // Insights need marketing.view
    assertStatus(await api('GET', '/api/v1/marketplace/insights/top-products', { as: sales }), 403)
  })
})
