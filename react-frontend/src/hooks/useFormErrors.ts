import { useCallback, useMemo, useState } from 'react'
import { ApiError } from '../api'
import type { ValidationErrors } from '../types/api'

/**
 * Field-level validation errors from a 422 response, for inline display.
 * `capture` returns true when the error was a validation error (and was captured).
 */
export function useFormErrors() {
  const [errors, setErrors] = useState<ValidationErrors>({})

  const capture = useCallback((err: unknown): boolean => {
    const apiError = ApiError.from(err)
    setErrors(apiError.isValidationError ? apiError.errors : {})
    return apiError.isValidationError
  }, [])

  const first = useCallback((field: string): string | undefined => errors[field]?.[0], [errors])
  const clear = useCallback(() => setErrors({}), [])

  return useMemo(() => ({ errors, capture, first, clear }), [errors, capture, first, clear])
}
