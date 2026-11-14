/**
 * Domain enums with their state machines (the port of app/Enums).
 *
 * Plain `as const` values instead of TypeScript `enum`: Node runs these sources
 * directly and only strips types, so syntax has to be erasable.
 */

export const TENANT_TYPES = ['doctor', 'marketplace'] as const
export type TenantType = (typeof TENANT_TYPES)[number]

export function isTenantType(value: unknown): value is TenantType {
  return typeof value === 'string' && (TENANT_TYPES as readonly string[]).includes(value)
}

/** Permission scopes a tenant of this type may grant */
export function permissionScopes(type: TenantType): string[] {
  return ['common', type]
}

export const APPOINTMENT_REASONS = ['consultation', 'follow_up', 'new_patient', 'exam'] as const
export type AppointmentReason = (typeof APPOINTMENT_REASONS)[number]

export const APPOINTMENT_STATUSES = ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

/** Allowed state machine transitions */
const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: []
}

export function appointmentTransitions(status: AppointmentStatus): AppointmentStatus[] {
  return APPOINTMENT_TRANSITIONS[status] ?? []
}

export function appointmentCanTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return appointmentTransitions(from).includes(to)
}

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: []
}

export function orderTransitions(status: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[status] ?? []
}

export function orderCanTransition(from: OrderStatus, to: OrderStatus): boolean {
  return orderTransitions(from).includes(to)
}

/** Chat room audiences: everyone with chat.view, administrators only, or members of listed roles */
export const CHAT_AUDIENCES = ['everyone', 'admins', 'roles'] as const
export type ChatAudience = (typeof CHAT_AUDIENCES)[number]

/** PrimeIcons (without the `pi-` prefix) a room can be shown with */
export const CHAT_ROOM_ICONS = [
  'comments', 'hashtag', 'megaphone', 'users', 'heart', 'briefcase',
  'bolt', 'star', 'calendar', 'shopping-cart', 'flag', 'globe', 'shield'
] as const

/** Mute lengths a moderator can pick, in minutes (15m, 1h, 24h, 7d); null = until lifted */
export const CHAT_MUTE_DURATIONS = [15, 60, 1440, 10080] as const
