import { describe, expect, it } from "vitest"
import { buildQuery, toSearchParams } from "@/lib/hapio/query"

const decoded = (params: Parameters<typeof buildQuery>[0]) =>
  decodeURIComponent(buildQuery(params))

describe("buildQuery", () => {
  it("drops empty values", () => {
    expect(buildQuery({ a: undefined, b: null, c: "" })).toBe("")
  })

  it("serialises simple values", () => {
    expect(decoded({ page: 2, per_page: 50, disabled: "include" })).toBe(
      "?page=2&per_page=50&disabled=include"
    )
  })

  it("serialises operator filters", () => {
    expect(decoded({ starts_at: { gte: "2024-01-01T00:00:00+01:00", lt: "2024-02-01T00:00:00+01:00" } })).toBe(
      "?starts_at[gte]=2024-01-01T00:00:00+01:00&starts_at[lt]=2024-02-01T00:00:00+01:00"
    )
  })

  it("encodes the + of offsets so it survives the query string", () => {
    const params = toSearchParams({ from: "2024-01-01T00:00:00+01:00" })
    expect(params.toString()).toContain("%2B01%3A00")
    expect(params.get("from")).toBe("2024-01-01T00:00:00+01:00")
  })

  it("serialises metadata filters with nested properties", () => {
    expect(
      decoded({
        metadata: [
          { property: "customer->name", operator: "eq", value: "John" },
          { property: "rank", operator: "sgt", value: "b" },
          { property: "", operator: "eq", value: "ignored" },
        ],
      })
    ).toBe("?metadata[customer->name][eq]=John&metadata[rank][sgt]=b")
  })

  it("joins arrays with commas (sort)", () => {
    expect(decoded({ sort: ["starts_at.desc", "created_at.asc"] })).toBe(
      "?sort=starts_at.desc,created_at.asc"
    )
  })
})
