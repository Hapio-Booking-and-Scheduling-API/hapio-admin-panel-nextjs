"use client"

import {
  useInfiniteQuery,
  useQuery,
  type DefaultError,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/** False on the server and while React hydrates; true once the client has taken over. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
}

// The server renders every query as pending. Queries share one cache, so by the time a
// later Suspense boundary hydrates, a query started by an earlier one (the sidebar's
// project name, say) may already have data or an error. Rendering that during hydration
// wouldn't match the server HTML (React error #418), so report "pending" until hydrated.
function pendingDuringHydration<T extends UseQueryResult<unknown, unknown>>(result: T, hydrated: boolean): T {
  if (hydrated || result.isPending) return result
  return {
    ...result,
    data: undefined,
    error: null,
    status: "pending",
    fetchStatus: "fetching",
    isPending: true,
    isLoading: true,
    isFetching: true,
    isSuccess: false,
    isError: false,
    isLoadingError: false,
    isRefetchError: false,
    isPlaceholderData: false,
    isFetched: false,
    isFetchedAfterMount: false,
    isRefetching: false,
  } as T
}

/** `useQuery` that renders the same pending state as the server until hydration is done. */
export function useHapioQuery<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>
): UseQueryResult<TData, TError> {
  const hydrated = useHydrated()
  return pendingDuringHydration(useQuery(options), hydrated)
}

/** `useInfiniteQuery` with the same hydration guard as `useHapioQuery`. */
export function useHapioInfiniteQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  options: UseInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>
): UseInfiniteQueryResult<TData, TError> {
  const hydrated = useHydrated()
  const result = useInfiniteQuery(options)
  if (hydrated || result.isPending) return result
  return {
    ...pendingDuringHydration(result, false),
    hasNextPage: false,
    hasPreviousPage: false,
    isFetchingNextPage: false,
    isFetchingPreviousPage: false,
    isFetchNextPageError: false,
    isFetchPreviousPageError: false,
  } as UseInfiniteQueryResult<TData, TError>
}
