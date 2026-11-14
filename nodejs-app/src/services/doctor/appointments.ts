import { db, type Executor } from '../../db/database.ts'
import type { Appointment, User } from '../../db/schema.ts'
import { appointmentCanTransition, type AppointmentStatus } from '../../domain/enums.ts'
import { requireTenant, t, type Ctx } from '../../support/context.ts'
import { BusinessRuleError, NotFoundError } from '../../support/errors.ts'
import { isOnline } from './presence.ts'

/**
 * Appointment state machine. Check-in requires the acting user to be online,
 * enforced here as well as by route middleware so the rule holds for every caller.
 */
async function lockAppointment(ctx: Ctx, trx: Executor, id: number): Promise<Appointment> {
  const appointment = await trx
    .selectFrom('appointments')
    .selectAll()
    .where('id', '=', id)
    .where('tenant_id', '=', requireTenant(ctx).id)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .executeTakeFirst()

  if (!appointment) throw new NotFoundError(t(ctx, 'messages.not_found'))
  return appointment
}

function assertTransition(ctx: Ctx, appointment: Appointment, next: AppointmentStatus): void {
  if (!appointmentCanTransition(appointment.status as AppointmentStatus, next)) {
    throw new BusinessRuleError(
      t(ctx, 'messages.invalid_transition', { from: appointment.status, to: next }),
      'invalid_status_transition',
      422
    )
  }
}

export async function checkIn(ctx: Ctx, appointment: Appointment, actor: User): Promise<Appointment> {
  if (!(await isOnline(actor))) {
    throw new BusinessRuleError(t(ctx, 'messages.must_be_online'), 'user_offline')
  }

  return db()
    .transaction()
    .execute(async (trx) => {
      const locked = await lockAppointment(ctx, trx, appointment.id)
      assertTransition(ctx, locked, 'checked_in')

      const now = new Date()
      return trx
        .updateTable('appointments')
        .set({ status: 'checked_in', checked_in_at: now, checked_in_by: actor.id, updated_at: now })
        .where('id', '=', locked.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    })
}

export async function transition(ctx: Ctx, appointment: Appointment, next: AppointmentStatus, actor: User): Promise<Appointment> {
  if (next === 'checked_in') return checkIn(ctx, appointment, actor)

  return db()
    .transaction()
    .execute(async (trx) => {
      const locked = await lockAppointment(ctx, trx, appointment.id)
      assertTransition(ctx, locked, next)

      const now = new Date()
      return trx
        .updateTable('appointments')
        .set({ status: next, completed_at: next === 'completed' ? now : locked.completed_at, updated_at: now })
        .where('id', '=', locked.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    })
}
