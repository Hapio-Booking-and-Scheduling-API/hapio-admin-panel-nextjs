import { describe, expect, it } from "vitest"

import type { Resource } from "@/lib/hapio/types"

import { FIELDS, schema, toBody, toCreateBody, toPatchBody, toValues, type Values } from "../resource-form-model"

const valid: Values = {
  name: "Anna",
  max_simultaneous_bookings: "1",
  enabled: true,
  metadata: "",
  protected_metadata: "",
}

/** The first message zod reports for a field, or undefined. */
function errorFor(values: Partial<Values>, field: keyof Values) {
  const result = schema.safeParse({ ...valid, ...values })
  if (result.success) return undefined
  return result.error.issues.find((issue) => issue.path[0] === field)?.message
}

const resource = (patch: Partial<Resource> = {}): Resource => ({
  id: "r1",
  name: "Room A",
  max_simultaneous_bookings: 2,
  metadata: { role: "room", capacity: 6 },
  protected_metadata: null,
  enabled: true,
  created_at: "2026-09-30T06:00:00+00:00",
  updated_at: "2026-09-30T06:00:00+00:00",
  ...patch,
})

describe("resource form schema", () => {
  it("accepts a valid resource", () => {
    expect(schema.safeParse(valid).success).toBe(true)
    expect(schema.safeParse({ ...valid, max_simultaneous_bookings: null }).success).toBe(true)
  })

  it("lists every form field", () => {
    expect(FIELDS).toEqual(["name", "max_simultaneous_bookings", "enabled", "metadata", "protected_metadata"])
  })

  it("requires a name of at most 100 characters", () => {
    expect(errorFor({ name: "" }, "name")).toBe("Required")
    expect(errorFor({ name: "   " }, "name")).toBe("Required")
    expect(errorFor({ name: "x".repeat(100) }, "name")).toBeUndefined()
    expect(errorFor({ name: "x".repeat(101) }, "name")).toBe("At most 100 characters")
  })

  it("trims the name", () => {
    const result = schema.parse({ ...valid, name: "  Anna  " })
    expect(result.name).toBe("Anna")
  })

  it("requires a whole number of at least 1 unless unlimited", () => {
    expect(errorFor({ max_simultaneous_bookings: "" }, "max_simultaneous_bookings")).toBe("Enter a whole number")
    expect(errorFor({ max_simultaneous_bookings: "abc" }, "max_simultaneous_bookings")).toBe("Enter a whole number")
    expect(errorFor({ max_simultaneous_bookings: "1.5" }, "max_simultaneous_bookings")).toBe("Enter a whole number")
    expect(errorFor({ max_simultaneous_bookings: "-1" }, "max_simultaneous_bookings")).toBe("Enter a whole number")
    expect(errorFor({ max_simultaneous_bookings: "0" }, "max_simultaneous_bookings")).toBe("Must be at least 1")
    expect(errorFor({ max_simultaneous_bookings: "00" }, "max_simultaneous_bookings")).toBe("Must be at least 1")
    expect(errorFor({ max_simultaneous_bookings: "1" }, "max_simultaneous_bookings")).toBeUndefined()
    expect(errorFor({ max_simultaneous_bookings: " 12 " }, "max_simultaneous_bookings")).toBeUndefined()
    expect(errorFor({ max_simultaneous_bookings: null }, "max_simultaneous_bookings")).toBeUndefined()
  })

  it("reports only one message for a non-number", () => {
    const result = schema.safeParse({ ...valid, max_simultaneous_bookings: "abc" })
    expect(result.success).toBe(false)
    const messages = result.success
      ? []
      : result.error.issues.filter((i) => i.path[0] === "max_simultaneous_bookings").map((i) => i.message)
    expect(messages).toEqual(["Enter a whole number"])
  })

  it("validates metadata as a JSON object", () => {
    expect(errorFor({ metadata: '{"role":"stylist"}' }, "metadata")).toBeUndefined()
    expect(errorFor({ metadata: "null" }, "metadata")).toBeUndefined()
    expect(errorFor({ metadata: "[1, 2]" }, "metadata")).toBe("Metadata must be a JSON object.")
    expect(errorFor({ metadata: '"text"' }, "metadata")).toBe("Metadata must be a JSON object.")
    expect(errorFor({ metadata: "{oops" }, "metadata")).toBeTruthy()
    expect(errorFor({ protected_metadata: "{oops" }, "protected_metadata")).toBeTruthy()
  })
})

describe("toValues", () => {
  it("starts a new resource as unlimited and enabled", () => {
    expect(toValues()).toEqual({
      name: "",
      max_simultaneous_bookings: null,
      enabled: true,
      metadata: "",
      protected_metadata: "",
    })
  })

  it("maps an existing resource to form text", () => {
    expect(toValues(resource())).toEqual({
      name: "Room A",
      max_simultaneous_bookings: "2",
      enabled: true,
      metadata: JSON.stringify({ role: "room", capacity: 6 }, null, 2),
      protected_metadata: "",
    })
  })

  it("maps unlimited, disabled and missing protected metadata", () => {
    const values = toValues(resource({ max_simultaneous_bookings: null, enabled: false, protected_metadata: undefined }))
    expect(values.max_simultaneous_bookings).toBeNull()
    expect(values.enabled).toBe(false)
    expect(values.protected_metadata).toBe("")
  })
})

describe("toBody", () => {
  it("sends only the given fields", () => {
    expect(toBody({})).toEqual({})
    expect(toBody({ name: "Ben" })).toEqual({ name: "Ben" })
  })

  it("converts max simultaneous bookings to a number or null", () => {
    expect(toBody({ max_simultaneous_bookings: "3" })).toEqual({ max_simultaneous_bookings: 3 })
    expect(toBody({ max_simultaneous_bookings: null })).toEqual({ max_simultaneous_bookings: null })
  })

  it("parses metadata text, with empty text meaning null", () => {
    expect(toBody({ metadata: '{ "role": "stylist" }', protected_metadata: "" })).toEqual({
      metadata: { role: "stylist" },
      protected_metadata: null,
    })
  })

  it("round-trips a resource", () => {
    expect(toBody(toValues(resource()))).toEqual({
      name: "Room A",
      max_simultaneous_bookings: 2,
      enabled: true,
      metadata: { role: "room", capacity: 6 },
      protected_metadata: null,
    })
  })
})

describe("toCreateBody", () => {
  it("sends every field", () => {
    expect(toCreateBody({ ...valid, protected_metadata: '{ "serial": "X1" }' })).toEqual({
      name: "Anna",
      max_simultaneous_bookings: 1,
      enabled: true,
      metadata: null,
      protected_metadata: { serial: "X1" },
    })
  })

  it("leaves out empty or whitespace-only protected metadata (it needs an extra ability)", () => {
    expect(toCreateBody(valid)).not.toHaveProperty("protected_metadata")
    expect(toCreateBody({ ...valid, protected_metadata: "  \n\t " })).not.toHaveProperty("protected_metadata")
  })
})

describe("toPatchBody", () => {
  it("sends only the dirty fields", () => {
    expect(toPatchBody({ ...valid, name: "Anna K" }, { name: true })).toEqual({ name: "Anna K" })
  })

  it("is empty when nothing changed", () => {
    expect(toPatchBody(valid, {})).toEqual({})
    expect(toPatchBody(valid, { name: false })).toEqual({})
  })
})
