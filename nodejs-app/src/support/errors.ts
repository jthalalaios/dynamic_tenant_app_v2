/**
 * Errors the HTTP layer renders as JSON (see http/errorHandler.ts).
 */

/** An HTTP error with an already translated message */
export class HttpError extends Error {
  readonly status: number
  readonly code: string | null
  readonly headers: Record<string, string>

  constructor(status: number, message: string, code: string | null = null, headers: Record<string, string> = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.headers = headers
  }
}

/**
 * A request that is well-formed but breaks a domain rule (e.g. checking in while offline).
 * Rendered with a machine readable `code` so clients can react to specific cases.
 */
export class BusinessRuleError extends HttpError {
  constructor(message: string, code: string, status = 409) {
    super(status, message, code)
    this.name = 'BusinessRuleError'
  }
}

/** A record that does not exist for the caller (another tenant's, or a room outside the audience) */
export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message)
    this.name = 'NotFoundError'
  }
}

export type ValidationErrors = Record<string, string[]>

/** 422 with field errors, like Laravel's ValidationException */
export class ValidationError extends Error {
  readonly errors: ValidationErrors

  constructor(errors: ValidationErrors, message: string) {
    super(message)
    this.name = 'ValidationError'
    this.errors = errors
  }
}
