import type { FastifyReply, FastifyRequest } from 'fastify'
import { requireTenant, requireUser, t, type Ctx } from '../support/context.ts'
import { NotFoundError } from '../support/errors.ts'

/**
 * Small helpers shared by the route modules.
 */
export function body(request: FastifyRequest): Record<string, unknown> {
  const value = request.body
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function query(request: FastifyRequest): Record<string, unknown> {
  return (request.query as Record<string, unknown> | undefined) ?? {}
}

/** A route parameter as a positive integer id; anything else is a 404 (like a missing model) */
export function idParam(request: FastifyRequest, name: string): number {
  const raw = (request.params as Record<string, string | undefined>)[name]
  const id = raw !== undefined && /^\d{1,18}$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(id) || id < 1) throw new NotFoundError(t(request.ctx, 'messages.not_found'))
  return id
}

/** Throw the API's 404 for a record that does not exist for the caller */
export function orNotFound<T>(ctx: Ctx, value: T | null | undefined): T {
  if (value === null || value === undefined) throw new NotFoundError(t(ctx, 'messages.not_found'))
  return value
}

export function noContent(reply: FastifyReply): FastifyReply {
  return reply.code(204).send()
}

export function created<T>(reply: FastifyReply, payload: T): FastifyReply {
  return reply.code(201).send(payload)
}

/** The authenticated user and their tenant (both guaranteed by the route guards) */
export function actor(request: FastifyRequest) {
  return { user: requireUser(request.ctx), tenant: requireTenant(request.ctx) }
}

/** `?search=` (already trimmed; empty strings arrive as null) */
export function searchTerm(request: FastifyRequest): string | null {
  const value = query(request).search
  return typeof value === 'string' && value !== '' ? value : null
}
