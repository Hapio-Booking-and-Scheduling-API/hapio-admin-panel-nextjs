"use client"

import {
  parseAsInteger,
  parseAsString,
  useQueryState,
  useQueryStates,
  type UrlKeys,
  type UseQueryStatesKeysMap,
  type Values,
} from "nuqs"
import { useCallback, useMemo } from "react"

import type { PaginationState } from "@/components/data-table/data-table"

// Sub-lists on the resource detail page keep their state in the URL under a
// prefix (e.g. `sb_page`, `rs_location`), so tabs don't share `page`/`sort`
// and the state survives switching tabs.

function prefixedKeys<P extends object>(prefix: string, parsers: P): UrlKeys<P> {
  return Object.fromEntries(Object.keys(parsers).map((key) => [key, `${prefix}_${key}`])) as UrlKeys<P>
}

const listParsers = {
  page: parseAsInteger.withDefault(1),
  per_page: parseAsInteger.withDefault(25),
  sort: parseAsString.withDefault(""),
}

/** Page, page size and sort for a sub-list, kept in the URL under `prefix`. */
export function usePrefixedListState(prefix: string) {
  const urlKeys = useMemo(() => prefixedKeys(prefix, listParsers), [prefix])
  const [state, setState] = useQueryStates(listParsers, { history: "replace", urlKeys })

  const pagination: PaginationState = {
    page: Math.max(1, state.page),
    perPage: Math.min(100, Math.max(1, state.per_page)),
    onPageChange: (page) => void setState({ page: page <= 1 ? null : page }),
    onPerPageChange: (perPage) => void setState({ per_page: perPage === 25 ? null : perPage, page: null }),
  }

  return {
    ...pagination,
    pagination,
    sort: state.sort,
    setSort: (sort: string) => void setState({ sort: sort || null, page: null }),
  }
}

/** Filters for a sub-list, kept in the URL under `prefix`. Changing a filter resets its page. */
export function usePrefixedFilters<P extends UseQueryStatesKeysMap>(prefix: string, parsers: P) {
  const urlKeys = useMemo(() => prefixedKeys(prefix, parsers), [prefix, parsers])
  const [filters, setFilters] = useQueryStates(parsers, { history: "replace", urlKeys })
  const [, setPage] = useQueryState(`${prefix}_page`, parseAsInteger)

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
