import { afterEach, describe, expect, it, vi } from "vitest"

import { HapioApiError } from "@/lib/hapio/errors"
import { makeQueryClient, retryDelay, shouldRetry } from "@/lib/hapio/query-client"

const hapioError = (status: number, extra: { code?: string; retryAfter?: number } = {}) =>
  new HapioApiError({ status, message: "x", ...extra })

/** How many retries shouldRetry allows, following TanStack's failureCount (0 on the first failure). */
function retriesAllowed(error: unknown): number {
  let n = 0
  while (shouldRetry(n, error) && n < 50) n++
  return n
}

describe("shouldRetry", () => {
  it("retries 429 up to three times", () => {
    const error = hapioError(429)
    expect(shouldRetry(0, error)).toBe(true)
    expect(shouldRetry(2, error)).toBe(true)
    expect(shouldRetry(3, error)).toBe(false)
    expect(retriesAllowed(error)).toBe(3)
  })

  it.each([500, 502, 503, 504])("retries %i once", (status) => {
    expect(retriesAllowed(hapioError(status))).toBe(1)
  })

  it("never retries a missing token (500 HAPIO_NOT_CONFIGURED)", () => {
    expect(retriesAllowed(hapioError(500, { code: "HAPIO_NOT_CONFIGURED" }))).toBe(0)
  })

  it.each([400, 401, 403, 404, 409, 422])("never retries %i", (status) => {
    expect(retriesAllowed(hapioError(status))).toBe(0)
  })

  it("never retries a network failure (status 0) — current behaviour", () => {
    expect(retriesAllowed(hapioError(0))).toBe(0)
  })

  it("retries errors that are not HapioApiErrors once", () => {
    expect(retriesAllowed(new TypeError("boom"))).toBe(1)
    expect(retriesAllowed("weird")).toBe(1)
  })
})

describe("retryDelay", () => {
  it("waits Retry-After seconds when the error carries it", () => {
    expect(retryDelay(0, hapioError(429, { retryAfter: 5 }))).toBe(5000)
    expect(retryDelay(3, hapioError(429, { retryAfter: 60 }))).toBe(60_000)
  })

  it("backs off exponentially from 1 s, capped at 10 s", () => {
    const error = hapioError(503)
    expect([0, 1, 2, 3, 4, 10].map((attempt) => retryDelay(attempt, error))).toEqual([
      1000, 2000, 4000, 8000, 10_000, 10_000,
    ])
  })

  it("ignores a zero or NaN Retry-After and other error types", () => {
    expect(retryDelay(1, hapioError(429, { retryAfter: 0 }))).toBe(2000)
    expect(retryDelay(1, hapioError(429, { retryAfter: Number.NaN }))).toBe(2000)
    expect(retryDelay(2, new Error("x"))).toBe(4000)
  })
})

describe("makeQueryClient", () => {
  it("sets the query defaults", () => {
    const queries = makeQueryClient().getDefaultOptions().queries
    expect(queries?.staleTime).toBe(30_000)
    expect(queries?.refetchOnWindowFocus).toBe(false)
    expect(queries?.retry).toBe(shouldRetry)
    expect(queries?.retryDelay).toBe(retryDelay)
  })

  it("returns a new client each time", () => {
    expect(makeQueryClient()).not.toBe(makeQueryClient())
  })

  describe("retries in practice", () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    async function attempts(error: unknown) {
      vi.useFakeTimers()
      const client = makeQueryClient()
      const queryFn = vi.fn(async () => {
        throw error
      })
      const result = client.fetchQuery({ queryKey: ["t"], queryFn }).catch((e: unknown) => e)
      await vi.runAllTimersAsync()
      expect(await result).toBe(error)
      client.clear()
      return queryFn.mock.calls.length
    }

    it("calls the API four times for a persistent 429", async () => {
      expect(await attempts(hapioError(429, { retryAfter: 1 }))).toBe(4)
    })

    it("calls the API twice for a persistent 500", async () => {
      expect(await attempts(hapioError(500))).toBe(2)
    })

    it("calls the API once for a 404 and for a missing token", async () => {
      expect(await attempts(hapioError(404))).toBe(1)
      expect(await attempts(hapioError(500, { code: "HAPIO_NOT_CONFIGURED" }))).toBe(1)
    })

    it("waits the Retry-After time between 429 attempts", async () => {
      vi.useFakeTimers()
      const client = makeQueryClient()
      const queryFn = vi.fn(async () => {
        throw hapioError(429, { retryAfter: 2 })
      })
      const result = client.fetchQuery({ queryKey: ["t"], queryFn }).catch(() => "failed")
      await vi.advanceTimersByTimeAsync(0)
      expect(queryFn).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1999)
      expect(queryFn).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(queryFn).toHaveBeenCalledTimes(2)
      await vi.runAllTimersAsync()
      expect(await result).toBe("failed")
      client.clear()
    })
  })
})
