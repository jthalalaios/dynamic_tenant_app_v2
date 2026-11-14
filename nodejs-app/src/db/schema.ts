import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'
import type { AppointmentReason, AppointmentStatus, ChatAudience, OrderStatus, TenantType } from '../domain/enums.ts'

/**
 * Database schema as Kysely sees it. Every timestamp is `timestamptz`, stored in UTC.
 */
type Timestamp = ColumnType<Date, Date | string, Date | string>
type CreatedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
type Id = Generated<number>
type WithDefault<T> = ColumnType<T, T | undefined, T>

export interface TenantsTable {
  id: Id
  name: string
  slug: string
  /** doctor | marketplace — drives available features, permissions and the frontend theme */
  type: TenantType
  timezone: WithDefault<string>
  locale: WithDefault<string>
  settings: ColumnType<unknown | null, string | null | undefined, string | null>
  is_active: WithDefault<boolean>
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
  deleted_at: NullableTimestamp
}

export interface UsersTable {
  id: Id
  /** Nullable at the schema level; the API refuses users without a tenant */
  tenant_id: number | null
  name: string
  email: string
  email_verified_at: NullableTimestamp
  password: string
  timezone: string | null
  locale: string | null
  is_active: WithDefault<boolean>
  last_login_at: NullableTimestamp
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
}

export interface PasswordResetTokensTable {
  email: string
  /** bcrypt hash of the emailed token */
  token: string
  created_at: Timestamp
}

/** Personal access tokens: the JWT's `jti` is the row id, so tokens can be revoked */
export interface AccessTokensTable {
  id: string
  user_id: number
  name: string | null
  revoked: WithDefault<boolean>
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
  expires_at: Timestamp
}

export interface PermissionsTable {
  id: Id
  name: string
  group: string
  /** common | doctor | marketplace — which tenant types may grant it */
  scope: string
  description: string | null
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
}

export interface RolesTable {
  id: Id
  tenant_id: number
  name: string
  slug: string
  description: string | null
  /** Admin roles implicitly hold every permission available to the tenant */
  is_admin: WithDefault<boolean>
  /** System roles are seeded per tenant: they cannot be deleted and their admin flag is fixed */
  is_system: WithDefault<boolean>
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
}

export interface PermissionRoleTable {
  role_id: number
  permission_id: number
}

export interface RoleUserTable {
  role_id: number
  user_id: number
}

export interface PatientsTable {
  id: Id
  tenant_id: number
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  /** YYYY-MM-DD */
  date_of_birth: ColumnType<string | null, string | null | undefined, string | null>
  gender: string | null
  notes: string | null
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
  deleted_at: NullableTimestamp
}

export interface AppointmentsTable {
  id: Id
  tenant_id: number
  patient_id: number
  doctor_id: number | null
  scheduled_at: Timestamp
  duration_minutes: WithDefault<number>
  reason: AppointmentReason
  status: WithDefault<AppointmentStatus>
  checked_in_at: NullableTimestamp
  checked_in_by: number | null
  completed_at: NullableTimestamp
  notes: string | null
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
  deleted_at: NullableTimestamp
}

export interface PresenceSessionsTable {
  id: Id
  tenant_id: number
  user_id: number
  started_at: Timestamp
  last_heartbeat_at: Timestamp
  ended_at: NullableTimestamp
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
}

export interface ProductsTable {
  id: Id
  tenant_id: number
  sku: string
  name: string
  description: string | null
  category: string | null
  /** Money is stored as integer minor units to avoid float rounding */
  price_cents: number
  currency: WithDefault<string>
  stock: WithDefault<number>
  is_active: WithDefault<boolean>
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
  deleted_at: NullableTimestamp
}

export interface OrdersTable {
  id: Id
  tenant_id: number
  number: string
  customer_name: string
  customer_email: string | null
  status: WithDefault<OrderStatus>
  total_cents: WithDefault<number>
  currency: WithDefault<string>
  placed_by: number | null
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
  deleted_at: NullableTimestamp
}

export interface OrderItemsTable {
  id: Id
  order_id: number
  product_id: number | null
  /** Snapshot so historical orders stay correct when the product changes */
  product_name: string
  unit_price_cents: number
  quantity: number
  line_total_cents: number
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
}

export interface ChatRoomsTable {
  id: Id
  tenant_id: number
  name: string
  slug: string
  description: string | null
  icon: WithDefault<string>
  /** The tenant's default ("Global") room can be edited but never deleted */
  is_default: WithDefault<boolean>
  /** Locked room: only administrators may post ("mute everyone") */
  is_locked: WithDefault<boolean>
  audience: WithDefault<ChatAudience>
  created_by: number | null
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
}

export interface ChatRoomRoleTable {
  room_id: number
  role_id: number
}

export interface ChatMessagesTable {
  id: Id
  tenant_id: number
  room_id: number
  user_id: number | null
  body: string
  deleted_by: number | null
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
  deleted_at: NullableTimestamp
}

/** room_id NULL = muted in every room of the tenant; expires_at NULL = until lifted */
export interface ChatMutesTable {
  id: Id
  tenant_id: number
  user_id: number
  room_id: number | null
  muted_by: number | null
  reason: string | null
  expires_at: NullableTimestamp
  created_at: CreatedTimestamp
  updated_at: CreatedTimestamp
}

/** Per user read marker, drives the unread badges */
export interface ChatRoomReadsTable {
  room_id: number
  user_id: number
  last_read_message_id: WithDefault<number>
  updated_at: NullableTimestamp
}

export interface DB {
  tenants: TenantsTable
  users: UsersTable
  password_reset_tokens: PasswordResetTokensTable
  access_tokens: AccessTokensTable
  permissions: PermissionsTable
  roles: RolesTable
  permission_role: PermissionRoleTable
  role_user: RoleUserTable
  patients: PatientsTable
  appointments: AppointmentsTable
  presence_sessions: PresenceSessionsTable
  products: ProductsTable
  orders: OrdersTable
  order_items: OrderItemsTable
  chat_rooms: ChatRoomsTable
  chat_room_role: ChatRoomRoleTable
  chat_messages: ChatMessagesTable
  chat_mutes: ChatMutesTable
  chat_room_reads: ChatRoomReadsTable
}

export type Tenant = Selectable<TenantsTable>
export type User = Selectable<UsersTable>
export type NewUser = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>
export type Role = Selectable<RolesTable>
export type Permission = Selectable<PermissionsTable>
export type Patient = Selectable<PatientsTable>
export type Appointment = Selectable<AppointmentsTable>
export type PresenceSession = Selectable<PresenceSessionsTable>
export type Product = Selectable<ProductsTable>
export type Order = Selectable<OrdersTable>
export type OrderItem = Selectable<OrderItemsTable>
export type ChatRoom = Selectable<ChatRoomsTable>
export type ChatMessage = Selectable<ChatMessagesTable>
export type ChatMute = Selectable<ChatMutesTable>
