"use client"

import {
  parseAsInteger,
  parseAsString,
  useQueryState,
  useQueryStates,
  type UseQueryStatesKeysMap,
  type Values,
} from "nuqs"
import { useCallback } from "react"

export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const

/** Page, page size and sort, kept in the URL. */
export function useListState(defaultSort = "", defaultPerPage = 25) {
  const [state, setState] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      per_page: parseAsInteger.withDefault(defaultPerPage),
      sort: parseAsString.withDefault(defaultSort),
    },
    { history: "replace" }
  )

  return {
    page: Math.max(1, state.page),
    perPage: Math.min(100, Math.max(1, state.per_page)),
    sort: state.sort,
    setPage: (page: number) => setState({ page: page <= 1 ? null : page }),
    setPerPage: (perPage: number) =>
      setState({ per_page: perPage === defaultPerPage ? null : perPage, page: null }),
    setSort: (sort: string) => setState({ sort: sort === defaultSort ? null : sort, page: null }),
  }
}

/** Filter values kept in the URL. Changing a filter resets to page 1. */
export function useListFilters<P extends UseQueryStatesKeysMap>(parsers: P) {
  const [filters, setFilters] = useQueryStates(parsers, { history: "replace" })
  const [, setPage] = useQueryState("page", parseAsInteger)

  const update = useCallback(
    (patch: Partial<{ [K in keyof P]: Values<P>[K] | null }>) => {
      void setPage(null)
      void setFilters(patch as Parameters<typeof setFilters>[0])
    },
    [setFilters, setPage]
  )

  const reset = useCallback(() => {
    void setPage(null)
    void setFilters(null)
  }, [setFilters, setPage])

  return [filters, update, reset] as const
}
