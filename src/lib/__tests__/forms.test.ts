import { describe, expect, it } from "vitest"
import type { z } from "zod"

import {
  durationValue,
  metadataText,
  nullableDurationValue,
  pickDirty,
  priceText,
  textToMetadata,
  textToPrice,
} from "@/lib/forms"

function issues(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe("metadataText", () => {
  it("accepts empty text, null and JSON objects", () => {
    for (const value of ["", "   ", "null", '{"a":1}', '{\n  "nested": { "b": [1, 2] }\n}']) {
      expect(issues(metadataText(), value)).toEqual([])
    }
  })

  it("reports the parse error for invalid JSON and the object rule for other JSON", () => {
    expect(issues(metadataText(), "{bad")).toHaveLength(1)
    expect(issues(metadataText(), "[1,2]")).toEqual(["Metadata must be a JSON object."])
    expect(issues(metadataText(), '"text"')).toEqual(["Metadata must be a JSON object."])
    expect(issues(metadataText(), "42")).toEqual(["Metadata must be a JSON object."])
  })

  it("enforces the 1000-character encoded limit", () => {
    expect(issues(metadataText(), JSON.stringify({ a: "x".repeat(992) }))).toEqual([])
    expect(issues(metadataText(), JSON.stringify({ a: "x".repeat(993) }))).toEqual([
      "Metadata can be at most 1000 characters when encoded.",
    ])
  })

  it("rejects non-strings", () => {
    expect(issues(metadataText(), null)).not.toEqual([])
  })
})

describe("priceText", () => {
  const message = "Use a number with up to 12 digits and 3 decimals, e.g. 149.000"

  it("accepts empty and valid prices", () => {
    for (const value of ["", "0", "149", "149.5", "12,5", "149.000", "123456789012.999"]) {
      expect(issues(priceText(), value)).toEqual([])
    }
  })

  it("rejects invalid prices with one message", () => {
    for (const value of ["abc", "1.2345", "-5", "1234567890123", "1.2.3"]) {
      expect(issues(priceText(), value)).toEqual([message])
    }
  })
})

describe("durationValue", () => {
  it("requires a value", () => {
    expect(issues(durationValue(), "")[0]).toBe("Required")
  })

  it("rejects invalid ISO 8601 durations", () => {
    for (const value of ["1H", "PT", "P1WT1H", "PT1.5H"]) {
      expect(issues(durationValue(), value)).toEqual(["Not a valid ISO 8601 duration (e.g. PT1H30M)"])
    }
  })

  it("allows zero by default and with allowZero: true", () => {
    expect(issues(durationValue(), "PT0S")).toEqual([])
    expect(issues(durationValue({ allowZero: true }), "P0D")).toEqual([])
  })

  it("rejects zero with allowZero: false", () => {
    expect(issues(durationValue({ allowZero: false }), "PT0S")).toEqual(["Must be longer than zero"])
    expect(issues(durationValue({ allowZero: false }), "PT15M")).toEqual([])
  })

  it("rejects null", () => {
    expect(issues(durationValue(), null)).not.toEqual([])
  })
})

describe("nullableDurationValue", () => {
  it("accepts null and valid durations", () => {
    expect(issues(nullableDurationValue(), null)).toEqual([])
    expect(issues(nullableDurationValue(), "P30D")).toEqual([])
    expect(issues(nullableDurationValue({ allowZero: false }), null)).toEqual([])
  })

  it("rejects invalid durations, including the empty string", () => {
    expect(issues(nullableDurationValue(), "nope")).toEqual(["Not a valid ISO 8601 duration (e.g. PT1H30M)"])
    expect(issues(nullableDurationValue(), "")).toEqual(["Not a valid ISO 8601 duration (e.g. PT1H30M)"])
  })

  it("applies allowZero like durationValue", () => {
    expect(issues(nullableDurationValue(), "PT0S")).toEqual([])
    expect(issues(nullableDurationValue({ allowZero: false }), "PT0S")).toEqual(["Must be longer than zero"])
  })
})

describe("textToMetadata / textToPrice", () => {
  it("parses metadata text, mapping empty and invalid text to null", () => {
    expect(textToMetadata('{"a":1}')).toEqual({ a: 1 })
    expect(textToMetadata("")).toBeNull()
    expect(textToMetadata("  ")).toBeNull()
    expect(textToMetadata("null")).toBeNull()
    expect(textToMetadata("{bad")).toBeNull()
    expect(textToMetadata("[1]")).toBeNull()
  })

  it("normalises prices, mapping empty and invalid text to null", () => {
    expect(textToPrice("149")).toBe("149.000")
    expect(textToPrice("12,5")).toBe("12.500")
    expect(textToPrice("")).toBeNull()
    expect(textToPrice("abc")).toBeNull()
  })
})

describe("pickDirty", () => {
  const values = { name: "A", priority: ["x", "y"], times: { monday: "09:00:00" }, rows: [{ a: 1 }], untouched: 1 }

  it("keeps fields marked true", () => {
    expect(pickDirty(values, { name: true })).toEqual({ name: "A" })
  })

  it("drops fields marked false or missing", () => {
    expect(pickDirty(values, { name: false })).toEqual({})
    expect(pickDirty(values, {})).toEqual({})
  })

  it("treats arrays with at least one truthy entry as dirty", () => {
    expect(pickDirty(values, { priority: [false, true] })).toEqual({ priority: ["x", "y"] })
    expect(pickDirty(values, { priority: [false, false] })).toEqual({})
    expect(pickDirty(values, { priority: [] })).toEqual({})
  })

  it("treats objects with at least one truthy value as dirty", () => {
    expect(pickDirty(values, { times: { monday: true } })).toEqual({ times: { monday: "09:00:00" } })
    expect(pickDirty(values, { times: { monday: false } })).toEqual({})
    expect(pickDirty(values, { times: {} })).toEqual({})
  })

  it("counts any object entry in an array as dirty, even an empty one ([{}]) — entries are not inspected", () => {
    // Documented current behaviour: only the booking group form passes arrays of objects,
    // and it re-derives booking changes itself (planPatch), so this has no visible effect.
    expect(pickDirty(values, { rows: [{ a: true }] })).toEqual({ rows: [{ a: 1 }] })
    expect(pickDirty(values, { rows: [{}] })).toEqual({ rows: [{ a: 1 }] })
  })

  it("returns the current values of dirty fields, not the dirty flags", () => {
    const out = pickDirty(values, { name: true, priority: [true], times: { monday: true }, untouched: false })
    expect(out).toEqual({ name: "A", priority: ["x", "y"], times: { monday: "09:00:00" } })
    expect("untouched" in out).toBe(false)
  })

  it("ignores dirty flags for keys that are not in values", () => {
    expect(pickDirty({ a: 1 } as Record<string, unknown>, { b: true })).toEqual({})
  })
})
