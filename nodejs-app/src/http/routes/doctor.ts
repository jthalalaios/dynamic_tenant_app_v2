import type { FastifyInstance, FastifyRequest } from 'fastify'
import { sql } from 'kysely'
import { config } from '../../config/index.ts'
import { db } from '../../db/database.ts'
import type { Appointment, Patient } from '../../db/schema.ts'
import { APPOINTMENT_REASONS, APPOINTMENT_STATUSES, type AppointmentStatus } from '../../domain/enums.ts'
import { checkIn, transition } from '../../services/doctor/appointments.ts'
import { currentSession, goOffline, goOnline, heartbeat } from '../../services/doctor/presence.ts'
import { fromUserTimezone, requireTenant, toUserTimezone, userTimezone, type Ctx } from '../../support/context.ts'
import { dayRange, dayRangeOf, startOfWindow, subMinutes } from '../../support/time.ts'
import { actor, body, created, idParam, noContent, orNotFound, query, searchTerm } from '../helpers.ts'
import { featureGuards, online, permission, tenantType } from '../middleware.ts'
import { paginate } from '../pagination.ts'
import { appointmentResource, patientResource, presenceResource } from '../resources.ts'
import {
  beforeOrEqualToday,
  date,
  dateYmd,
  email,
  exists,
  integer,
  max,
  min,
  nullable,
  oneOf,
  required,
  sometimes,
  string,
  validate
} from '../validation.ts'

type Relation = 'patient' | 'doctor' | 'checkedInBy'
const ALL: Relation[] = ['patient', 'doctor', 'checkedInBy']

/** Appointments with the requested relations (patients include soft-deleted ones) */
async function serializeAppointments(ctx: Ctx, rows: Appointment[], relations: Relation[] = ALL) {
  const patientIds = [...new Set(rows.map((r) => r.patient_id))]
  const userIds = [...new Set(rows.flatMap((r) => [r.doctor_id, r.checked_in_by]).filter((id): id is number => id !== null))]

  const [patients, users] = await Promise.all([
    relations.includes('patient') && patientIds.length
      ? db().selectFrom('patients').selectAll().where('id', 'in', patientIds).execute()
      : Promise.resolve([] as Patient[]),
    userIds.length ? db().selectFrom('users').select(['id', 'name']).where('id', 'in', userIds).execute() : Promise.resolve([])
  ])
  const patientById = new Map(patients.map((p) => [p.id, p]))
  const userById = new Map(users.map((u) => [u.id, u]))

  return rows.map((row) =>
    appointmentResource(ctx, row, {
      ...(relations.includes('patient') ? { patient: patientById.get(row.patient_id) ?? null } : {}),
      ...(relations.includes('doctor') ? { doctor: row.doctor_id !== null ? userById.get(row.doctor_id) ?? null : null } : {}),
      ...(relations.includes('checkedInBy') ? { checkedInBy: row.checked_in_by !== null ? userById.get(row.checked_in_by) ?? null : null } : {})
    })
  )
}

async function oneAppointment(ctx: Ctx, row: Appointment, relations: Relation[] = ALL) {
  return (await serializeAppointments(ctx, [row], relations))[0]
}

function appointments(ctx: Ctx) {
  return db().selectFrom('appointments').selectAll().where('tenant_id', '=', requireTenant(ctx).id).where('deleted_at', 'is', null)
}

async function findAppointment(request: FastifyRequest): Promise<Appointment> {
  return orNotFound(request.ctx, await appointments(request.ctx).where('id', '=', idParam(request, 'appointment')).executeTakeFirst())
}

function patients(ctx: Ctx) {
  return db().selectFrom('patients').selectAll().where('tenant_id', '=', requireTenant(ctx).id).where('deleted_at', 'is', null)
}

async function findPatient(request: FastifyRequest): Promise<Patient> {
  return orNotFound(request.ctx, await patients(request.ctx).where('id', '=', idParam(request, 'patient')).executeTakeFirst())
}

function liveSessions(ctx: Ctx) {
  return db()
    .selectFrom('presence_sessions')
    .where('presence_sessions.tenant_id', '=', requireTenant(ctx).id)
    .where('presence_sessions.ended_at', 'is', null)
    .where('presence_sessions.last_heartbeat_at', '>=', subMinutes(new Date(), config.tenancy.presence.timeoutMinutes))
}

function patientRules(creating: boolean) {
  const req = creating ? required : sometimes
  return {
    first_name: [req, string, max(80)],
    last_name: [req, string, max(80)],
    email: [sometimes, nullable, email, max(255)],
    phone: [sometimes, nullable, string, max(32)],
    date_of_birth: [sometimes, nullable, date, beforeOrEqualToday],
    gender: [sometimes, nullable, oneOf(['female', 'male', 'other'])],
    notes: [sometimes, nullable, string, max(5000)]
  }
}

function patientPayload(data: Record<string, any>) {
  const payload = { ...data }
  // Stored as a calendar date
  if (typeof payload.date_of_birth === 'string') {
    const parsed = new Date(payload.date_of_birth.length === 10 ? `${payload.date_of_birth}T00:00:00Z` : payload.date_of_birth)
    payload.date_of_birth = Number.isNaN(parsed.getTime()) ? payload.date_of_birth : parsed.toISOString().slice(0, 10)
  }
  return payload
}

function appointmentRules(ctx: Ctx, creating: boolean) {
  const tenantId = requireTenant(ctx).id
  const req = creating ? required : sometimes
  return {
    patient_id: [req, integer, exists('patients', 'id', (q) => q.where('tenant_id', '=', tenantId).where('deleted_at', 'is', null))],
    doctor_id: [sometimes, nullable, integer, exists('users', 'id', (q) => q.where('tenant_id', '=', tenantId))],
    // Wall time in the viewer's timezone (or ISO-8601 with an offset)
    scheduled_at: [req, date],
    duration_minutes: [sometimes, integer, min(5), max(480)],
    reason: [req, oneOf(APPOINTMENT_REASONS)],
    notes: [sometimes, nullable, string, max(5000)]
  }
}

function appointmentPayload(ctx: Ctx, data: Record<string, any>) {
  const payload = { ...data }
  if (typeof payload.scheduled_at === 'string') payload.scheduled_at = fromUserTimezone(ctx, payload.scheduled_at)
  return payload
}

export async function doctorRoutes(app: FastifyInstance): Promise<void> {
  const base = [...featureGuards, tenantType('doctor')]

  /** Today's (viewer-local) clinic overview and visitor queue */
  app.get('/doctor/dashboard', { preHandler: [...base, permission('appointments.view')] }, async (request) => {
    const ctx = request.ctx
    const [from, to] = dayRange(userTimezone(ctx))
    const today = await appointments(ctx).where('scheduled_at', '>=', from).where('scheduled_at', '<=', to).orderBy('scheduled_at').orderBy('id').execute()
    const count = (...statuses: AppointmentStatus[]) => today.filter((a) => statuses.includes(a.status as AppointmentStatus)).length

    const [patientCount, staffOnline] = await Promise.all([
      db().selectFrom('patients').select((eb) => eb.fn.countAll<number>().as('c')).where('tenant_id', '=', requireTenant(ctx).id).where('deleted_at', 'is', null).executeTakeFirst(),
      liveSessions(ctx).select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst()
    ])

    return {
      data: {
        stats: {
          scheduled: today.length,
          waiting: count('scheduled'),
          checked_in: count('checked_in', 'in_progress'),
          completed: count('completed'),
          patients: Number(patientCount?.c ?? 0),
          staff_online: Number(staffOnline?.c ?? 0)
        },
        queue: await serializeAppointments(ctx, today)
      }
    }
  })

  /** Appointment breakdown by status and reason over the last N days */
  app.get('/doctor/reports/summary', { preHandler: [...base, permission('reports.view')] }, async (request) => {
    const ctx = request.ctx
    const raw = query(request).days
    const parsed = raw === undefined || raw === null ? 30 : Number.parseInt(String(raw), 10)
    const days = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 0, 365))
    const from = startOfWindow(userTimezone(ctx), days)

    const window = () => appointments(ctx).where('scheduled_at', '>=', from)
    const breakdown = async (column: 'status' | 'reason') =>
      (
        await db()
          .selectFrom('appointments')
          .select([sql<string>`${sql.ref(column)}`.as('label'), (eb) => eb.fn.countAll<number>().as('total')])
          .where('tenant_id', '=', requireTenant(ctx).id)
          .where('deleted_at', 'is', null)
          .where('scheduled_at', '>=', from)
          .groupBy(column)
          .orderBy('total', 'desc')
          .orderBy(column)
          .execute()
      ).map((row) => ({ label: row.label, total: Number(row.total) }))

    const total = await window().clearSelect().select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst()

    return {
      data: {
        days,
        total: Number(total?.c ?? 0),
        by_status: await breakdown('status'),
        by_reason: await breakdown('reason')
      }
    }
  })

  // -------------------------------------------------------------------- presence

  const presence = [...base, permission('presence.toggle')]

  app.get('/doctor/presence', { preHandler: presence }, async (request) => ({
    data: presenceResource(request.ctx, await currentSession(actor(request).user))
  }))

  // 200 even when a new session row was created: the client toggles a state, it does not create a resource
  app.post('/doctor/presence/online', { preHandler: presence }, async (request) => ({
    data: presenceResource(request.ctx, await goOnline(actor(request).user))
  }))

  app.post('/doctor/presence/heartbeat', { preHandler: presence }, async (request) => ({
    data: presenceResource(request.ctx, await heartbeat(actor(request).user))
  }))

  app.post('/doctor/presence/offline', { preHandler: presence }, async (request) => {
    await goOffline(actor(request).user)
    return { data: presenceResource(request.ctx, null) }
  })

  /** Staff currently online in this clinic */
  app.get('/doctor/presence/team', { preHandler: [...base, permission('appointments.view')] }, async (request) => {
    const ctx = request.ctx
    const sessions = await liveSessions(ctx)
      .leftJoin('users', 'users.id', 'presence_sessions.user_id')
      .select(['presence_sessions.started_at', 'users.id as user_id', 'users.name as user_name'])
      .orderBy('presence_sessions.started_at')
      .execute()

    return {
      data: sessions.map((s) => ({
        user: s.user_id !== null && s.user_name !== null ? { id: s.user_id, name: s.user_name } : null,
        since: toUserTimezone(ctx, s.started_at)
      }))
    }
  })

  // -------------------------------------------------------------------- patients

  app.get('/doctor/patients', { preHandler: [...base, permission('patients.view')] }, async (request) => {
    const ctx = request.ctx
    const term = searchTerm(request)
    let q = patients(ctx)
    if (term) {
      const like = `%${term}%`
      q = q.where((eb) => eb.or([eb('first_name', 'ilike', like), eb('last_name', 'ilike', like), eb('email', 'ilike', like), eb('phone', 'ilike', like)]))
    }
    return paginate(request, q.orderBy('last_name').orderBy('first_name').orderBy('id'), (rows) => rows.map((p) => patientResource(ctx, p)))
  })

  app.post('/doctor/patients', { preHandler: [...base, permission('patients.create')] }, async (request, reply) => {
    const ctx = request.ctx
    const data = patientPayload(await validate(ctx, body(request), patientRules(true)))
    const patient = await db()
      .insertInto('patients')
      .values({ ...(data as { first_name: string; last_name: string }), tenant_id: requireTenant(ctx).id })
      .returningAll()
      .executeTakeFirstOrThrow()
    return created(reply, { data: patientResource(ctx, patient) })
  })

  app.get('/doctor/patients/:patient', { preHandler: [...base, permission('patients.view')] }, async (request) => ({
    data: patientResource(request.ctx, await findPatient(request))
  }))

  const updatePatient = async (request: FastifyRequest) => {
    const ctx = request.ctx
    const patient = await findPatient(request)
    const data = patientPayload(await validate(ctx, body(request), patientRules(false)))
    const updated = await db().updateTable('patients').set({ ...data, updated_at: new Date() }).where('id', '=', patient.id).returningAll().executeTakeFirstOrThrow()
    return { data: patientResource(ctx, updated) }
  }
  app.patch('/doctor/patients/:patient', { preHandler: [...base, permission('patients.update')] }, updatePatient)
  app.put('/doctor/patients/:patient', { preHandler: [...base, permission('patients.update')] }, updatePatient)

  app.delete('/doctor/patients/:patient', { preHandler: [...base, permission('patients.delete')] }, async (request, reply) => {
    const patient = await findPatient(request)
    await db().updateTable('patients').set({ deleted_at: new Date(), updated_at: new Date() }).where('id', '=', patient.id).execute()
    return noContent(reply)
  })

  // ---------------------------------------------------------------- appointments

  app.get('/doctor/appointments', { preHandler: [...base, permission('appointments.view')] }, async (request) => {
    const ctx = request.ctx
    const filters = await validate(ctx, query(request), {
      date: [nullable, dateYmd],
      status: [nullable, oneOf(APPOINTMENT_STATUSES)],
      patient_id: [nullable, integer]
    })

    let q = appointments(ctx)
    if (filters.date) {
      // A calendar day in the viewer's timezone, translated to a UTC range
      const range = dayRangeOf(filters.date, userTimezone(ctx))
      if (range) q = q.where('scheduled_at', '>=', range[0]).where('scheduled_at', '<=', range[1])
    }
    if (filters.status) q = q.where('status', '=', filters.status)
    if (filters.patient_id !== undefined && filters.patient_id !== null) q = q.where('patient_id', '=', filters.patient_id)

    return paginate(request, q.orderBy('scheduled_at').orderBy('id'), (rows) => serializeAppointments(ctx, rows))
  })

  app.post('/doctor/appointments', { preHandler: [...base, permission('appointments.create')] }, async (request, reply) => {
    const ctx = request.ctx
    const data = appointmentPayload(ctx, await validate(ctx, body(request), appointmentRules(ctx, true)))
    const appointment = await db()
      .insertInto('appointments')
      .values({ ...(data as { patient_id: number; scheduled_at: Date; reason: Appointment['reason'] }), tenant_id: requireTenant(ctx).id })
      .returningAll()
      .executeTakeFirstOrThrow()
    return created(reply, { data: await oneAppointment(ctx, appointment, ['patient', 'doctor']) })
  })

  app.get('/doctor/appointments/:appointment', { preHandler: [...base, permission('appointments.view')] }, async (request) => ({
    data: await oneAppointment(request.ctx, await findAppointment(request))
  }))

  const updateAppointment = async (request: FastifyRequest) => {
    const ctx = request.ctx
    const appointment = await findAppointment(request)
    const data = appointmentPayload(ctx, await validate(ctx, body(request), appointmentRules(ctx, false)))
    const updated = await db().updateTable('appointments').set({ ...data, updated_at: new Date() }).where('id', '=', appointment.id).returningAll().executeTakeFirstOrThrow()
    return { data: await oneAppointment(ctx, updated) }
  }
  app.patch('/doctor/appointments/:appointment', { preHandler: [...base, permission('appointments.update')] }, updateAppointment)
  app.put('/doctor/appointments/:appointment', { preHandler: [...base, permission('appointments.update')] }, updateAppointment)

  app.delete('/doctor/appointments/:appointment', { preHandler: [...base, permission('appointments.delete')] }, async (request, reply) => {
    const appointment = await findAppointment(request)
    await db().updateTable('appointments').set({ deleted_at: new Date(), updated_at: new Date() }).where('id', '=', appointment.id).execute()
    return noContent(reply)
  })

  /** Check the patient in. Requires appointments.check-in and an online presence session */
  app.post(
    '/doctor/appointments/:appointment/check-in',
    { preHandler: [...base, permission('appointments.check-in'), online] },
    async (request) => {
      const ctx = request.ctx
      const appointment = await findAppointment(request)
      return { data: await oneAppointment(ctx, await checkIn(ctx, appointment, actor(request).user)) }
    }
  )

  app.patch('/doctor/appointments/:appointment/status', { preHandler: [...base, permission('appointments.update')] }, async (request) => {
    const ctx = request.ctx
    const appointment = await findAppointment(request)
    const data = await validate(ctx, body(request), {
      status: [required, oneOf(APPOINTMENT_STATUSES.filter((s) => s !== 'scheduled'))]
    })
    return { data: await oneAppointment(ctx, await transition(ctx, appointment, data.status, actor(request).user)) }
  })
}
