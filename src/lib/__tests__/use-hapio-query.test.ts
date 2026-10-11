import { QueryClient, QueryClientProvider, type UseQueryResult } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { useHapioInfiniteQuery, useHapioQuery, useHydrated } from "@/lib/hapio/use-hapio-query"

// Server rendering is the "not hydrated yet" half of useHydrated (its server snapshot is
// false), so it shows what both the server HTML and the hydration pass render. The hydrated
// half needs a DOM renderer, which this node-only setup doesn't have; the e2e suite covers it
// (hydration-mismatch guard in the consoleGuard fixture).

function render(client: QueryClient, hook: () => unknown): Record<string, unknown> {
  let captured: unknown
  function Probe() {
    captured = hook()
    return null
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)))
  return captured as Record<string, unknown>
}

function pick(result: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, result[key]]))
}

const PENDING_KEYS = [
  "data",
  "error",
  "status",
  "fetchStatus",
  "isPending",
  "isLoading",
  "isFetching",
  "isSuccess",
  "isError",
  "isLoadingError",
  "isRefetchError",
  "isPlaceholderData",
  "isFetched",
  "isFetchedAfterMount",
  "isRefetching",
]

const PENDING = {
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
}

const never = () => new Promise<never>(() => {})

describe("useHydrated", () => {
  it("is false while rendering on the server / hydrating", () => {
    expect(render(new QueryClient(), () => ({ hydrated: useHydrated() })).hydrated).toBe(false)
  })
})

describe("useHapioQuery before hydration", () => {
  it("reports pending even when the shared cache already has data", () => {
    const client = new QueryClient()
    client.setQueryData(["hapio", "project"], { name: "Demo" })
    const result = render(client, () => useHapioQuery({ queryKey: ["hapio", "project"], queryFn: never }))
    expect(pick(result, PENDING_KEYS)).toEqual(PENDING)
  })

  it("reports pending instead of an error that is already in the cache", () => {
    const client = new QueryClient()
    const query = client.getQueryCache().build(client, { queryKey: ["hapio", "broken"] })
    query.setState({ status: "error", error: new Error("boom"), fetchStatus: "idle" })
    const result = render(client, () => useHapioQuery({ queryKey: ["hapio", "broken"], queryFn: never, retry: false }))
    expect(pick(result, PENDING_KEYS)).toEqual(PENDING)
  })

  it("leaves a query that is genuinely pending untouched", () => {
    const client = new QueryClient()
    const result = render(client, () =>
      useHapioQuery({ queryKey: ["hapio", "empty"], queryFn: never, enabled: false })
    )
    expect(result.status).toBe("pending")
    expect(result.isPending).toBe(true)
    // Not rewritten: a disabled query stays idle rather than being reported as fetching.
    expect(result.fetchStatus).toBe("idle")
  })

  it("keeps the rest of the query result (refetch etc.)", () => {
    const client = new QueryClient()
    client.setQueryData(["hapio", "x"], 1)
    const result = render(client, () => useHapioQuery({ queryKey: ["hapio", "x"], queryFn: never })) as unknown as UseQueryResult
    expect(typeof result.refetch).toBe("function")
  })
})

describe("useHapioInfiniteQuery before hydration", () => {
  it("reports pending with no further pages even when pages are cached", () => {
    const client = new QueryClient()
    client.setQueryData(["hapio", "inf"], { pages: [{ items: [1], next: 2 }], pageParams: [1] })
    const result = render(client, () =>
      useHapioInfiniteQuery({
        queryKey: ["hapio", "inf"],
        queryFn: never,
        initialPageParam: 1,
        getNextPageParam: (last: { next: number }) => last.next,
        getPreviousPageParam: () => 0,
      })
    )
    expect(pick(result, PENDING_KEYS)).toEqual(PENDING)
    expect(
      pick(result, [
        "hasNextPage",
        "hasPreviousPage",
        "isFetchingNextPage",
        "isFetchingPreviousPage",
        "isFetchNextPageError",
        "isFetchPreviousPageError",
      ])
    ).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      isFetchingNextPage: false,
      isFetchingPreviousPage: false,
      isFetchNextPageError: false,
      isFetchPreviousPageError: false,
    })
  })
})
