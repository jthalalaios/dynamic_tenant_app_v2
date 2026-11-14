import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { config } from '../config/index.ts'

/**
 * Password hashing (bcrypt, like Laravel's default hasher) and keyed signatures.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.app.bcryptRounds)
}

export async function checkPassword(plain: string, hashed: string): Promise<boolean> {
  if (!hashed) return false
  try {
    return await bcrypt.compare(plain, hashed)
  } catch {
    return false
  }
}

/** True when the hash was made with a different cost than configured (Hash::needsRehash) */
export function needsRehash(hashed: string): boolean {
  try {
    return bcrypt.getRounds(hashed) !== config.app.bcryptRounds
  } catch {
    return true
  }
}

export function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Raw key bytes from APP_KEY ("base64:..." or a plain string) */
export function appKey(): Buffer {
  const key = config.app.key
  if (!key) throw new Error('APP_KEY is not set. Generate one with: openssl rand -base64 32')
  return key.startsWith('base64:') ? Buffer.from(key.slice(7), 'base64') : Buffer.from(key, 'utf8')
}

export function hmac(value: string): string {
  return createHmac('sha256', appKey()).update(value).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
