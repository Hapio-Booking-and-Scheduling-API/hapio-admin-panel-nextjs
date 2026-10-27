import { QueryClient } from "@tanstack/react-query"

import { adminConfig } from "@/lib/admin-config"

import { isHapioError } from "./errors"

/** Retry 429s up to three times and 5xx once; never retry other 4xx or a missing token. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isHapioError(error)) {
    if (error.status === 429) return failureCount < 3
    if (error.status >= 500 && !error.isNotConfigured) return failureCount < 1
    return false
  }
  return failureCount < 1
}

/** Honour Retry-After when the API sends it, otherwise back off exponentially (max 10 s). */
export function retryDelay(attempt: number, error: unknown): number {
  return isHapioError(error) && error.retryAfter
    ? error.retryAfter * 1000
    : Math.min(1000 * 2 ** attempt, 10_000)
}

export function makeQueryClient(refetchInterval: number | false = adminConfig.refetchInterval) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Hapio rate-limits per minute; don't refetch on every focus.
        refetchOnWindowFocus: false,
        retry: shouldRetry,
        retryDelay,
      },
    },
  })

  // Bookings made elsewhere (NEXT_PUBLIC_ADMIN_REFETCH_INTERVAL) show up by
  // themselves. Only while the tab is visible: TanStack pauses it otherwise.
  if (refetchInterval) {
    client.setQueryDefaults(["hapio", "bookings"], { refetchInterval, refetchIntervalInBackground: false })
  }

  return client
}
