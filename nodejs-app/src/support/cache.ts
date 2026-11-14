import { config } from '../config/index.ts'
import { redis } from './redis.ts'

/**
 * Key/value cache with the handful of operations the app needs (Laravel's
 * Cache repository subset). Values are JSON. TTLs are in seconds; no TTL = forever.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>
  put(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  /** Store only when the key is missing; true when it was stored */
  add(key: string, value: unknown, ttlSeconds?: number): Promise<boolean>
  increment(key: string): Promise<number>
  forget(key: string): Promise<void>
  remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>
  flush(): Promise<void>
}

const PREFIX = 'nodejs_react_cache:'

export class MemoryCache implements Cache {
  private readonly items = new Map<string, { value: string; expiresAt: number | null }>()

  private read(key: string): string | null {
    const item = this.items.get(key)
    if (!item) return null
    if (item.expiresAt !== null && item.expiresAt <= Date.now()) {
      this.items.delete(key)
      return null
    }
    return item.value
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = this.read(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  }

  async put(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.items.set(key, { value: JSON.stringify(value), expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null })
  }

  async add(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    if (this.read(key) !== null) return false
    await this.put(key, value, ttlSeconds)
    return true
  }

  async increment(key: string): Promise<number> {
    const raw = this.read(key)
    const next = (raw === null ? 0 : Number(JSON.parse(raw))) + 1
    const expiresAt = this.items.get(key)?.expiresAt ?? null
    this.items.set(key, { value: JSON.stringify(next), expiresAt })
    return next
  }

  async forget(key: string): Promise<void> {
    this.items.delete(key)
  }

  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) return cached
    const value = await factory()
    await this.put(key, value, ttlSeconds)
    return value
  }

  async flush(): Promise<void> {
    this.items.clear()
  }
}

export class RedisCache implements Cache {
  async get<T>(key: string): Promise<T | null> {
    const raw = await redis().get(PREFIX + key)
    return raw === null ? null : (JSON.parse(raw) as T)
  }

  async put(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await redis().set(PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds)
    else await redis().set(PREFIX + key, JSON.stringify(value))
  }

  async add(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    const result = ttlSeconds
      ? await redis().set(PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds, 'NX')
      : await redis().set(PREFIX + key, JSON.stringify(value), 'NX')
    return result === 'OK'
  }

  async increment(key: string): Promise<number> {
    return redis().incr(PREFIX + key)
  }

  async forget(key: string): Promise<void> {
    await redis().del(PREFIX + key)
  }

  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) return cached
    const value = await factory()
    await this.put(key, value, ttlSeconds)
    return value
  }

  async flush(): Promise<void> {
    let cursor = '0'
    do {
      const [next, keys] = await redis().scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 500)
      cursor = next
      if (keys.length) await redis().del(...keys)
    } while (cursor !== '0')
  }
}

let instance: Cache | null = null

export function cache(): Cache {
  instance ??= config.cacheStore === 'redis' ? new RedisCache() : new MemoryCache()
  return instance
}

export function setCache(next: Cache | null): void {
  instance = next
}
