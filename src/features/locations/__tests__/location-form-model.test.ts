import { describe, expect, it } from "vitest"

import type { Location } from "@/lib/hapio/types"

import {
  FIELDS,
  schema,
  toBody,
  toCreateBody,
  toPatchBody,
  toValues,
  type Values,
} from "../location-form-model"

const ANNA = "11111111-1111-4111-8111-111111111111"
const BEN = "22222222-2222-4222-8222-222222222222"

const stockholm: Location = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Stockholm Studio",
  time_zone: "Europe/Stockholm",
  resource_selection_strategy: "prioritize",
  resource_selection_priority: [ANNA, BEN],
  metadata: { address: "Götgatan 12, Stockholm", floor: 2 },
  protected_metadata: { secret: true },
  enabled: true,
  created_at: "2026-09-30T06:02:00+00:00",
  updated_at: "2026-09-30T06:02:00+00:00",
}

const values = (overrides: Partial<Values> = {}): Values => ({
  name: "Gothenburg Hall",
  time_zone: "Europe/Stockholm",
  resource_selection_strategy: "randomize",
  resource_selection_priority: [],
  enabled: true,
  metadata: "",
  protected_metadata: "",
  ...overrides,
})

/** First error message per field, like the form shows it. */
function errorsOf(input: Values): Record<string, string> {
  const result = schema.safeParse(input)
  if (result.success) return {}
  const out: Record<string, string> = {}
  for (const issue of result.error.issues) out[issue.path.join(".")] ??= issue.message
  return out
}

describe("location form schema", () => {
  it("accepts a minimal valid location", () => {
    expect(schema.safeParse(values()).success).toBe(true)
  })

  it("requires a name, ignoring surrounding whitespace", () => {
    expect(errorsOf(values({ name: "" }))).toEqual({ name: "Required" })
    expect(errorsOf(values({ name: "   " }))).toEqual({ name: "Required" })
  })

  it("trims the name it returns", () => {
    const parsed = schema.parse(values({ name: "  Loft  " }))
    expect(parsed.name).toBe("Loft")
  })

  it("allows 100 characters but not 101", () => {
    expect(errorsOf(values({ name: "x".repeat(100) }))).toEqual({})
    expect(errorsOf(values({ name: "x".repeat(101) }))).toEqual({ name: "At most 100 characters" })
  })

  it("requires a time zone", () => {
    expect(errorsOf(values({ time_zone: "" }))).toEqual({ time_zone: "Required" })
  })

  it("only accepts the three selection strategies", () => {
    for (const strategy of ["randomize", "prioritize", "equalize"] as const) {
      expect(errorsOf(values({ resource_selection_strategy: strategy }))).toEqual({})
    }
    expect(
      schema.safeParse(values({ resource_selection_strategy: "round-robin" as Values["resource_selection_strategy"] }))
        .success
    ).toBe(false)
  })

  it("validates metadata text as a JSON object of at most 1000 characters", () => {
    expect(errorsOf(values({ metadata: "{" })).metadata).toBeTruthy()
    expect(errorsOf(values({ metadata: "[1, 2]" }))).toEqual({ metadata: "Metadata must be a JSON object." })
    expect(errorsOf(values({ metadata: '"text"' }))).toEqual({ metadata: "Metadata must be a JSON object." })
    // {"a":"…"} is 8 characters plus the value.
    expect(errorsOf(values({ metadata: JSON.stringify({ a: "x".repeat(992) }) }))).toEqual({})
    expect(errorsOf(values({ metadata: JSON.stringify({ a: "x".repeat(993) }) }))).toEqual({
      metadata: "Metadata can be at most 1000 characters when encoded.",
    })
  })

  it("validates protected metadata the same way", () => {
    expect(errorsOf(values({ protected_metadata: "[]" }))).toEqual({
      protected_metadata: "Metadata must be a JSON object.",
    })
  })

  it("treats empty, whitespace and null metadata as valid", () => {
    expect(errorsOf(values({ metadata: "", protected_metadata: "  \n " }))).toEqual({})
    expect(errorsOf(values({ metadata: "null" }))).toEqual({})
  })

  it("lists every form field for server error mapping", () => {
    expect(FIELDS).toEqual([
      "name",
      "time_zone",
      "resource_selection_strategy",
      "resource_selection_priority",
      "enabled",
      "metadata",
      "protected_metadata",
    ])
  })
})

describe("toValues", () => {
  it("gives defaults for a new location in the browser's time zone", () => {
    expect(toValues()).toEqual({
      name: "",
      time_zone: "Europe/Stockholm",
      resource_selection_strategy: "randomize",
      resource_selection_priority: [],
      enabled: true,
      metadata: "",
      protected_metadata: "",
    })
  })

  it("copies an existing location, with metadata as pretty JSON", () => {
    expect(toValues(stockholm)).toEqual({
      name: "Stockholm Studio",
      time_zone: "Europe/Stockholm",
      resource_selection_strategy: "prioritize",
      resource_selection_priority: [ANNA, BEN],
      enabled: true,
      metadata: '{\n  "address": "Götgatan 12, Stockholm",\n  "floor": 2\n}',
      protected_metadata: '{\n  "secret": true\n}',
    })
  })

  it("handles missing priority, null metadata and absent protected metadata", () => {
    const bare: Location = { ...stockholm, metadata: null, enabled: false }
    delete bare.resource_selection_priority
    delete bare.protected_metadata
    const v = toValues(bare)
    expect(v.resource_selection_priority).toEqual([])
    expect(v.metadata).toBe("")
    expect(v.protected_metadata).toBe("")
    expect(v.enabled).toBe(false)
  })

  it("round-trips through toBody", () => {
    expect(toBody(toValues(stockholm))).toEqual({
      name: stockholm.name,
      time_zone: stockholm.time_zone,
      resource_selection_strategy: stockholm.resource_selection_strategy,
      resource_selection_priority: stockholm.resource_selection_priority,
      enabled: stockholm.enabled,
      metadata: stockholm.metadata,
      protected_metadata: stockholm.protected_metadata,
    })
  })
})

describe("toBody", () => {
  it("maps every field and parses metadata text", () => {
    expect(
      toBody(
        values({
          resource_selection_strategy: "prioritize",
          resource_selection_priority: [BEN, ANNA],
          enabled: false,
          metadata: '{ "floor": 3 }',
          protected_metadata: '{ "code": "1234" }',
        })
      )
    ).toEqual({
      name: "Gothenburg Hall",
      time_zone: "Europe/Stockholm",
      resource_selection_strategy: "prioritize",
      resource_selection_priority: [BEN, ANNA],
      enabled: false,
      metadata: { floor: 3 },
      protected_metadata: { code: "1234" },
    })
  })

  it("only includes the keys it is given", () => {
    expect(toBody({})).toEqual({})
    expect(toBody({ name: "Renamed" })).toEqual({ name: "Renamed" })
    expect(toBody({ enabled: false })).toEqual({ enabled: false })
  })

  it("sends empty metadata as null", () => {
    expect(toBody({ metadata: "", protected_metadata: "   " })).toEqual({ metadata: null, protected_metadata: null })
  })
})

describe("toCreateBody", () => {
  it("sends every field and leaves out empty protected metadata", () => {
    const body = toCreateBody(values())
    expect(body).toEqual({
      name: "Gothenburg Hall",
      time_zone: "Europe/Stockholm",
      resource_selection_strategy: "randomize",
      resource_selection_priority: [],
      enabled: true,
      metadata: null,
    })
    expect("protected_metadata" in body).toBe(false)
  })

  it("includes protected metadata when it is set", () => {
    expect(toCreateBody(values({ protected_metadata: '{"vip":true}' })).protected_metadata).toEqual({ vip: true })
  })

  it("sends protected metadata null when the text is literally null", () => {
    // "null" is an explicit choice, unlike an untouched empty editor.
    expect(toCreateBody(values({ protected_metadata: "null" }))).toHaveProperty("protected_metadata", null)
  })

  // A blank-looking editor must not send protected_metadata, which needs the
  // location:protected_metadata ability (BUG-LOC-1).
  it("leaves out whitespace-only protected metadata", () => {
    const body = toCreateBody(values({ protected_metadata: "  \n  " }))
    expect("protected_metadata" in body).toBe(false)
  })
})

describe("toPatchBody", () => {
  const edited = values({
    name: "Renamed",
    resource_selection_strategy: "prioritize",
    resource_selection_priority: [BEN, ANNA],
    metadata: '{"floor":3}',
  })

  it("sends nothing when nothing is dirty", () => {
    expect(toPatchBody(edited, {})).toEqual({})
  })

  it("sends exactly the dirty fields", () => {
    expect(toPatchBody(edited, { name: true })).toEqual({ name: "Renamed" })
    expect(toPatchBody(edited, { name: true, metadata: true })).toEqual({ name: "Renamed", metadata: { floor: 3 } })
  })

  it("ignores fields react-hook-form marked clean", () => {
    expect(toPatchBody(edited, { name: false, enabled: false })).toEqual({})
  })

  it("sends the whole priority list when any entry is dirty", () => {
    expect(
      toPatchBody(edited, { resource_selection_strategy: true, resource_selection_priority: [true, false] })
    ).toEqual({ resource_selection_strategy: "prioritize", resource_selection_priority: [BEN, ANNA] })
    expect(toPatchBody(edited, { resource_selection_priority: [false, false] })).toEqual({})
  })

  it("clears metadata with null when the editor was emptied", () => {
    expect(toPatchBody(values({ metadata: "" }), { metadata: true })).toEqual({ metadata: null })
  })

  it("can send protected metadata on edit", () => {
    expect(toPatchBody(values({ protected_metadata: '{"a":1}' }), { protected_metadata: true })).toEqual({
      protected_metadata: { a: 1 },
    })
  })
})
