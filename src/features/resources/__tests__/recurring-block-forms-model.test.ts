import { describe, expect, it } from "vitest"

import { HapioApiError } from "@/lib/hapio/errors"

import {
  BLOCK_FIELDS,
  BulkCreateError,
  OVERLAP_HINT,
  PRESETS,
  blockSchema,
  bulkResultMessage,
  failureMessage,
  hoursSchema,
  isOrdered,
} from "../recurring-block-forms-model"

/** The first message per field, which is what react-hook-form's zod resolver shows. */
function firstMessages(list: Array<{ path: PropertyKey[]; message: string }>) {
  const out: Record<string, string> = {}
  for (const issue of list) out[String(issue.path[0])] ??= issue.message
  return out
}

function issues(schema: typeof blockSchema | typeof hoursSchema, values: unknown) {
  const result = schema.safeParse(values)
  return result.success ? {} : firstMessages(result.error.issues)
}

describe("isOrdered", () => {
  it("requires the end after the start", () => {
    expect(isOrdered({ start_time: "09:00:00", end_time: "17:00:00" })).toBe(true)
    expect(isOrdered({ start_time: "09:00:00", end_time: "09:00:00" })).toBe(false)
    expect(isOrdered({ start_time: "17:00:00", end_time: "09:00:00" })).toBe(false)
    expect(isOrdered({ start_time: "09:00:00", end_time: "09:00:01" })).toBe(true)
  })

  it("treats 24:00 as the end of the day", () => {
    expect(isOrdered({ start_time: "23:59:00", end_time: "24:00:00" })).toBe(true)
    expect(isOrdered({ start_time: "00:00:00", end_time: "24:00:00" })).toBe(true)
  })

  it("leaves invalid times to the field validators", () => {
    expect(isOrdered({ start_time: "", end_time: "09:00:00" })).toBe(true)
    expect(isOrdered({ start_time: "17:00:00", end_time: "" })).toBe(true)
    expect(isOrdered({ start_time: "24:00:00", end_time: "09:00:00" })).toBe(true)
  })
})

describe("block schema", () => {
  const valid = { weekday: "monday", start_time: "09:00:00", end_time: "17:00:00" }

  it("accepts a valid block, including one that ends at 24:00", () => {
    expect(issues(blockSchema, valid)).toEqual({})
    expect(issues(blockSchema, { ...valid, end_time: "24:00:00" })).toEqual({})
    expect(BLOCK_FIELDS).toEqual(["weekday", "start_time", "end_time"])
  })

  it("requires hh:mm:ss times; only the end may be 24:00", () => {
    expect(issues(blockSchema, { ...valid, start_time: "" })).toEqual({ start_time: "Enter a time" })
    expect(issues(blockSchema, { ...valid, start_time: "9:00" })).toEqual({ start_time: "Enter a time" })
    expect(issues(blockSchema, { ...valid, start_time: "24:00:00" })).toEqual({ start_time: "Enter a time" })
    expect(issues(blockSchema, { ...valid, end_time: "25:00:00" })).toEqual({ end_time: "Enter a time" })
  })

  it("puts the order error on the end time", () => {
    expect(issues(blockSchema, { ...valid, end_time: "08:00:00" })).toEqual({ end_time: "Must be after the start time" })
    expect(issues(blockSchema, { ...valid, end_time: "09:00:00" })).toEqual({ end_time: "Must be after the start time" })
  })

  it("rejects unknown weekdays", () => {
    expect(Object.keys(issues(blockSchema, { ...valid, weekday: "funday" }))).toEqual(["weekday"])
  })
})

describe("weekday hours schema", () => {
  const valid = { weekdays: ["monday", "friday"], start_time: "10:00:00", end_time: "14:00:00" }

  it("requires at least one day", () => {
    expect(issues(hoursSchema, valid)).toEqual({})
    expect(issues(hoursSchema, { ...valid, weekdays: [] })).toEqual({ weekdays: "Pick at least one day" })
  })

  it("validates the times like a single block", () => {
    expect(issues(hoursSchema, { ...valid, end_time: "10:00:00" })).toEqual({ end_time: "Must be after the start time" })
    expect(issues(hoursSchema, { ...valid, end_time: "24:00:00" })).toEqual({})
  })
})

describe("presets", () => {
  it("offers Mon–Fri, Weekend and Every day", () => {
    expect(PRESETS.map((p) => [p.label, p.days.length])).toEqual([
      ["Mon–Fri", 5],
      ["Weekend", 2],
      ["Every day", 7],
    ])
    expect(PRESETS[1].days).toEqual(["saturday", "sunday"])
  })

  it("explains that blocks can't overlap", () => {
    expect(OVERLAP_HINT).toBe("Blocks in the same recurring schedule can't overlap.")
  })
})

describe("failureMessage", () => {
  it("joins every field message of a 422", () => {
    const error = new HapioApiError({
      status: 422,
      message: "The given data was invalid.",
      errors: { start_time: ["Overlaps."], end_time: ["Too late.", "Really."] },
    })
    expect(failureMessage(error)).toBe("Overlaps. Too late. Really.")
  })

  it("falls back to the error description", () => {
    expect(failureMessage(new HapioApiError({ status: 422, message: "Invalid.", errors: {} }))).toBe("Invalid.")
    expect(failureMessage(new HapioApiError({ status: 500, message: "" }))).toBe("Hapio had an internal error.")
    expect(failureMessage(new HapioApiError({ status: 429, message: "Too Many Attempts." }))).toBe("Too Many Attempts.")
    expect(failureMessage(new TypeError("Failed to fetch"))).toBe("Failed to fetch")
    expect(failureMessage("boom")).toBe("Something went wrong.")
  })
})

describe("bulk results", () => {
  it("summarises what was added", () => {
    expect(bulkResultMessage({ created: 1, failed: [] })).toBe("Block added")
    expect(bulkResultMessage({ created: 2, failed: [] })).toBe("Added 2 blocks")
    expect(bulkResultMessage({ created: 2, failed: [1, 2, 3, 4, 5] })).toBe("Added 2 of 7 blocks")
    expect(bulkResultMessage({ created: 1, failed: [1] })).toBe("Added 1 of 2 blocks")
  })

  it("carries one line per failed day", () => {
    const error = new BulkCreateError(["Monday: Overlaps.", "Tuesday: Overlaps."])
    expect(error.lines).toEqual(["Monday: Overlaps.", "Tuesday: Overlaps."])
    expect(error.message).toBe("Monday: Overlaps.\nTuesday: Overlaps.")
    expect(error).toBeInstanceOf(Error)
  })
})
