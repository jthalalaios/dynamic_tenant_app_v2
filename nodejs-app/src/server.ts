import { buildApp } from './app.ts'
import { config } from './config/index.ts'
import { closeDatabase } from './db/database.ts'
import { startScheduler } from './scheduler.ts'
import { appKey } from './support/hash.ts'
import { closeRedis } from './support/redis.ts'

/**
 * Entry point of the API container: `node src/server.ts`.
 */
appKey() // fail fast without APP_KEY: tokens and signed links depend on it

const app = await buildApp()
const stopScheduler = startScheduler((message) => app.log.info(message))

await app.listen({ host: '0.0.0.0', port: config.app.port })

let stopping = false
async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  app.log.info(`${signal} received, shutting down...`)
  stopScheduler()
  await app.close()
  await Promise.allSettled([closeDatabase(), closeRedis()])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
