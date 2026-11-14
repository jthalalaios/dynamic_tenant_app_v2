import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { createContext, t } from '../support/context.ts'
import { HttpError, ValidationError } from '../support/errors.ts'

/**
 * Uniform, non-leaky JSON errors for the API (the port of bootstrap/app.php's
 * exception rendering). Errors carry a machine readable `code` where useful.
 */
export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  const ctx = request.ctx ?? createContext()

  if (error instanceof ValidationError) {
    reply.status(422).send({ message: error.message, errors: error.errors })
    return
  }

  if (error instanceof HttpError) {
    for (const [name, value] of Object.entries(error.headers)) reply.header(name, value)
    reply.status(error.status).send(error.code ? { message: error.message, code: error.code } : { message: error.message })
    return
  }

  // Fastify's own client errors: malformed JSON, oversized or unsupported bodies...
  const status = (error as FastifyError).statusCode
  if (status && status >= 400 && status < 500) {
    const message = (error as FastifyError).code?.startsWith('FST_ERR_CTP') ? t(ctx, 'validation.json') : error.message
    reply.status(status).send({ message })
    return
  }

  request.log.error({ err: error }, 'Unhandled error')
  reply.status(500).send({ message: t(ctx, 'messages.server_error') })
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  const ctx = request.ctx ?? createContext()
  reply.status(404).send({ message: t(ctx, 'messages.route_not_found') })
}
