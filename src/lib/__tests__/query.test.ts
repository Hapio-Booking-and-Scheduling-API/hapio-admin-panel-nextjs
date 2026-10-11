import { describe, expect, it } from "vitest"
import { buildQuery, METADATA_OPERATORS, OPERATOR_LABELS, OPERATORS, toSearchParams } from "@/lib/hapio/query"

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

describe("toSearchParams: value types", () => {
  it("stringifies numbers and booleans and keeps 0 and false", () => {
    expect(decoded({ page: 0, per_page: 25, flag: true, off: false })).toBe("?page=0&per_page=25&flag=true&off=false")
  })

  it("returns an empty URLSearchParams without params", () => {
    expect(toSearchParams(undefined).toString()).toBe("")
    expect(buildQuery(undefined)).toBe("")
    expect(buildQuery({})).toBe("")
  })

  it("drops empty entries from arrays and skips arrays that end up empty", () => {
    expect(decoded({ sort: ["a.asc", "", null as unknown as string, "b.desc"] })).toBe("?sort=a.asc,b.desc")
    expect(decoded({ sort: ["", ""] })).toBe("")
    expect(decoded({ sort: [] })).toBe("")
    expect(decoded({ ids: [1, 0, 2] })).toBe("?ids=1,0,2")
  })

  it("skips empty operator values but keeps 0", () => {
    expect(decoded({ price: { gte: "", lt: "500.000" } })).toBe("?price[lt]=500.000")
    expect(decoded({ max_simultaneous_bookings: { gte: 0 } })).toBe("?max_simultaneous_bookings[gte]=0")
    expect(decoded({ price: { gte: "", lt: undefined } })).toBe("")
  })

  it("allows several operators on one key", () => {
    expect(decoded({ price: { gt: "1.000", lte: "9.000", eq: "5.000" } })).toBe(
      "?price[gt]=1.000&price[lte]=9.000&price[eq]=5.000"
    )
  })
})

describe("toSearchParams: metadata filters", () => {
  it("skips filters with an empty or blank property, or an empty value, and trims properties", () => {
    expect(
      decoded({
        metadata: [
          { property: "  ", operator: "eq", value: "x" },
          { property: "a", operator: "eq", value: "" },
          { property: " floor ", operator: "gte", value: "2" },
        ],
      })
    ).toBe("?metadata[floor][gte]=2")
  })

  it("emits nothing when every filter is skipped", () => {
    expect(decoded({ metadata: [{ property: "", operator: "eq", value: "" }] })).toBe("")
  })

  it("encodes '->' paths and brackets in the raw query string", () => {
    const qs = buildQuery({ protected_metadata: [{ property: "customer->name", operator: "seq", value: "Ann" }] })
    expect(qs).toBe("?protected_metadata%5Bcustomer-%3Ename%5D%5Bseq%5D=Ann")
    expect(toSearchParams({ protected_metadata: [{ property: "a->b->c", operator: "eq", value: "1" }] }).get(
      "protected_metadata[a->b->c][eq]"
    )).toBe("1")
  })

  it("repeats the same property with different operators", () => {
    expect(
      decoded({
        metadata: [
          { property: "floor", operator: "gte", value: "2" },
          { property: "floor", operator: "lt", value: "5" },
        ],
      })
    ).toBe("?metadata[floor][gte]=2&metadata[floor][lt]=5")
  })

  it("serialises group metadata keys the same way", () => {
    expect(
      decoded({ group_metadata: [{ property: "customer->name", operator: "seq", value: "Lindqvist" }] })
    ).toBe("?group_metadata[customer->name][seq]=Lindqvist")
  })
})

describe("operators", () => {
  it("has a label for every metadata operator and nothing else", () => {
    expect(Object.keys(OPERATOR_LABELS).sort()).toEqual([...METADATA_OPERATORS].sort())
    for (const op of METADATA_OPERATORS) expect(OPERATOR_LABELS[op]).toBeTruthy()
  })

  it("metadata operators extend the comparison operators with string variants", () => {
    expect([...OPERATORS]).toEqual(["eq", "lt", "lte", "gt", "gte"])
    expect(METADATA_OPERATORS.slice(0, OPERATORS.length)).toEqual([...OPERATORS])
    expect(METADATA_OPERATORS.slice(OPERATORS.length)).toEqual(["seq", "slt", "slte", "sgt", "sgte"])
    expect(OPERATOR_LABELS.seq).toBe("= (string)")
    expect(OPERATOR_LABELS.gte).toBe("≥")
  })
})
