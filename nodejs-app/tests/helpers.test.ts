import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createContext, fromUserTimezone, toUserTimezone, userTimezone } from '../src/support/context.ts'
import { humanizeMinutes, preferredLocale } from '../src/support/i18n.ts'
import { slugify } from '../src/support/strings.ts'
import { api, assertStatus, createTenant, createUser, useTestApp } from './helpers.ts'

useTestApp()

describe('helpers', () => {
  it('converts between UTC storage and the viewer timezone', () => {
    const ctx = createContext()
    const utc = new Date('2026-07-01T09:00:00Z')

    assert.equal(toUserTimezone(ctx, utc, 'Europe/Athens'), '2026-07-01T12:00:00+03:00')
    assert.equal(toUserTimezone(ctx, utc, 'UTC'), '2026-07-01T09:00:00+00:00')
    assert.equal(toUserTimezone(ctx, null), null)
    // Wall time without an offset is read in the viewer's timezone
    assert.equal(fromUserTimezone(ctx, '2026-07-01 12:00', 'Europe/Athens')?.toISOString(), '2026-07-01T09:00:00.000Z')
    // An explicit offset always wins
    assert.equal(fromUserTimezone(ctx, '2026-07-01T12:00:00+00:00', 'Europe/Athens')?.toISOString(), '2026-07-01T12:00:00.000Z')
  })

  it('resolves the timezone by precedence: user, header, tenant, app', async () => {
    const tenant = await createTenant('doctor', { timezone: 'Asia/Tokyo' })
    const user = await createUser(tenant)
    const ctx = createContext()

    assert.equal(userTimezone(ctx, user), 'UTC')
    ctx.tenant = tenant
    assert.equal(userTimezone(ctx, user), 'Asia/Tokyo')
    ctx.clientTimezone = 'America/New_York'
    assert.equal(userTimezone(ctx, user), 'America/New_York')
    assert.equal(userTimezone(ctx, { ...user, timezone: 'Europe/Athens' }), 'Europe/Athens')
  })

  it('reads locale and timezone from request headers', async () => {
    const tenant = await createTenant()
    const user = await createUser(tenant)

    const greek = await api('GET', '/api/v1/auth/me', { as: user, headers: { 'accept-language': 'el-GR,el;q=0.9', 'x-timezone': 'Europe/Athens' } })
    assertStatus(greek, 200)
    assert.equal(greek.headers['content-language'], 'el')
    assert.equal(greek.body.data.preferences.timezone, 'Europe/Athens')

    // Invalid header values are ignored rather than trusted
    const invalid = await api('GET', '/api/v1/auth/me', { as: user, headers: { 'x-timezone': 'Not/AZone' } })
    assert.equal(invalid.body.data.preferences.timezone, tenant.timezone)
  })

  it('negotiates the locale like Accept-Language intends', () => {
    assert.equal(preferredLocale('el-GR,el;q=0.9,en;q=0.8'), 'el')
    assert.equal(preferredLocale('fr-FR,fr;q=0.9,en;q=0.5'), 'en')
    assert.equal(preferredLocale('fr'), 'en')
    assert.equal(preferredLocale(undefined), 'en')
  })

  it('words durations like CarbonInterval::forHumans', () => {
    assert.equal(humanizeMinutes('en', 60), '1 hour')
    assert.equal(humanizeMinutes('en', 1440), '1 day')
    assert.equal(humanizeMinutes('en', 90), '1 hour 30 minutes')
    assert.equal(humanizeMinutes('el', 1440), '1 μέρα')
  })

  it('slugs names like Str::slug', () => {
    assert.equal(slugify('Night shift'), 'night-shift')
    assert.equal(slugify('  Front   desk! '), 'front-desk')
    assert.equal(slugify('Γιατροί'), 'giatroi')
    assert.equal(slugify('!!!'), '')
  })
})
