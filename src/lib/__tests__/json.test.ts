import { describe, expect, it } from "vitest"

import {
  encodedMetadataLength,
  METADATA_MAX_LENGTH,
  metadataError,
  metadataToText,
  omitKeys,
  parseMetadataText,
} from "@/lib/format/json"

describe("parseMetadataText", () => {
  it("maps empty and whitespace-only text to null", () => {
    expect(parseMetadataText("")).toEqual({ ok: true, value: null })
    expect(parseMetadataText(" \n\t ")).toEqual({ ok: true, value: null })
  })

  it("maps JSON null to null", () => {
    expect(parseMetadataText("null")).toEqual({ ok: true, value: null })
    expect(parseMetadataText("  null  ")).toEqual({ ok: true, value: null })
  })

  it("parses objects (surrounding whitespace allowed)", () => {
    expect(parseMetadataText('  {"address":"Main St","floor":2,"tags":["a"]}  ')).toEqual({
      ok: true,
      value: { address: "Main St", floor: 2, tags: ["a"] },
    })
    expect(parseMetadataText("{}")).toEqual({ ok: true, value: {} })
  })

  it("rejects arrays and primitives", () => {
    for (const text of ["[]", '[{"a":1}]', "1", '"text"', "true"]) {
      expect(parseMetadataText(text)).toEqual({ ok: false, error: "Metadata must be a JSON object." })
    }
  })

  it("returns the JSON.parse message for invalid JSON", () => {
    const parsed = parseMetadataText("{bad json")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).not.toBe("")
      expect(parsed.error).not.toBe("Metadata must be a JSON object.")
    }
  })

  it("allows exactly 1000 encoded characters and rejects 1001", () => {
    expect(METADATA_MAX_LENGTH).toBe(1000)
    const atLimit = { a: "x".repeat(992) }
    expect(JSON.stringify(atLimit)).toHaveLength(1000)
    expect(parseMetadataText(JSON.stringify(atLimit, null, 2)).ok).toBe(true)

    const over = { a: "x".repeat(993) }
    expect(parseMetadataText(JSON.stringify(over))).toEqual({
      ok: false,
      error: "Metadata can be at most 1000 characters when encoded.",
    })
  })

  it("measures the compact encoding, not the pretty-printed text", () => {
    const value = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]))
    const pretty = JSON.stringify(value, null, 8)
    expect(pretty.length).toBeGreaterThan(METADATA_MAX_LENGTH)
    expect(parseMetadataText(pretty).ok).toBe(true)
  })
})

describe("encodedMetadataLength", () => {
  it("counts the encoded object, ignoring formatting", () => {
    expect(encodedMetadataLength('{ "a": 1 }')).toBe(7)
    expect(encodedMetadataLength('{\n  "a": 1\n}')).toBe(7)
  })

  it("keeps counting past the limit (the editor shows 1001/1000)", () => {
    const text = JSON.stringify({ a: "x".repeat(993) })
    expect(parseMetadataText(text).ok).toBe(false)
    expect(encodedMetadataLength(text)).toBe(METADATA_MAX_LENGTH + 1)
  })

  it("is 0 for empty text, null, invalid JSON and non-objects", () => {
    for (const text of ["", "   ", "null", "{ not json", "[1, 2]", '"text"', "42"]) {
      expect(encodedMetadataLength(text)).toBe(0)
    }
  })
})

describe("metadataError", () => {
  it("returns null when valid and the error text otherwise", () => {
    expect(metadataError("")).toBeNull()
    expect(metadataError('{"a":1}')).toBeNull()
    expect(metadataError("[]")).toBe("Metadata must be a JSON object.")
    expect(metadataError("{")).toEqual(expect.any(String))
  })
})

describe("metadataToText", () => {
  it("maps null and undefined to empty text", () => {
    expect(metadataToText(null)).toBe("")
    expect(metadataToText(undefined)).toBe("")
  })

  it("pretty-prints with two spaces and round-trips", () => {
    const value = { address: "Main St", floor: 2, nested: { a: [1] } }
    const text = metadataToText(value)
    expect(text).toBe(JSON.stringify(value, null, 2))
    expect(text).toContain('\n  "floor": 2')
    expect(parseMetadataText(text)).toEqual({ ok: true, value })
  })

  it("keeps an empty object as {}", () => {
    expect(metadataToText({})).toBe("{}")
  })
})

describe("omitKeys", () => {
  it("drops the listed keys and undefined values but keeps null, false, 0 and empty strings", () => {
    const input = { id: "1", created_at: "x", name: "A", a: undefined, b: null, c: false, d: 0, e: "" }
    expect(omitKeys(input, ["id", "created_at"])).toEqual({ name: "A", b: null, c: false, d: 0, e: "" })
  })

  it("returns a new object and leaves the input untouched", () => {
    const input = { id: "1", name: "A" }
    const out = omitKeys(input, ["id"])
    expect(out).not.toBe(input)
    expect(input).toEqual({ id: "1", name: "A" })
  })

  it("works with no keys to omit", () => {
    expect(omitKeys({ a: 1, b: undefined }, [])).toEqual({ a: 1 })
  })
})
