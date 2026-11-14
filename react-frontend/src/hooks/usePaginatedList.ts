import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataTableStateEvent } from 'primereact/datatable'
import type { ListParams, Paginated } from '../types/api'
import { useNotify } from './useNotify'

/**
 * State for a server-paginated, filterable table (PrimeReact DataTable in lazy mode).
 *
 *   const list = usePaginatedList(patientsApi.list, { search: '' })
 *   <DataTable lazy value={list.items} totalRecords={list.total} first={list.first} rows={list.rows} onPage={list.onPage} />
 *
 * Filters live in a ref so `search()` / `load()` always read the latest values,
 * like the reactive filters object of the Vue composable.
 */
export function usePaginatedList<T, F extends ListParams = ListParams>(
  fetcher: (params: ListParams) => Promise<Paginated<T>>,
  initialFilters: F = {} as F,
  perPage = 15
) {
  const notify = useNotify()
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState(perPage)
  const [filters, setFiltersState] = useState<F>({ ...initialFilters })

  const state = useRef({ filters: { ...initialFilters } as F, page: 1, rows: perPage })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  // Ignore responses from superseded requests (fast typing in a search box)
  const requestId = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const current = ++requestId.current
    setLoading(true)
    try {
      const { filters: f, page: p, rows: r } = state.current
      const response = await fetcherRef.current({ ...f, page: p, per_page: r })
      if (current !== requestId.current) return
      setItems(response.data)
      setTotal(response.meta.total)
    } catch (err) {
      if (current === requestId.current) notify.error(err)
    } finally {
      if (current === requestId.current) setLoading(false)
    }
  }, [notify])

  const onPage = useCallback(
    (event: DataTableStateEvent) => {
      const nextPage = (event.page ?? 0) + 1
      state.current.page = nextPage
      state.current.rows = event.rows
      setPage(nextPage)
      setRows(event.rows)
      void load()
    },
    [load]
  )

  /** Update one or more filters (does not reload: call search()) */
  const setFilters = useCallback((patch: Partial<F>) => {
    state.current.filters = { ...state.current.filters, ...patch }
    setFiltersState(state.current.filters)
  }, [])

  /** Reset to page 1 after a filter change */
  const search = useCallback((): Promise<void> => {
    state.current.page = 1
    setPage(1)
    return load()
  }, [load])

  // Unmount: ignore whatever is still in flight
  useEffect(() => () => void requestId.current++, [])

  return { items, total, loading, page, rows, first: (page - 1) * rows, filters, setFilters, load, onPage, search }
}
