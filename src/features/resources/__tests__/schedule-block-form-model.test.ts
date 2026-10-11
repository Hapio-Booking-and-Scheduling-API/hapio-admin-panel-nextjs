import { afterEach, describe, expect, it, vi } from "vitest"

import type { ScheduleBlock } from "@/lib/hapio/types"

import {
  FIELD_MAP,
  FIELDS,
  durationLabel,
  keepWallTime,
  schema,
  toValues,
  type Values,
} from "../schedule-block-form-model"

afterEach(() => {
  vi.useRealTimers()
})

/** The first message per field, which is what react-hook-form's zod resolver shows. */
function firstMessages(list: Array<{ path: PropertyKey[]; message: string }>) {
  const out: Record<string, string> = {}
  for (const issue of list) out[String(issue.path[0])] ??= issue.message
  return out
}

const valid: Values = {
  location_id: "loc-1",
  starts_at: "2026-10-22T09:00:00+02:00",
  ends_at: "2026-10-22T17:00:00+02:00",
  is_available: true,
}

function errors(values: Partial<Values>) {
  const result = schema.safeParse({ ...valid, ...values })
  return result.success ? {} : firstMessages(result.error.issues)
}

describe("schedule block schema", () => {
  it("accepts a valid block", () => {
    expect(errors({})).toEqual({})
    expect(errors({ is_available: false })).toEqual({})
  })

  it("requires a location and both times", () => {
    expect(errors({ location_id: "" })).toEqual({ location_id: "Required" })
    expect(errors({ starts_at: "" })).toEqual({ starts_at: "Required" })
    expect(errors({ ends_at: "" })).toEqual({ ends_at: "Required" })
  })

  it("requires the end to be after the start", () => {
    expect(errors({ ends_at: "2026-10-22T08:00:00+02:00" })).toEqual({ ends_at: "Must be after the start" })
    expect(errors({ ends_at: valid.starts_at })).toEqual({ ends_at: "Must be after the start" })
  })

  it("compares absolute time across offsets", () => {
    // 14:00 in Stockholm is 08:00 in New York, before the 09:00 start.
    expect(errors({ starts_at: "2026-10-22T09:00:00-04:00", ends_at: "2026-10-22T14:00:00+02:00" })).toEqual({
      ends_at: "Must be after the start",
    })
    expect(errors({ starts_at: "2026-10-22T09:00:00-04:00", ends_at: "2026-10-22T16:00:00+02:00" })).toEqual({})
  })

  it("maps the API's location key onto the form field", () => {
    expect(FIELDS).toEqual(["location_id", "starts_at", "ends_at", "is_available"])
    expect(FIELD_MAP).toEqual({ location: "location_id" })
  })
})

describe("toValues", () => {
  it("copies an existing block", () => {
    const block = {
      id: "b1",
      location: { id: "loc-9", time_zone: "Europe/Stockholm" },
      starts_at: "2026-10-28T12:00:00+01:00",
      ends_at: "2026-10-28T14:00:00+01:00",
      is_available: false,
    } as unknown as ScheduleBlock
    expect(toValues(block, "ignored", "America/New_York")).toEqual({
      location_id: "loc-9",
      starts_at: "2026-10-28T12:00:00+01:00",
      ends_at: "2026-10-28T14:00:00+01:00",
      is_available: false,
    })
  })

  it("defaults a new block to tomorrow 09:00–17:00 in the location's zone", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-21T08:00:00+02:00"))
    expect(toValues(undefined, "ny", "America/New_York")).toEqual({
      location_id: "ny",
      starts_at: "2026-10-22T09:00:00-04:00",
      ends_at: "2026-10-22T17:00:00-04:00",
      is_available: true,
    })
    expect(toValues(undefined, "sthlm", "Europe/Stockholm")).toMatchObject({
      starts_at: "2026-10-22T09:00:00+02:00",
      ends_at: "2026-10-22T17:00:00+02:00",
    })
  })

  it("uses the browser's zone without a location", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-21T08:00:00+02:00"))
    expect(toValues(undefined, null)).toEqual({
      location_id: "",
      starts_at: "2026-10-22T09:00:00+02:00",
      ends_at: "2026-10-22T17:00:00+02:00",
      is_available: true,
    })
  })

  it("picks tomorrow in the location's zone, not the browser's", () => {
    vi.useFakeTimers()
    // 00:30 Thursday in Stockholm is still Wednesday evening in New York.
    vi.setSystemTime(new Date("2026-10-22T00:30:00+02:00"))
    expect(toValues(undefined, "ny", "America/New_York").starts_at).toBe("2026-10-22T09:00:00-04:00")
    expect(toValues(undefined, "sthlm", "Europe/Stockholm").starts_at).toBe("2026-10-23T09:00:00+02:00")
  })

  it("uses the new offset when tomorrow is after a DST change", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-24T12:00:00+02:00"))
    expect(toValues(undefined, "sthlm", "Europe/Stockholm")).toMatchObject({
      starts_at: "2026-10-25T09:00:00+01:00",
      ends_at: "2026-10-25T17:00:00+01:00",
    })
  })
})

describe("durationLabel", () => {
  it("describes valid spans", () => {
    expect(durationLabel(valid.starts_at, valid.ends_at)).toBe("8 h")
    expect(durationLabel("2026-10-22T09:00:00+02:00", "2026-10-22T10:30:00+02:00")).toBe("1 h 30 min")
    expect(durationLabel("2026-10-25T00:00:00+02:00", "2026-10-26T00:00:00+01:00")).toBe("1 d 1 h")
  })

  it("is null for empty or backwards spans", () => {
    expect(durationLabel("", valid.ends_at)).toBeNull()
    expect(durationLabel(valid.starts_at, "")).toBeNull()
    expect(durationLabel(valid.ends_at, valid.starts_at)).toBeNull()
    expect(durationLabel(valid.starts_at, valid.starts_at)).toBeNull()
  })
})

describe("keepWallTime", () => {
  it("keeps the wall-clock time when switching zones", () => {
    expect(keepWallTime("2026-10-22T09:00:00+02:00", "Europe/Stockholm", "America/New_York")).toBe(
      "2026-10-22T09:00:00-04:00"
    )
    expect(keepWallTime("2026-10-22T09:00:00-04:00", "America/New_York", "Europe/Stockholm")).toBe(
      "2026-10-22T09:00:00+02:00"
    )
  })

  it("reads the timestamp's own wall time when the old zone is unknown", () => {
    expect(keepWallTime("2026-10-22T09:00:00+02:00", undefined, "America/New_York")).toBe("2026-10-22T09:00:00-04:00")
  })

  it("applies the right offset on each side of a DST change", () => {
    // The US is still on summer time when Europe has switched back.
    expect(keepWallTime("2026-10-27T09:00:00+01:00", "Europe/Stockholm", "America/New_York")).toBe(
      "2026-10-27T09:00:00-04:00"
    )
    expect(keepWallTime("2026-11-02T09:00:00+01:00", "Europe/Stockholm", "America/New_York")).toBe(
      "2026-11-02T09:00:00-05:00"
    )
  })
})
