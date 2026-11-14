import { config } from '../config/index.ts'
import { redis } from './redis.ts'

/**
 * Fixed-window rate limiter (Laravel's RateLimiter / ThrottleRequests).
 * Every hit increments the window counter; the window starts on its first hit.
 */
export interface Limit {
  key: string
  maxAttempts: number
  decaySeconds: number
}

export interface LimitResult {
  limit: Limit
  attempts: number
  /** Seconds until the window resets */
  retryAfter: number
}

export interface RateLimitStore {
  hit(key: string, decaySeconds: number): Promise<{ attempts: number; ttl: number }>
  clear(): Promise<void>
}

const PREFIX = 'nodejs_react_throttle:'

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { attempts: number; resetAt: number }>()

  async hit(key: string, decaySeconds: number) {
    const now = Date.now()
    const current = this.windows.get(key)
    const window = current && current.resetAt > now ? current : { attempts: 0, resetAt: now + decaySeconds * 1000 }
    window.attempts++
    this.windows.set(key, window)
    return { attempts: window.attempts, ttl: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) }
  }

  async clear(): Promise<void> {
    this.windows.clear()
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  async hit(key: string, decaySeconds: number) {
    const full = PREFIX + key
    const [[, attempts], , [, ttl]] = (await redis()
      .multi()
      .incr(full)
      .expire(full, decaySeconds, 'NX')
      .ttl(full)
      .exec()) as [[null, number], [null, number], [null, number]]
    return { attempts, ttl: ttl > 0 ? ttl : decaySeconds }
  }

  async clear(): Promise<void> {
    let cursor = '0'
    do {
      const [next, keys] = await redis().scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 500)
      cursor = next
      if (keys.length) await redis().del(...keys)
    } while (cursor !== '0')
  }
}

let store: RateLimitStore | null = null

export function rateLimitStore(): RateLimitStore {
  store ??= config.cacheStore === 'redis' ? new RedisRateLimitStore() : new MemoryRateLimitStore()
  return store
}

export function setRateLimitStore(next: RateLimitStore | null): void {
  store = next
}

/**
 * Count a hit against every limit; returns the first limit that is exceeded, or the
 * tightest remaining one (for the X-RateLimit headers).
 */
export async function attempt(limits: Limit[]): Promise<{ exceeded: LimitResult | null; tightest: LimitResult | null }> {
  let tightest: LimitResult | null = null

  for (const limit of limits) {
    const { attempts, ttl } = await rateLimitStore().hit(limit.key, limit.decaySeconds)
    const result: LimitResult = { limit, attempts, retryAfter: ttl }

    if (attempts > limit.maxAttempts) return { exceeded: result, tightest: result }
    if (!tightest || limit.maxAttempts - attempts < tightest.limit.maxAttempts - tightest.attempts) tightest = result
  }

  return { exceeded: null, tightest }
}
