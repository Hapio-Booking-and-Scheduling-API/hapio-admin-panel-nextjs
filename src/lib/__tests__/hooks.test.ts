import { describe, expect, it } from "vitest"

import { HapioApiError } from "@/lib/hapio/errors"
import { hapioKey, indexById, toastUnlessFieldErrors } from "@/lib/hapio/hooks"

// The hooks themselves need a React client renderer; these are the pure helpers next to them.

describe("hapioKey", () => {
  it("prefixes every key with 'hapio' so one invalidation refreshes all queries", () => {
    expect(hapioKey()).toEqual(["hapio"])
    expect(hapioKey("locations", "list", { page: 2 })).toEqual(["hapio", "locations", "list", { page: 2 }])
    expect(hapioKey("locations", "detail", undefined)).toEqual(["hapio", "locations", "detail", undefined])
  })
})

describe("toastUnlessFieldErrors", () => {
  const error = (status: number, errors?: Record<string, string[]>) =>
    new HapioApiError({ status, message: "x", errors })

  it("doesn't toast a 422 with field errors (the form shows them inline)", () => {
    expect(toastUnlessFieldErrors(error(422, { name: ["Required."] }))).toBe(false)
  })

  it("toasts a 422 without field errors", () => {
    expect(toastUnlessFieldErrors(error(422))).toBe(true)
    expect(toastUnlessFieldErrors(error(422, {}))).toBe(true)
  })

  it("toasts every other error", () => {
    expect(toastUnlessFieldErrors(error(500, { name: ["x"] }))).toBe(true)
    expect(toastUnlessFieldErrors(error(404))).toBe(true)
    expect(toastUnlessFieldErrors(new Error("x"))).toBe(true)
    expect(toastUnlessFieldErrors(undefined)).toBe(true)
  })
})

describe("indexById", () => {
  it("maps ids to items and tolerates undefined", () => {
    const a = { id: "a", name: "A" }
    const b = { id: "b", name: "B" }
    const map = indexById([a, b])
    expect(map.get("a")).toBe(a)
    expect(map.get("b")).toBe(b)
    expect(map.size).toBe(2)
    expect(indexById(undefined).size).toBe(0)
  })

  it("keeps the last item for a duplicate id", () => {
    expect(indexById([{ id: "a", n: 1 }, { id: "a", n: 2 }]).get("a")).toEqual({ id: "a", n: 2 })
  })
})
