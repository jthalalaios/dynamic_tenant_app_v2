import type { FastifyRequest } from 'fastify'
import type { SelectQueryBuilder } from 'kysely'
import { config } from '../config/index.ts'
import type { DB } from '../db/schema.ts'

/**
 * Laravel's length-aware paginator, serialised like a paginated resource collection:
 * `{ data, links: { first, last, prev, next }, meta: { current_page, from, last_page, path, per_page, to, total } }`.
 */
function queryInt(request: FastifyRequest, key: string): number | null {
  const value = (request.query as Record<string, unknown> | undefined)?.[key]
  if (value === undefined || value === null) return null
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Page size from `?per_page=`, clamped to the configured bounds */
export function perPage(request: FastifyRequest): number {
  const { default: fallback, max } = config.tenancy.pagination
  return Math.max(1, Math.min(queryInt(request, 'per_page') ?? fallback, max))
}

export function currentPage(request: FastifyRequest): number {
  const page = queryInt(request, 'page')
  return page !== null && page >= 1 ? page : 1
}

export async function paginate<O, T>(
  request: FastifyRequest,
  query: SelectQueryBuilder<DB, any, O>,
  serialize: (rows: O[]) => T[] | Promise<T[]>
) {
  const page = currentPage(request)
  const size = perPage(request)

  const counted = (await query
    .clearSelect()
    .clearOrderBy()
    .select((eb) => eb.fn.countAll<number>().as('aggregate'))
    .executeTakeFirst()) as { aggregate: number | string } | undefined
  const total = Number(counted?.aggregate ?? 0)

  const rows = total > 0 ? await query.limit(size).offset((page - 1) * size).execute() : []
  const lastPage = Math.max(1, Math.ceil(total / size))
  const path = `${request.protocol}://${request.host}${request.url.split('?')[0]}`

  const pageUrl = (n: number) => {
    const params = new URLSearchParams(request.query as Record<string, string>)
    params.set('page', String(n))
    return `${path}?${params}`
  }

  const from = rows.length ? (page - 1) * size + 1 : null

  return {
    data: await serialize(rows),
    links: {
      first: pageUrl(1),
      last: pageUrl(lastPage),
      prev: page > 1 ? pageUrl(page - 1) : null,
      next: page < lastPage ? pageUrl(page + 1) : null
    },
    meta: {
      current_page: page,
      from,
      last_page: lastPage,
      path,
      per_page: size,
      to: from !== null ? from + rows.length - 1 : null,
      total
    }
  }
}
