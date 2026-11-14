import { config } from './config/index.ts'
import { closeDatabase } from './db/database.ts'
import { attachRealtime, createRealtimeHttpServer } from './realtime/server.ts'
import { closeRedis } from './support/redis.ts'

/**
 * Entry point of the realtime container: `node src/realtime.ts`.
 */
const httpServer = createRealtimeHttpServer()
const io = attachRealtime(httpServer)

httpServer.listen(config.realtime.port, '0.0.0.0', () => {
  console.info(`[realtime] listening on :${config.realtime.port}`)
})

let stopping = false
async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  console.info(`[realtime] ${signal} received, closing connections...`)
  await new Promise<void>((resolve) => io.close(() => resolve()))
  await Promise.allSettled([closeDatabase(), closeRedis()])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
