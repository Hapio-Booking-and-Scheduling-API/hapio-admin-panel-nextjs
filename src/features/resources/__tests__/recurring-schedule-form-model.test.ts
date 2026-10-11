import { afterEach, describe, expect, it, vi } from "vitest"

import type { RecurringSchedule } from "@/lib/hapio/types"

import { FIELD_MAP, FIELDS, schema, toBody, toValues, type Values } from "../recurring-schedule-form-model"

afterEach(() => {
  vi.useRealTimers()
})

/** The first message per field, which is what react-hook-form's zod resolver shows. */
function firstMessages(list: Array<{ path: PropertyKey[]; message: string }>) {
  const out: Record<string, string> = {}
  for (const issue of list) out[String(issue.path[0])] ??= issue.message
  return out
}

const valid: Values = { location_id: "loc-1", start_date: "2026-10-21", end_date: null, interval: "1" }

function errors(values: Partial<Values>) {
  const result = schema.safeParse({ ...valid, ...values })
  return result.success ? {} : firstMessages(result.error.issues)
}

describe("recurring schedule schema", () => {
  it("accepts an open-ended and a bounded schedule", () => {
    expect(errors({})).toEqual({})
    expect(errors({ end_date: "2026-12-31", interval: "2" })).toEqual({})
  })

  it("requires a location and a start date", () => {
    expect(errors({ location_id: "" })).toEqual({ location_id: "Required" })
    expect(errors({ start_date: "" })).toEqual({ start_date: "Pick a date" })
    expect(errors({ start_date: "21/10/2026" })).toEqual({ start_date: "Pick a date" })
  })

  it("requires a real end date unless it runs indefinitely", () => {
    expect(errors({ end_date: "" })).toEqual({ end_date: "Pick a date" })
    expect(errors({ end_date: null })).toEqual({})
  })

  it("rejects an end date before the start date, but allows the same day", () => {
    expect(errors({ end_date: "2026-10-20" })).toEqual({ end_date: "Can't be before the start date" })
    expect(errors({ end_date: "2026-10-21" })).toEqual({})
  })

  it("doesn't compare dates while the start date is invalid", () => {
    expect(errors({ start_date: "", end_date: "2026-10-20" })).toEqual({ start_date: "Pick a date" })
  })

  it("requires a whole number of weeks of at least 1", () => {
    expect(errors({ interval: "" })).toEqual({ interval: "Enter a whole number" })
    expect(errors({ interval: "1.5" })).toEqual({ interval: "Enter a whole number" })
    expect(errors({ interval: "-2" })).toEqual({ interval: "Enter a whole number" })
    expect(errors({ interval: "0" })).toEqual({ interval: "Must be at least 1" })
    expect(errors({ interval: " 3 " })).toEqual({})
  })

  it("maps the API's location key onto the form field", () => {
    expect(FIELDS).toEqual(["location_id", "start_date", "end_date", "interval"])
    expect(FIELD_MAP).toEqual({ location: "location_id" })
  })
})

describe("toValues", () => {
  it("copies an existing schedule", () => {
    const schedule = {
      id: "s1",
      location: { id: "loc-2", time_zone: "America/New_York" },
      start_date: "2026-09-21",
      end_date: "2026-12-31",
      interval: 2,
    } as unknown as RecurringSchedule
    expect(toValues(schedule, "other")).toEqual({
      location_id: "loc-2",
      start_date: "2026-09-21",
      end_date: "2026-12-31",
      interval: "2",
    })
  })

  it("starts a new schedule today in the location's zone, indefinitely, every week", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-22T00:30:00+02:00"))
    expect(toValues(undefined, "sthlm", "Europe/Stockholm")).toEqual({
      location_id: "sthlm",
      start_date: "2026-10-22",
      end_date: null,
      interval: "1",
    })
    expect(toValues(undefined, "ny", "America/New_York").start_date).toBe("2026-10-21")
    expect(toValues(undefined, null).location_id).toBe("")
  })
})

describe("toBody", () => {
  it("sends only the given fields and converts the interval", () => {
    expect(toBody({})).toEqual({})
    expect(toBody({ interval: "3" })).toEqual({ interval: 3 })
    expect(toBody({ end_date: null })).toEqual({ end_date: null })
    expect(toBody(valid)).toEqual({ location_id: "loc-1", start_date: "2026-10-21", end_date: null, interval: 1 })
  })
})
