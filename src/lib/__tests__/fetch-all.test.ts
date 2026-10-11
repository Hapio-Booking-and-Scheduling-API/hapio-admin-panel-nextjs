import { describe, expect, it, vi } from "vitest"

import { fetchAll, MAX_PAGES } from "@/lib/hapio/fetch-all"
import type { Paginated } from "@/lib/hapio/types"

function page(n: number, lastPage: number, perPage = 2): Paginated<string> {
  return {
    data: Array.from({ length: perPage }, (_, i) => `p${n}-${i}`),
    links: { first: "", last: "", prev: null, next: null },
    meta: { current_page: n, last_page: lastPage, per_page: perPage, total: lastPage * perPage, from: 1, to: perPage, path: "" },
  }
}

function loader(lastPage: number) {
  return vi.fn<(n: number, signal?: AbortSignal) => Promise<Paginated<string>>>(async (n) => page(n, lastPage))
}

describe("fetchAll", () => {
  it("returns a single page without further requests", async () => {
    const load = loader(1)
    await expect(fetchAll(load)).resolves.toEqual(["p1-0", "p1-1"])
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(1, undefined)
  })

  it("handles an empty first page", async () => {
    const load = vi.fn(async () => ({ ...page(1, 1), data: [] }) as Paginated<string>)
    await expect(fetchAll(load)).resolves.toEqual([])
  })

  it("loads every page in order and concatenates the items", async () => {
    const load = loader(3)
    await expect(fetchAll(load)).resolves.toEqual(["p1-0", "p1-1", "p2-0", "p2-1", "p3-0", "p3-1"])
    expect(load.mock.calls.map(([n]) => n)).toEqual([1, 2, 3])
  })

  it("loads pages one after another", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const load = vi.fn(async (n: number) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      return page(n, 4)
    })
    await fetchAll(load)
    expect(maxInFlight).toBe(1)
  })

  it(`stops after MAX_PAGES (${MAX_PAGES}) pages`, async () => {
    expect(MAX_PAGES).toBe(20)
    const load = loader(35)
    const items = await fetchAll(load)
    expect(load).toHaveBeenCalledTimes(20)
    expect(load.mock.calls.at(-1)?.[0]).toBe(20)
    expect(items).toHaveLength(40)
  })

  it("passes the signal to every page", async () => {
    const controller = new AbortController()
    const load = loader(3)
    await fetchAll(load, controller.signal)
    for (const [, signal] of load.mock.calls) expect(signal).toBe(controller.signal)
  })

  it("rejects when a later page fails", async () => {
    const error = new Error("page 2 failed")
    const load = vi.fn(async (n: number) => {
      if (n === 2) throw error
      return page(n, 3)
    })
    await expect(fetchAll(load)).rejects.toBe(error)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
