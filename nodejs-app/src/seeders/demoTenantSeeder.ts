import { DateTime } from 'luxon'
import { syncRoles } from '../authorization/acl.ts'
import { provisionTenantRoles } from '../authorization/permissionSynchronizer.ts'
import { db } from '../db/database.ts'
import type { Tenant, User } from '../db/schema.ts'
import { APPOINTMENT_REASONS, type TenantType } from '../domain/enums.ts'
import { placeOrder } from '../services/marketplace/orders.ts'
import { tenantContext } from '../support/context.ts'
import { hashPassword } from '../support/hash.ts'
import { runChatDemoSeeder } from './chatDemoSeeder.ts'

/**
 * Demo clinic + demo shop. Every account's password is "password". Idempotent.
 */
const PATIENTS: [first: string, last: string, gender: string, born: string][] = [
  ['Eleni', 'Papadopoulou', 'female', '1984-03-12'],
  ['Nikos', 'Georgiou', 'male', '1979-11-02'],
  ['Maria', 'Konstantinou', 'female', '1992-07-25'],
  ['Giorgos', 'Dimitriou', 'male', '1965-01-18'],
  ['Sofia', 'Ioannou', 'female', '2001-09-09'],
  ['Andreas', 'Nikolaou', 'male', '1988-05-30'],
  ['Katerina', 'Vasileiou', 'female', '1973-12-14'],
  ['Petros', 'Christou', 'male', '1996-04-03'],
  ['Anna', 'Michailidou', 'female', '1959-08-21'],
  ['Kostas', 'Pappas', 'male', '2010-02-27'],
  ['Ioanna', 'Athanasiou', 'female', '1990-10-05'],
  ['Alex', 'Karras', 'other', '1985-06-16']
]

const CATALOGUE: [sku: string, name: string, category: string, priceCents: number, stock: number][] = [
  ['AUR-001', 'Aurora Headphones', 'audio', 12900, 24],
  ['PUL-002', 'Pulse Smartwatch', 'wearables', 19900, 6],
  ['NIM-003', 'Nimbus Desk Lamp', 'home', 4900, 41],
  ['VOY-004', 'Voyager Backpack', 'accessories', 8900, 0],
  ['ECH-005', 'Echo Bluetooth Speaker', 'audio', 7900, 15],
  ['ORB-006', 'Orbit Fitness Band', 'wearables', 5900, 32]
]

async function tenant(name: string, slug: string, type: TenantType, timezone: string): Promise<Tenant> {
  await db().insertInto('tenants').values({ name, slug, type, timezone, locale: 'en' }).onConflict((oc) => oc.column('slug').doNothing()).execute()
  const row = await db().selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirstOrThrow()
  await provisionTenantRoles(row)
  return row
}

async function user(owner: Tenant, name: string, email: string, roles: string[], password: string): Promise<User> {
  await db()
    .insertInto('users')
    .values({ tenant_id: owner.id, name, email, password, email_verified_at: new Date() })
    .onConflict((oc) => oc.column('email').doNothing())
    .execute()
  const row = await db().selectFrom('users').selectAll().where('email', '=', email).executeTakeFirstOrThrow()

  const roleIds = (await db().selectFrom('roles').select('id').where('tenant_id', '=', owner.id).where('slug', 'in', roles).execute()).map((r) => r.id)
  await syncRoles(db(), row, roleIds)

  return row
}

async function seedClinic(clinic: Tenant, doctor: User): Promise<void> {
  const existing = await db().selectFrom('patients').select('id').where('tenant_id', '=', clinic.id).executeTakeFirst()
  if (existing) return

  const patients = await db()
    .insertInto('patients')
    .values(
      PATIENTS.map(([first_name, last_name, gender, date_of_birth], i) => ({
        tenant_id: clinic.id,
        first_name,
        last_name,
        gender,
        date_of_birth,
        email: i % 3 === 0 ? null : `${first_name.toLowerCase()}.${last_name.toLowerCase()}@example.com`,
        phone: i % 4 === 0 ? null : `+30694${String(1_000_000 + i * 7919).slice(-7)}`
      }))
    )
    .returningAll()
    .execute()

  // Today from 09:00 clinic time, every 30 minutes; the first two are already done
  const startOfDay = DateTime.now().setZone(clinic.timezone).set({ hour: 9, minute: 0, second: 0, millisecond: 0 })

  await db()
    .insertInto('appointments')
    .values(
      patients.slice(0, 8).map((patient, i) => ({
        tenant_id: clinic.id,
        patient_id: patient.id,
        doctor_id: doctor.id,
        scheduled_at: startOfDay.plus({ minutes: 30 * i }).toJSDate(),
        duration_minutes: 30,
        reason: APPOINTMENT_REASONS[i % APPOINTMENT_REASONS.length],
        status: i < 2 ? 'completed' : 'scheduled'
      }))
    )
    .execute()
}

async function seedShop(shop: Tenant, manager: User): Promise<void> {
  const existing = await db().selectFrom('products').select('id').where('tenant_id', '=', shop.id).executeTakeFirst()
  if (existing) return

  const products = await db()
    .insertInto('products')
    .values(
      CATALOGUE.map(([sku, name, category, price_cents, stock]) => ({ tenant_id: shop.id, sku, name, category, price_cents, stock, currency: 'EUR' }))
    )
    .returningAll()
    .execute()
  const bySku = new Map(products.map((p) => [p.sku, p]))

  await placeOrder(
    tenantContext(shop),
    {
      customer_name: 'Jane Customer',
      customer_email: 'jane@example.com',
      items: [
        { product_id: bySku.get('AUR-001')!.id, quantity: 1 },
        { product_id: bySku.get('NIM-003')!.id, quantity: 2 }
      ]
    },
    manager
  )
}

export async function runDemoTenantSeeder(): Promise<void> {
  const password = await hashPassword('password')

  const clinic = await tenant('Acme Clinic', 'acme-clinic', 'doctor', 'Europe/Athens')
  // A doctor who is also an administrator, a doctor who is not, and front desk staff
  await user(clinic, 'Dr. Alice Admin', 'admin@clinic.test', ['admin', 'doctor'], password)
  const doctor = await user(clinic, 'Dr. Bob House', 'doctor@clinic.test', ['doctor'], password)
  await user(clinic, 'Rita Reception', 'reception@clinic.test', ['receptionist'], password)
  await seedClinic(clinic, doctor)

  const shop = await tenant('Acme Market', 'acme-market', 'marketplace', 'Europe/Athens')
  await user(shop, 'Mia Admin', 'admin@market.test', ['admin'], password)
  const manager = await user(shop, 'Max Manager', 'manager@market.test', ['manager'], password)
  await user(shop, 'Sam Sales', 'sales@market.test', ['sales'], password)
  await seedShop(shop, manager)

  await runChatDemoSeeder()
}
