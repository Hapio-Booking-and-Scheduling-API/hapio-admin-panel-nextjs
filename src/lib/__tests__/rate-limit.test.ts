import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The store is module state, so every test loads a fresh copy.
async function load() {
  vi.resetModules()
  return import("@/lib/hapio/rate-limit")
}

const headers = (init: Record<string, string>) => new Headers(init)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-21T06:00:00Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("rate-limit store", () => {
  it("starts empty", async () => {
    const { getRateLimit } = await load()
    expect(getRateLimit()).toEqual({ limit: null, remaining: null, updatedAt: null })
  })

  it("records both headers as numbers with a timestamp", async () => {
    const { getRateLimit, recordRateLimit } = await load()
    recordRateLimit(headers({ "X-RateLimit-Limit": "200", "X-RateLimit-Remaining": "150" }))
    expect(getRateLimit()).toEqual({ limit: 200, remaining: 150, updatedAt: Date.parse("2026-10-21T06:00:00Z") })
  })

  it("keeps the previous value of a header that is missing", async () => {
    const { getRateLimit, recordRateLimit } = await load()
    recordRateLimit(headers({ "x-ratelimit-limit": "200", "x-ratelimit-remaining": "150" }))
    vi.setSystemTime(new Date("2026-10-21T06:00:05Z"))
    recordRateLimit(headers({ "x-ratelimit-remaining": "149" }))
    expect(getRateLimit()).toEqual({ limit: 200, remaining: 149, updatedAt: Date.parse("2026-10-21T06:00:05Z") })
    recordRateLimit(headers({ "x-ratelimit-limit": "300" }))
    expect(getRateLimit()).toMatchObject({ limit: 300, remaining: 149 })
  })

  it("ignores responses without rate-limit headers (same snapshot, no notification)", async () => {
    const { getRateLimit, recordRateLimit, subscribeRateLimit } = await load()
    recordRateLimit(headers({ "x-ratelimit-limit": "200", "x-ratelimit-remaining": "150" }))
    const before = getRateLimit()
    const listener = vi.fn()
    subscribeRateLimit(listener)
    recordRateLimit(headers({ "content-type": "application/json" }))
    expect(getRateLimit()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it("replaces the snapshot object on every update (useSyncExternalStore needs a new reference)", async () => {
    const { getRateLimit, recordRateLimit } = await load()
    const first = getRateLimit()
    expect(getRateLimit()).toBe(first)
    recordRateLimit(headers({ "x-ratelimit-remaining": "10" }))
    const second = getRateLimit()
    expect(second).not.toBe(first)
    expect(first).toEqual({ limit: null, remaining: null, updatedAt: null })
  })

  it("passes header values through Number() (non-numeric becomes NaN)", async () => {
    const { getRateLimit, recordRateLimit } = await load()
    recordRateLimit(headers({ "x-ratelimit-remaining": "lots" }))
    expect(getRateLimit().remaining).toBeNaN()
  })

  it("notifies subscribers until they unsubscribe", async () => {
    const { recordRateLimit, subscribeRateLimit } = await load()
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribeA = subscribeRateLimit(a)
    subscribeRateLimit(b)
    recordRateLimit(headers({ "x-ratelimit-remaining": "5" }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    unsubscribeA()
    recordRateLimit(headers({ "x-ratelimit-remaining": "4" }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it("subscribing the same listener twice registers it once", async () => {
    const { recordRateLimit, subscribeRateLimit } = await load()
    const listener = vi.fn()
    subscribeRateLimit(listener)
    subscribeRateLimit(listener)
    recordRateLimit(headers({ "x-ratelimit-remaining": "5" }))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("has a stable, empty server snapshot that client updates don't touch", async () => {
    const { getServerRateLimit, recordRateLimit } = await load()
    const server = getServerRateLimit()
    expect(server).toEqual({ limit: null, remaining: null, updatedAt: null })
    recordRateLimit(headers({ "x-ratelimit-limit": "200", "x-ratelimit-remaining": "1" }))
    expect(getServerRateLimit()).toBe(server)
    expect(server).toEqual({ limit: null, remaining: null, updatedAt: null })
  })
})
