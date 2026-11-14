import { db, type Executor } from '../../db/database.ts'
import type { Ctx } from '../../support/context.ts'

/**
 * Public cards of chat participants (name, admin badge).
 *
 * Admin flags are resolved with one query per request: message lists show an
 * admin badge per author, and asking each author's ACL snapshot would cost a
 * cache round trip per message.
 */
export interface MemberCard {
  id: number
  name: string
  is_admin: boolean
}

const MEMO_KEY = 'chat.directory.adminIds'

async function adminIds(ctx: Ctx, executor: Executor): Promise<Set<number>> {
  const cached = ctx.memo.get(MEMO_KEY) as Set<number> | undefined
  if (cached) return cached

  // Administrator = holds a role flagged is_admin in the current workspace
  let query = executor
    .selectFrom('role_user')
    .innerJoin('roles', 'roles.id', 'role_user.role_id')
    .where('roles.is_admin', '=', true)
    .select('role_user.user_id')
  if (ctx.tenant) query = query.where('roles.tenant_id', '=', ctx.tenant.id)

  const ids = new Set((await query.execute()).map((row) => row.user_id))
  ctx.memo.set(MEMO_KEY, ids)
  return ids
}

export async function isAdminId(ctx: Ctx, userId: number | null, executor: Executor = db()): Promise<boolean> {
  if (userId === null) return false
  return (await adminIds(ctx, executor)).has(userId)
}

export async function card(ctx: Ctx, user: { id: number; name: string } | null | undefined, executor: Executor = db()): Promise<MemberCard | null> {
  if (!user) return null
  return { id: user.id, name: user.name, is_admin: await isAdminId(ctx, user.id, executor) }
}

/** Forget the memo (after role changes within the same request) */
export function forgetDirectory(ctx: Ctx): void {
  ctx.memo.delete(MEMO_KEY)
}
