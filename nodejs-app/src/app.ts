import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { config } from './config/index.ts'
import { errorHandler, notFoundHandler } from './http/errorHandler.ts'
import { clientPreferences } from './http/middleware.ts'
import { adminRoutes } from './http/routes/admin.ts'
import { authRoutes } from './http/routes/auth.ts'
import { chatRoutes } from './http/routes/chat.ts'
import { doctorRoutes } from './http/routes/doctor.ts'
import { marketplaceRoutes } from './http/routes/marketplace.ts'
import { webRoutes } from './http/routes/web.ts'
import { normaliseInput } from './http/validation.ts'
import { createContext } from './support/context.ts'

/**
 * The HTTP application (the port of bootstrap/app.php + routes/api.php).
 *
 * The API is versioned under /api/v1. The same endpoints serve every theme: a
 * standalone frontend sends X-App-Theme, which scopes login / register / forgot
 * password to its theme and makes the tenant middleware refuse tokens of another theme.
 */
export interface BuildOptions {
  logger?: boolean
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.app.logLevel },
    // Only nginx sits in front of the API: client IPs (rate limits) come from X-Forwarded-For
    trustProxy: config.app.trustedProxies.length ? config.app.trustedProxies.join(',') : false,
    bodyLimit: 1024 * 1024,
    routerOptions: { ignoreTrailingSlash: true }
  })

  // JSON bodies; an empty body is an empty object (e.g. POST /doctor/presence/online)
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, raw, done) => {
    const text = String(raw)
    if (text.trim() === '') return done(null, {})
    try {
      done(null, JSON.parse(text))
    } catch {
      const error = new Error('Invalid JSON') as Error & { statusCode: number; code: string }
      error.statusCode = 400
      error.code = 'FST_ERR_CTP_INVALID_JSON_BODY'
      done(error, undefined)
    }
  })

  await app.register(cors, {
    origin: config.cors.allowedOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: config.cors.exposedHeaders,
    maxAge: config.cors.maxAge,
    credentials: false
  })

  app.decorateRequest('ctx', null as never)

  // Client locale / timezone / theme for the API; a plain context elsewhere
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/')) await clientPreferences(request)
    else request.ctx = createContext()
  })

  // TrimStrings + ConvertEmptyStringsToNull
  app.addHook('preValidation', async (request) => {
    if (request.body !== undefined) request.body = normaliseInput(request.body)
    if (request.query) request.query = normaliseInput({ ...(request.query as object) })
  })

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/') && request.ctx) reply.header('content-language', request.ctx.locale)
  })

  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler(notFoundHandler)

  await app.register(webRoutes)
  await app.register(
    async (api) => {
      await api.register(authRoutes)
      await api.register(adminRoutes)
      await api.register(chatRoutes)
      await api.register(doctorRoutes)
      await api.register(marketplaceRoutes)
    },
    { prefix: '/api/v1' }
  )

  return app
}
