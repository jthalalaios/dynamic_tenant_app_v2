import { SignJWT, jwtVerify } from 'jose'
import { config } from '../../config/index.ts'
import { db, type Executor } from '../../db/database.ts'
import type { User } from '../../db/schema.ts'
import { appKey } from '../../support/hash.ts'
import { randomHex } from '../../support/strings.ts'

/**
 * Personal access tokens (the port of Laravel Passport's): a signed JWT whose
 * `jti` is a row in access_tokens, so every token expires, and can be revoked
 * (logout, password reset, removed member) before it does.
 */
const AUDIENCE = 'api'

export interface IssuedToken {
  id: string
  accessToken: string
  /** Seconds until the token expires */
  expiresIn: number
}

export async function issueToken(user: User, name = config.tenancy.auth.tokenName, executor: Executor = db()): Promise<IssuedToken> {
  const id = randomHex(40)
  const ttlSeconds = config.tenancy.auth.tokenTtlMinutes * 60
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = new Date((issuedAt + ttlSeconds) * 1000)

  await executor.insertInto('access_tokens').values({ id, user_id: user.id, name, expires_at: expiresAt }).execute()

  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(user.id))
    .setJti(id)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(appKey())

  return { id, accessToken, expiresIn: ttlSeconds }
}

/**
 * The user and token id behind a bearer token, or null when the token is malformed,
 * badly signed, expired or revoked, or its user no longer exists.
 */
export async function authenticateToken(token: string): Promise<{ user: User; tokenId: string } | null> {
  let jti: string | undefined
  let subject: string | undefined

  try {
    const { payload } = await jwtVerify(token, appKey(), { algorithms: ['HS256'], audience: AUDIENCE })
    jti = payload.jti
    subject = payload.sub
  } catch {
    return null
  }

  if (!jti || !subject || !/^\d+$/.test(subject)) return null

  const row = await db()
    .selectFrom('access_tokens')
    .innerJoin('users', 'users.id', 'access_tokens.user_id')
    .selectAll('users')
    .where('access_tokens.id', '=', jti)
    .where('access_tokens.user_id', '=', Number(subject))
    .where('access_tokens.revoked', '=', false)
    .where('access_tokens.expires_at', '>', new Date())
    .executeTakeFirst()

  return row ? { user: row, tokenId: jti } : null
}

export async function revokeToken(id: string, executor: Executor = db()): Promise<void> {
  await executor.updateTable('access_tokens').set({ revoked: true, updated_at: new Date() }).where('id', '=', id).execute()
}

/** Sign the user out on every device */
export async function revokeAllTokens(userId: number, executor: Executor = db()): Promise<void> {
  await executor
    .updateTable('access_tokens')
    .set({ revoked: true, updated_at: new Date() })
    .where('user_id', '=', userId)
    .where('revoked', '=', false)
    .execute()
}

/** Delete revoked tokens, and tokens expired for more than a week (passport:purge) */
export async function purgeTokens(executor: Executor = db()): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const result = await executor
    .deleteFrom('access_tokens')
    .where((eb) => eb.or([eb('revoked', '=', true), eb('expires_at', '<', weekAgo)]))
    .executeTakeFirst()
  return Number(result.numDeletedRows)
}
