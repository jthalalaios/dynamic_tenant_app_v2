import { Redis } from 'ioredis'
import { config } from '../config/index.ts'

/**
 * Shared Redis connection (cache, rate limits, realtime publishing).
 * Created lazily, so processes that never touch Redis never connect.
 */
let client: Redis | null = null

export function redisOptions() {
  const { host, port, password } = config.redis
  return { host, port, password, maxRetriesPerRequest: 3, enableAutoPipelining: true }
}

export function redis(): Redis {
  client ??= new Redis(redisOptions())
  return client
}

export async function closeRedis(): Promise<void> {
  if (!client) return
  const current = client
  client = null
  await current.quit().catch(() => current.disconnect())
}
