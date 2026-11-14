import { acl } from '../authorization/acl.ts'
import { config } from '../config/index.ts'
import type {
  Appointment,
  ChatMessage,
  ChatMute,
  ChatRoom,
  Order,
  OrderItem,
  Patient,
  Permission,
  PresenceSession,
  Product,
  Role,
  Tenant,
  User
} from '../db/schema.ts'
import { appointmentTransitions, orderTransitions, type AppointmentStatus, type OrderStatus } from '../domain/enums.ts'
import { card } from '../services/chat/directory.ts'
import { isLive } from '../services/doctor/presence.ts'
import { mustVerifyEmail } from '../services/auth/users.ts'
import { toUserTimezone, userTimezone, type Ctx } from '../support/context.ts'

/**
 * API resources (the port of app/Http/Resources): the exact JSON the frontend reads.
 * Optional relations follow Laravel's `whenLoaded`: the key is only present when
 * the caller passed the relation in.
 */
type UserRef = { id: number; name: string }

const ref = (user: UserRef | null | undefined) => (user ? { id: user.id, name: user.name } : null)

export function tenantResource(tenant: Tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    timezone: tenant.timezone,
    locale: tenant.locale
  }
}

/** The authenticated user's bootstrap payload: profile, tenant and effective access */
export async function sessionResource(ctx: Ctx, user: User, tenant: Tenant) {
  const access = await acl(user)

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      locale: user.locale,
      last_login_at: toUserTimezone(ctx, user.last_login_at, userTimezone(ctx, user)),
      email_verified_at: toUserTimezone(ctx, user.email_verified_at, userTimezone(ctx, user)),
      // True while the app's features are locked behind email verification
      must_verify_email: mustVerifyEmail(user)
    },
    tenant: tenantResource(tenant),
    access: {
      is_admin: access.is_admin,
      roles: access.roles,
      permissions: access.permissions
    },
    preferences: {
      timezone: userTimezone(ctx, user),
      locale: ctx.locale
    }
  }
}

export function roleResource(role: Role, extra: { permissions?: string[]; usersCount?: number } = {}) {
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description,
    is_admin: role.is_admin,
    is_system: role.is_system,
    ...(extra.permissions !== undefined ? { permissions: extra.permissions } : {}),
    ...(extra.usersCount !== undefined ? { users_count: extra.usersCount } : {})
  }
}

export function userResource(ctx: Ctx, user: User, roles?: Role[]) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    timezone: user.timezone,
    locale: user.locale,
    is_active: user.is_active,
    last_login_at: toUserTimezone(ctx, user.last_login_at),
    created_at: toUserTimezone(ctx, user.created_at),
    ...(roles !== undefined ? { roles: roles.map((role) => roleResource(role)) } : {})
  }
}

export function permissionResource(permission: Permission) {
  return {
    id: permission.id,
    name: permission.name,
    group: permission.group,
    scope: permission.scope,
    description: permission.description
  }
}

export function patientResource(ctx: Ctx, patient: Patient) {
  return {
    id: patient.id,
    first_name: patient.first_name,
    last_name: patient.last_name,
    full_name: `${patient.first_name} ${patient.last_name}`.trim(),
    email: patient.email,
    phone: patient.phone,
    date_of_birth: patient.date_of_birth,
    gender: patient.gender,
    notes: patient.notes,
    created_at: toUserTimezone(ctx, patient.created_at)
  }
}

export interface AppointmentRelations {
  patient?: Patient | null
  doctor?: UserRef | null
  checkedInBy?: UserRef | null
}

export function appointmentResource(ctx: Ctx, appointment: Appointment, relations: AppointmentRelations = {}) {
  return {
    id: appointment.id,
    scheduled_at: toUserTimezone(ctx, appointment.scheduled_at),
    duration_minutes: appointment.duration_minutes,
    reason: appointment.reason,
    status: appointment.status,
    allowed_transitions: appointmentTransitions(appointment.status as AppointmentStatus),
    checked_in_at: toUserTimezone(ctx, appointment.checked_in_at),
    completed_at: toUserTimezone(ctx, appointment.completed_at),
    notes: appointment.notes,
    ...('patient' in relations ? { patient: relations.patient ? patientResource(ctx, relations.patient) : null } : {}),
    ...('doctor' in relations ? { doctor: ref(relations.doctor) } : {}),
    ...('checkedInBy' in relations ? { checked_in_by: ref(relations.checkedInBy) } : {})
  }
}

/** A nullable session, so "offline" is a regular payload, not a 404 */
export function presenceResource(ctx: Ctx, session: PresenceSession | null) {
  const online = session !== null && isLive(session)

  return {
    online,
    started_at: online ? toUserTimezone(ctx, session.started_at) : null,
    last_heartbeat_at: online ? toUserTimezone(ctx, session.last_heartbeat_at) : null,
    timeout_minutes: config.tenancy.presence.timeoutMinutes
  }
}

export function productResource(ctx: Ctx, product: Product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    price_cents: product.price_cents,
    currency: product.currency,
    stock: product.stock,
    is_active: product.is_active,
    created_at: toUserTimezone(ctx, product.created_at)
  }
}

export interface OrderRelations {
  itemsCount?: number
  items?: OrderItem[]
  placedBy?: UserRef | null
}

export function orderResource(ctx: Ctx, order: Order, relations: OrderRelations = {}) {
  return {
    id: order.id,
    number: order.number,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    status: order.status,
    allowed_transitions: orderTransitions(order.status as OrderStatus),
    total_cents: order.total_cents,
    currency: order.currency,
    ...(relations.itemsCount !== undefined ? { items_count: relations.itemsCount } : {}),
    ...(relations.items !== undefined
      ? {
          items: relations.items.map((item) => ({
            id: item.id,
            product_id: item.product_id,
            product_name: item.product_name,
            unit_price_cents: item.unit_price_cents,
            quantity: item.quantity,
            line_total_cents: item.line_total_cents
          }))
        }
      : {}),
    ...('placedBy' in relations ? { placed_by: ref(relations.placedBy) } : {}),
    created_at: toUserTimezone(ctx, order.created_at)
  }
}

export async function chatMessageResource(ctx: Ctx, message: ChatMessage, author: UserRef | null) {
  return {
    id: message.id,
    room_id: message.room_id,
    body: message.body,
    // null once the author's account was removed
    user: await card(ctx, author),
    created_at: toUserTimezone(ctx, message.created_at)
  }
}

export async function chatMuteResource(ctx: Ctx, mute: ChatMute, user: UserRef | null, mutedBy: UserRef | null) {
  return {
    id: mute.id,
    user: await card(ctx, user),
    // null = muted in every room
    room_id: mute.room_id,
    reason: mute.reason,
    // null = until someone lifts it
    expires_at: toUserTimezone(ctx, mute.expires_at),
    muted_by: await card(ctx, mutedBy),
    created_at: toUserTimezone(ctx, mute.created_at)
  }
}

export interface ChatRoomRelations {
  roles?: { id: number; name: string; slug: string }[]
  /** Viewer specific; only present on the room list */
  unreadCount?: number
  /** Present on the room list; null when the room has no messages yet */
  lastMessage?: Awaited<ReturnType<typeof chatMessageResource>> | null
}

export function chatRoomResource(ctx: Ctx, room: ChatRoom, relations: ChatRoomRelations = {}) {
  return {
    id: room.id,
    name: room.name,
    slug: room.slug,
    description: room.description,
    icon: room.icon,
    is_default: room.is_default,
    is_locked: room.is_locked,
    // everyone | admins | roles
    audience: room.audience,
    ...(relations.roles !== undefined ? { roles: relations.roles.map((r) => ({ id: r.id, name: r.name, slug: r.slug })) } : {}),
    ...(relations.unreadCount !== undefined ? { unread_count: relations.unreadCount } : {}),
    ...('lastMessage' in relations ? { last_message: relations.lastMessage ?? null } : {}),
    created_at: toUserTimezone(ctx, room.created_at)
  }
}
