import type { Executor } from '../db/database.ts'
import { db } from '../db/database.ts'
import type { DB } from '../db/schema.ts'
import type { Ctx } from '../support/context.ts'
import { ValidationError, type ValidationErrors } from '../support/errors.ts'
import { checkPassword } from '../support/hash.ts'
import { trans, type Replacements } from '../support/i18n.ts'
import { isValidTimezone, parseInZone } from '../support/time.ts'

/**
 * Request validation with Laravel's semantics (the port of FormRequest rules):
 *
 * - `sometimes`: rules only run when the field is present in the input
 * - `nullable`: a null value passes every other rule
 * - implicit rules (`required`, `present`, `requiredWith`) run even on missing fields;
 *   every other rule is skipped for fields that are absent
 * - `field.*` and `field.*.key` wildcards validate every element of an array
 * - validation stops at a field's first failing rule; the response lists every
 *   failing field: `{ message, errors: { field: [message] } }` with status 422
 * - `validated` only holds the fields that have rules and were sent, with integers
 *   and booleans normalised
 */

type Failure = { key: string; replace?: Replacements }

interface RuleContext {
  ctx: Ctx
  input: Record<string, unknown>
  attribute: string
  /** Rule names of the attribute (to tell numeric from string sizes) */
  ruleNames: Set<string>
  /** Values of every sibling of a wildcard attribute (for `distinct`) */
  siblings: unknown[]
}

export interface Rule {
  name: string
  /** Runs even when the field is absent */
  implicit?: boolean
  check(value: unknown, context: RuleContext): Failure | null | Promise<Failure | null>
}

export type Rules = Record<string, Rule[]>

// ------------------------------------------------------------------ presence

/** Only validate the field when it is present in the input */
export const sometimes: Rule = { name: 'sometimes', check: () => null }

/** null passes every other rule */
export const nullable: Rule = { name: 'nullable', check: () => null }

export function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
}

export const required: Rule = {
  name: 'required',
  implicit: true,
  check: (value) => (isEmptyValue(value) ? { key: 'required' } : null)
}

export const present: Rule = {
  name: 'present',
  implicit: true,
  check: (value) => (value === undefined ? { key: 'present' } : null)
}

/** Required when another field is present and not empty */
export function requiredWith(other: string): Rule {
  return {
    name: 'required_with',
    implicit: true,
    check: (value, { input }) =>
      !isEmptyValue(getPath(input, other)) && isEmptyValue(value) ? { key: 'required_with', replace: { values: displayName(other) } } : null
  }
}

// ---------------------------------------------------------------------- types

export const string: Rule = { name: 'string', check: (v) => (typeof v === 'string' ? null : { key: 'string' }) }

export function isIntegerLike(value: unknown): boolean {
  if (typeof value === 'number') return Number.isSafeInteger(value)
  return typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value))
}

export const integer: Rule = { name: 'integer', check: (v) => (isIntegerLike(v) ? null : { key: 'integer' }) }

const BOOLEAN_VALUES = [true, false, 0, 1, '0', '1']

export const boolean: Rule = { name: 'boolean', check: (v) => (BOOLEAN_VALUES.includes(v as never) ? null : { key: 'boolean' }) }

export const array: Rule = { name: 'array', check: (v) => (Array.isArray(v) ? null : { key: 'array' }) }

export const email: Rule = {
  name: 'email',
  check: (v) => (typeof v === 'string' && /^[^\s@]+@[^\s@]+$/.test(v) && !v.includes('..') ? null : { key: 'email' })
}

export const alpha: Rule = { name: 'alpha', check: (v) => (typeof v === 'string' && /^[\p{L}\p{M}]+$/u.test(v) ? null : { key: 'alpha' }) }

export const timezone: Rule = { name: 'timezone', check: (v) => (isValidTimezone(v) ? null : { key: 'timezone' }) }

/** strtotime()-parsable date or date-time */
export const date: Rule = {
  name: 'date',
  check: (v) => (typeof v === 'string' && parseInZone(v, 'UTC') !== null ? null : { key: 'date' })
}

/** `YYYY-MM-DD` and a real calendar day */
export const dateYmd: Rule = {
  name: 'date_format',
  check: (v) => (typeof v === 'string' && isCalendarDay(v) ? null : { key: 'date_format', replace: { format: 'Y-m-d' } })
}

export function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
}

/** A date not after today (UTC, the app timezone) */
export const beforeOrEqualToday: Rule = {
  name: 'before_or_equal',
  check: (v) => {
    if (typeof v !== 'string') return { key: 'before_or_equal', replace: { date: 'today' } }
    // strtotime('today'): midnight at the start of today
    const parsed = parseInZone(v, 'UTC')
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    return parsed !== null && parsed.getTime() <= today.getTime() ? null : { key: 'before_or_equal', replace: { date: 'today' } }
  }
}

// -------------------------------------------------------------------- values

export function oneOf(values: readonly (string | number)[]): Rule {
  const allowed = values.map(String)
  return {
    name: 'in',
    check: (v) => ((typeof v === 'string' || typeof v === 'number') && allowed.includes(String(v)) ? null : { key: 'in' })
  }
}

function sizeOf(value: unknown, numeric: boolean): { size: number; kind: 'numeric' | 'array' | 'string' } | null {
  if (Array.isArray(value)) return { size: value.length, kind: 'array' }
  if (numeric && (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))))) {
    return { size: Number(value), kind: 'numeric' }
  }
  if (typeof value === 'string') return { size: [...value].length, kind: 'string' }
  if (typeof value === 'number') return { size: value, kind: 'numeric' }
  return null
}

const NUMERIC_RULES = ['integer', 'numeric']

export function max(limit: number): Rule {
  return {
    name: 'max',
    check: (v, { ruleNames }) => {
      const measured = sizeOf(v, NUMERIC_RULES.some((r) => ruleNames.has(r)))
      return measured && measured.size > limit ? { key: `max_${measured.kind}`, replace: { max: limit } } : null
    }
  }
}

export function min(limit: number): Rule {
  return {
    name: 'min',
    check: (v, { ruleNames }) => {
      const measured = sizeOf(v, NUMERIC_RULES.some((r) => ruleNames.has(r)))
      return measured && measured.size < limit ? { key: `min_${measured.kind}`, replace: { min: limit } } : null
    }
  }
}

/** Exact string length */
export function size(length: number): Rule {
  return {
    name: 'size',
    check: (v) => (typeof v === 'string' && [...v].length === length ? null : { key: 'size_string', replace: { size: length } })
  }
}

/** `<field>_confirmation` must match */
export const confirmed: Rule = {
  name: 'confirmed',
  check: (v, { input, attribute }) => (getPath(input, `${attribute}_confirmation`) === v ? null : { key: 'confirmed' })
}

/** Distinct among the elements of a wildcard array */
export const distinct: Rule = {
  name: 'distinct',
  check: (v, { siblings }) => (siblings.filter((s) => String(s) === String(v)).length > 1 ? { key: 'distinct' } : null)
}

/** The signed-in user's current password */
export const currentPassword: Rule = {
  name: 'current_password',
  check: async (v, { ctx }) =>
    typeof v === 'string' && ctx.user && (await checkPassword(v, ctx.user.password)) ? null : { key: 'current_password' }
}

// ---------------------------------------------------------------- database

type Table = keyof DB & string
// Extra constraints on the lookup: e.g. same tenant, not soft deleted
type Scope = (query: any) => any

/** A row with `column = value` exists */
export function exists(table: Table, column: string, scope?: Scope, executor?: Executor): Rule {
  return {
    name: 'exists',
    check: async (v) => {
      if (typeof v !== 'string' && typeof v !== 'number') return { key: 'exists' }
      if (column === 'id' && !isIntegerLike(v)) return { key: 'exists' }
      let query = (executor ?? db()).selectFrom(table as any).select(column as any).where(column as any, '=', column === 'id' ? Number(v) : v)
      if (scope) query = scope(query)
      return (await query.limit(1).executeTakeFirst()) ? null : { key: 'exists' }
    }
  }
}

/** No row with `column = value`, other than `ignoreId` */
export function unique(table: Table, column: string, scope?: Scope, ignoreId?: number | null): Rule {
  return {
    name: 'unique',
    check: async (v) => {
      if (typeof v !== 'string' && typeof v !== 'number') return null
      let query = db().selectFrom(table as any).select('id' as any).where(column as any, '=', v)
      if (ignoreId !== undefined && ignoreId !== null) query = query.where('id' as any, '!=', ignoreId)
      if (scope) query = scope(query)
      return (await query.limit(1).executeTakeFirst()) ? { key: 'unique' } : null
    }
  }
}

// --------------------------------------------------------------- the engine

export function getPath(source: unknown, path: string): unknown {
  let node: unknown = source
  for (const part of path.split('.')) {
    if (node === null || node === undefined || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

function hasPath(source: unknown, path: string): boolean {
  let node: unknown = source
  for (const part of path.split('.')) {
    if (node === null || node === undefined || typeof node !== 'object' || !Object.hasOwn(node as object, part)) return false
    node = (node as Record<string, unknown>)[part]
  }
  return true
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let node: Record<string, unknown> = target
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      node[part] = value
      return
    }
    const nextIsIndex = /^\d+$/.test(parts[i + 1])
    node[part] ??= nextIsIndex ? [] : {}
    node = node[part] as Record<string, unknown>
  })
}

/** "items.*.product_id" → ["items.0.product_id", "items.1.product_id", ...] for the actual input */
function expand(pattern: string, input: unknown): string[] {
  const star = pattern.indexOf('*')
  if (star === -1) return [pattern]

  const prefix = pattern.slice(0, star - 1)
  const rest = pattern.slice(star + 1)
  const list = getPath(input, prefix)
  if (!Array.isArray(list)) return []

  return list.flatMap((_, index) => expand(`${prefix}.${index}${rest}`, input))
}

/** "first_name" → "first name" (Laravel's displayable attribute) */
function displayName(attribute: string): string {
  return attribute.replaceAll('_', ' ')
}

function normalise(value: unknown, ruleNames: Set<string>): unknown {
  if (value === null || value === undefined) return value
  if (ruleNames.has('integer') && isIntegerLike(value)) return Number(value)
  if (ruleNames.has('boolean')) return value === true || value === 1 || value === '1'
  return value
}

export type Validated = Record<string, any>

/**
 * Validate `input` against `rules`; resolves with the validated data or throws a
 * ValidationError (rendered as 422).
 */
export async function validate(ctx: Ctx, input: unknown, rules: Rules): Promise<Validated> {
  const data = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const errors: ValidationErrors = {}
  const validated: Validated = {}
  const patterns = Object.keys(rules)

  for (const pattern of patterns) {
    const list = rules[pattern]
    const ruleNames = new Set(list.map((r) => r.name))
    const attributes = expand(pattern, data)
    const isWildcard = pattern.includes('*')
    const siblings = isWildcard ? attributes.map((a) => getPath(data, a)) : []
    // Parents whose elements carry their own rules are rebuilt from those elements
    const hasChildRules = patterns.some((p) => p !== pattern && p.startsWith(`${pattern}.`))

    for (const attribute of attributes) {
      const isPresent = hasPath(data, attribute)
      const value = getPath(data, attribute)

      if (ruleNames.has('sometimes') && !isPresent) continue

      let failure: Failure | null = null
      for (const rule of list) {
        if (rule.name === 'sometimes' || rule.name === 'nullable') continue
        if (!rule.implicit && !isPresent) continue
        if (!rule.implicit && value === null && ruleNames.has('nullable')) continue

        failure = await rule.check(value, { ctx, input: data, attribute, ruleNames, siblings })
        if (failure) break
      }

      if (failure) {
        const message = trans(ctx.locale, `validation.${failure.key}`, { attribute: displayName(attribute), ...failure.replace })
        ;(errors[attribute] ??= []).push(message)
      } else if (isPresent) {
        setPath(validated, attribute, hasChildRules && Array.isArray(value) ? [] : normalise(value, ruleNames))
      }
    }
  }

  const messages = Object.values(errors).flat()
  if (messages.length) {
    // Laravel's summary: "The name field is required. (and 2 more errors)"
    const extra = messages.length - 1
    throw new ValidationError(errors, extra === 0 ? messages[0] : summaryLine(ctx, messages[0], extra))
  }

  return validated
}

function summaryLine(ctx: Ctx, first: string, extra: number): string {
  return trans(ctx.locale, extra === 1 ? 'validation.summary_one' : 'validation.summary_other', { message: first, count: extra })
}

/** Throw a 422 for one field with an already translated message (e.g. bad credentials) */
export function fail(field: string, message: string): never {
  throw new ValidationError({ [field]: [message] }, message)
}

/**
 * Laravel's TrimStrings + ConvertEmptyStringsToNull, applied to every request's
 * body and query: strings are trimmed and empty ones become null. Passwords stay untouched.
 */
const UNTRIMMED = new Set(['current_password', 'password', 'password_confirmation'])

export function normaliseInput(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (UNTRIMMED.has(key)) return value === '' ? null : value
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  if (Array.isArray(value)) return value.map((item) => normaliseInput(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normaliseInput(v, k)]))
  }
  return value
}
