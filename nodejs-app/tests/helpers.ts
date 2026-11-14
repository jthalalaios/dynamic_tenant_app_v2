import { after, afterEach, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Kysely, PGliteDialect, sql } from 'kysely'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.ts'
import { syncRoles } from '../src/authorization/acl.ts'
import { provisionTenantRoles, syncPermissions } from '../src/authorization/permissionSynchronizer.ts'
import { config, resetConfig } from '../src/config/index.ts'
import { setDatabase, type Database } from '../src/db/database.ts'
import { migrateToLatest } from '../src/db/migrator.ts'
import type { DB, Patient, Product, Tenant, User } from '../src/db/schema.ts'
import type { TenantType } from '../src/domain/enums.ts'
import { ArrayMailer, setMailer } from '../src/mail/mailer.ts'
import { ArrayBroadcaster, setBroadcaster } from '../src/realtime/broadcaster.ts'
import { issueToken } from '../src/services/auth/tokens.ts'
import { MemoryCache, setCache } from '../src/support/cache.ts'
import { hashPassword } from '../src/support/hash.ts'
import { MemoryRateLimitStore, setRateLimitStore } from '../src/support/rateLimiter.ts'
import { randomString } from '../src/support/strings.ts'

/**
 * Feature test harness (the port of tests/TestCase.php + Pest's RefreshDatabase).
 *
 * Every test file gets an in-process PostgreSQL (PGlite), migrated once and
 * truncated before each test, so the suite never touches a real database. Mail,
 * broadcasts, the cache and rate limits are in-memory fakes.
 */
export const mail = new ArrayMailer()
export const broadcasts = new ArrayBroadcaster()

let pglite: PGlite
let database: Database
let app: FastifyInstance
let passwordHash: string

function applyTestConfig(): void {
  resetConfig()
  config.app.env = 'testing'
  config.app.key = 'base64:dGVzdC1rZXktZm9yLXRoZS1ub2RlanMtYXBpLXN1aXRlISE='
  config.app.bcryptRounds = 4
  config.app.frontendUrl = 'http://localhost:5273'
  config.app.trustedProxies = []
  config.cacheStore = 'memory'
  config.broadcast = 'null'
  config.mail.mailer = 'array'
  config.mail.fromAddress = 'hello@example.com'
  config.tenancy.themes.enabled = []
  config.tenancy.themes.frontendUrls = { doctor: '', marketplace: '' }
  config.tenancy.auth.verifyEmail = true
}

const TABLES = [
  'chat_room_reads', 'chat_mutes', 'chat_messages', 'chat_room_role', 'chat_rooms',
  'order_items', 'orders', 'products', 'presence_sessions', 'appointments', 'patients',
  'role_user', 'permission_role', 'roles', 'permissions', 'access_tokens',
  'password_reset_tokens', 'users', 'tenants'
]

/** Call once at the top of every test file */
export function useTestApp(): { app: () => FastifyInstance; db: () => Database } {
  before(async () => {
    applyTestConfig()
    pglite = new PGlite({
      // Same JS types as the pg driver in production
      parsers: { 1082: (v: string) => v, 1700: (v: string) => Number(v), 20: (v: string) => Number.parseInt(v, 10) }
    })
    database = new Kysely<DB>({ dialect: new PGliteDialect({ pglite }) })
    setDatabase(database)
    await migrateToLatest(database)
    passwordHash = await hashPassword('password')
    app = await buildApp({ logger: false })
  })

  beforeEach(async () => {
    applyTestConfig()
    await sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`).execute(database)
    setCache(new MemoryCache())
    setRateLimitStore(new MemoryRateLimitStore())
    mail.clear()
    setMailer(mail)
    broadcasts.clear()
    setBroadcaster(broadcasts)
  })

  afterEach(() => {
    setMailer(mail)
  })

  after(async () => {
    await app?.close()
    await database?.destroy()
    setDatabase(null)
  })

  return { app: () => app, db: () => database }
}

// ------------------------------------------------------------------ factories

/** Tenant with its system roles provisioned (permissions synced first) */
export async function createTenant(type: TenantType = 'doctor', attributes: Partial<Tenant> = {}): Promise<Tenant> {
  await syncPermissions(database)
  const name = attributes.name ?? `Tenant ${randomString(6)}`
  const tenant = await database
    .insertInto('tenants')
    .values({
      name,
      slug: attributes.slug ?? `tenant-${randomString(8).toLowerCase()}`,
      type,
      timezone: attributes.timezone ?? 'UTC',
      locale: attributes.locale ?? 'en',
      is_active: attributes.is_active ?? true
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  await provisionTenantRoles(tenant, database)
  return tenant
}

export async function createUser(tenant: Tenant, roles: string[] = [], attributes: Partial<User> = {}): Promise<User> {
  const user = await database
    .insertInto('users')
    .values({
      tenant_id: tenant.id,
      name: attributes.name ?? `User ${randomString(5)}`,
      email: attributes.email ?? `user-${randomString(10).toLowerCase()}@example.com`,
      password: passwordHash,
      email_verified_at: attributes.email_verified_at === undefined ? new Date() : attributes.email_verified_at,
      is_active: attributes.is_active ?? true,
      timezone: attributes.timezone ?? null,
      locale: attributes.locale ?? null
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  if (roles.length) {
    const ids = (await database.selectFrom('roles').select('id').where('tenant_id', '=', tenant.id).where('slug', 'in', roles).execute()).map((r) => r.id)
    await syncRoles(database, user, ids)
  }

  return user
}

export async function createPatient(tenant: Tenant, attributes: Partial<Patient> = {}): Promise<Patient> {
  return database
    .insertInto('patients')
    .values({
      tenant_id: tenant.id,
      first_name: attributes.first_name ?? `First${randomString(4)}`,
      last_name: attributes.last_name ?? `Last${randomString(4)}`,
      gender: attributes.gender ?? 'other',
      date_of_birth: attributes.date_of_birth ?? '1990-01-01'
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function createAppointment(tenant: Tenant, patient: Patient, attributes: { scheduled_at?: Date } = {}) {
  return database
    .insertInto('appointments')
    .values({
      tenant_id: tenant.id,
      patient_id: patient.id,
      scheduled_at: attributes.scheduled_at ?? new Date(Date.now() + 3600_000),
      duration_minutes: 30,
      reason: 'consultation',
      status: 'scheduled'
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function createProduct(tenant: Tenant, attributes: Partial<Product> = {}): Promise<Product> {
  return database
    .insertInto('products')
    .values({
      tenant_id: tenant.id,
      sku: attributes.sku ?? `SKU-${randomString(8)}`,
      name: attributes.name ?? `Product ${randomString(4)}`,
      category: attributes.category ?? 'audio',
      price_cents: attributes.price_cents ?? 1000,
      currency: attributes.currency ?? 'EUR',
      stock: attributes.stock ?? 10,
      is_active: attributes.is_active ?? true
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function roleId(tenant: Tenant, slug: string): Promise<number> {
  const role = await database.selectFrom('roles').select('id').where('tenant_id', '=', tenant.id).where('slug', '=', slug).executeTakeFirstOrThrow()
  return role.id
}

export async function fresh<T extends keyof DB>(table: T, id: number) {
  return database.selectFrom(table as any).selectAll().where('id' as any, '=', id).executeTakeFirst() as Promise<any>
}

// ----------------------------------------------------------------------- HTTP

export interface TestResponse {
  status: number
  headers: Record<string, string | number | string[] | undefined>
  body: any
}

export interface RequestOptions {
  /** Authenticate as this user (a real, freshly issued token) */
  as?: User
  token?: string
  body?: unknown
  headers?: Record<string, string>
}

export async function api(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, options: RequestOptions = {}): Promise<TestResponse> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers }
  const token = options.token ?? (options.as ? (await issueToken(options.as)).accessToken : undefined)
  if (token) headers.authorization = `Bearer ${token}`

  const response = await app.inject({
    method,
    url,
    headers,
    ...(options.body !== undefined ? { payload: options.body as Record<string, unknown> } : {})
  })

  let body: any = null
  if (response.body) {
    try {
      body = JSON.parse(response.body)
    } catch {
      body = response.body
    }
  }

  return { status: response.statusCode, headers: response.headers, body }
}

/** `path` like "data.0.slug" */
export function at(body: unknown, path: string): any {
  return path.split('.').reduce<any>((node, key) => (node === null || node === undefined ? undefined : node[key]), body)
}

export function assertStatus(response: TestResponse, status: number): void {
  assert.equal(response.status, status, `Expected HTTP ${status}, got ${response.status}: ${JSON.stringify(response.body)}`)
}

/** 422 with errors on these fields (and, optionally, these exact first messages) */
export function assertValidationErrors(response: TestResponse, fields: string[] | Record<string, string>): void {
  assertStatus(response, 422)
  const expected = Array.isArray(fields) ? Object.fromEntries(fields.map((f) => [f, null])) : fields
  for (const [field, message] of Object.entries(expected)) {
    assert.ok(response.body?.errors?.[field], `Expected a validation error on "${field}", got ${JSON.stringify(response.body?.errors)}`)
    if (message !== null) assert.equal(response.body.errors[field][0], message)
  }
}
