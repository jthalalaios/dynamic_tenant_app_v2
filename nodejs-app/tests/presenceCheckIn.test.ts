import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../src/config/index.ts'
import type { Appointment, Tenant, User } from '../src/db/schema.ts'
import { TASKS, runTask } from '../src/scheduler.ts'
import { toIso, todayIn } from '../src/support/time.ts'
import { api, assertStatus, createAppointment, createPatient, createTenant, createUser, fresh, useTestApp } from './helpers.ts'

const { db } = useTestApp()

describe('presence and check-in', () => {
  let clinic: Tenant
  let receptionist: User
  let appointment: Appointment

  /** Laravel's travel(): move the user's session `minutes` into the past */
  async function travel(minutes: number) {
    const shift = minutes * 60_000
    const sessions = await db().selectFrom('presence_sessions').selectAll().execute()
    for (const s of sessions) {
      await db()
        .updateTable('presence_sessions')
        .set({
          started_at: new Date(s.started_at.getTime() - shift),
          last_heartbeat_at: new Date(s.last_heartbeat_at.getTime() - shift)
        })
        .where('id', '=', s.id)
        .execute()
    }
  }

  beforeEach(async () => {
    clinic = await createTenant('doctor')
    receptionist = await createUser(clinic, ['receptionist'])
    appointment = await createAppointment(clinic, await createPatient(clinic))
  })

  it('refuses check-in while the user is offline', async () => {
    const response = await api('POST', `/api/v1/doctor/appointments/${appointment.id}/check-in`, { as: receptionist })
    assertStatus(response, 409)
    assert.equal(response.body.code, 'user_offline')
    assert.equal((await fresh('appointments', appointment.id)).status, 'scheduled')
  })

  it('checks a patient in once the user is online', async () => {
    const online = await api('POST', '/api/v1/doctor/presence/online', { as: receptionist })
    assertStatus(online, 200)
    assert.equal(online.body.data.online, true)

    const response = await api('POST', `/api/v1/doctor/appointments/${appointment.id}/check-in`, { as: receptionist })
    assertStatus(response, 200)
    assert.equal(response.body.data.status, 'checked_in')
    assert.equal(response.body.data.checked_in_by.id, receptionist.id)
  })

  it('treats a session without a recent heartbeat as offline', async () => {
    await api('POST', '/api/v1/doctor/presence/online', { as: receptionist })
    await travel(config.tenancy.presence.timeoutMinutes + 1)

    assert.equal((await api('GET', '/api/v1/doctor/presence', { as: receptionist })).body.data.online, false)
    assert.equal((await api('POST', `/api/v1/doctor/appointments/${appointment.id}/check-in`, { as: receptionist })).body.code, 'user_offline')
  })

  it('keeps the session alive with heartbeats and ends it when going offline', async () => {
    await api('POST', '/api/v1/doctor/presence/online', { as: receptionist })
    await travel(config.tenancy.presence.timeoutMinutes - 1)
    assert.equal((await api('POST', '/api/v1/doctor/presence/heartbeat', { as: receptionist })).body.data.online, true)

    await travel(config.tenancy.presence.timeoutMinutes - 1)
    assert.equal((await api('GET', '/api/v1/doctor/presence', { as: receptionist })).body.data.online, true)
    assert.equal((await api('POST', '/api/v1/doctor/presence/offline', { as: receptionist })).body.data.online, false)

    const open = await db().selectFrom('presence_sessions').select('id').where('ended_at', 'is', null).execute()
    assert.equal(open.length, 0)
  })

  it('never opens two sessions for the same user', async () => {
    await api('POST', '/api/v1/doctor/presence/online', { as: receptionist })
    await api('POST', '/api/v1/doctor/presence/online', { as: receptionist })
    const sessions = await db().selectFrom('presence_sessions').select('id').where('user_id', '=', receptionist.id).execute()
    assert.equal(sessions.length, 1)
  })

  it('requires the presence.toggle permission to go online', async () => {
    const clerk = await createUser(clinic)
    assertStatus(await api('POST', '/api/v1/doctor/presence/online', { as: clerk }), 403)
  })

  it('follows the appointment state machine', async () => {
    await api('POST', '/api/v1/doctor/presence/online', { as: receptionist })

    const early = await api('PATCH', `/api/v1/doctor/appointments/${appointment.id}/status`, { as: receptionist, body: { status: 'completed' } })
    assertStatus(early, 422)
    assert.equal(early.body.code, 'invalid_status_transition')

    assertStatus(await api('POST', `/api/v1/doctor/appointments/${appointment.id}/check-in`, { as: receptionist }), 200)
    assert.equal(
      (await api('POST', `/api/v1/doctor/appointments/${appointment.id}/check-in`, { as: receptionist })).body.code,
      'invalid_status_transition'
    )

    const done = await api('PATCH', `/api/v1/doctor/appointments/${appointment.id}/status`, { as: receptionist, body: { status: 'completed' } })
    assertStatus(done, 200)
    assert.equal(done.body.data.status, 'completed')
    assert.deepEqual(done.body.data.allowed_transitions, [])
  })

  it('closes stale sessions from the scheduler task', async () => {
    await api('POST', '/api/v1/doctor/presence/online', { as: receptionist })
    await travel(config.tenancy.presence.timeoutMinutes + 1)

    const result = await runTask(TASKS.find((t) => t.name === 'presence:close-stale')!)
    assert.equal(result, 'Closed 1 stale presence sessions.')

    const session = await db().selectFrom('presence_sessions').selectAll().executeTakeFirstOrThrow()
    assert.notEqual(session.ended_at, null)
    assert.equal(session.ended_at!.getTime(), session.last_heartbeat_at.getTime())
  })

  it("shows today's queue on the dashboard in the viewer's timezone", async (t) => {
    // The fixture appointment (now + 1h) would fall on another local day
    if (todayIn('Europe/Athens') !== todayIn('Europe/Athens', new Date(Date.now() + 3600_000))) {
      t.skip('The fixture appointment would fall on another local day')
      return
    }
    await db().updateTable('users').set({ timezone: 'Europe/Athens' }).where('id', '=', receptionist.id).execute()

    const response = await api('GET', '/api/v1/doctor/dashboard', { as: await fresh('users', receptionist.id) })
    assertStatus(response, 200)
    assert.equal(response.body.data.stats.waiting, 1)
    assert.equal(response.body.data.queue[0].id, appointment.id)
    assert.equal(response.body.data.queue[0].scheduled_at, toIso(appointment.scheduled_at, 'Europe/Athens'))
  })

  it('reports appointments by status and reason', async () => {
    const response = await api('GET', '/api/v1/doctor/reports/summary?days=7', { as: await createUser(clinic, ['doctor']) })
    assertStatus(response, 200)
    assert.equal(response.body.data.days, 7)
    assert.equal(response.body.data.total, 1)
    assert.deepEqual(response.body.data.by_status, [{ label: 'scheduled', total: 1 }])
    assert.deepEqual(response.body.data.by_reason, [{ label: 'consultation', total: 1 }])
  })
})
