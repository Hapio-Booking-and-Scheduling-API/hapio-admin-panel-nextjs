import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BookableSlotFlexible, Service, ServiceDay, ServiceFixed, ServiceFlexible } from "@/lib/hapio/types"

import {
  MAX_END_OPTIONS,
  PRESETS,
  addDaysTo,
  bookingHref,
  defaultLength,
  endOptions,
  fallbackLength,
  hasEndRange,
  lengthLabel,
  presetRange,
  toZoned,
} from "../slots-model"

const STOCKHOLM = "Europe/Stockholm"
const NEW_YORK = "America/New_York"

const common = {
  price: null,
  buffer_time_before: "PT0S",
  buffer_time_after: "PT0S",
  booking_window_start: "PT0S",
  booking_window_end: null,
  cancelation_threshold: "PT0S",
  metadata: null,
  enabled: true,
  created_at: "2026-09-01T10:00:00+00:00",
  updated_at: "2026-09-01T10:00:00+00:00",
}
const fixed: ServiceFixed = { id: "f", name: "Haircut", type: "fixed", duration: "PT45M", bookable_interval: null, ...common }
const flexible: ServiceFlexible = {
  id: "x",
  name: "Studio rental",
  type: "flexible",
  min_duration: "PT1H",
  max_duration: "PT4H",
  default_duration: null,
  duration_step: "PT30M",
  bookable_interval: null,
  ...common,
}
const day: ServiceDay = {
  id: "d",
  name: "Equipment rental",
  type: "day",
  start_time: "09:00:00",
  end_time: "17:00:00",
  min_days: 1,
  max_days: 7,
  default_days: null,
  ...common,
}

function slot(startsAt: string, minEndsAt: string, endsAt: string): BookableSlotFlexible {
  return {
    buffer_starts_at: startsAt,
    starts_at: startsAt,
    ends_at: endsAt,
    buffer_ends_at: endsAt,
    min_ends_at: minEndsAt,
    min_buffer_ends_at: minEndsAt,
    resources: [],
  }
}

describe("PRESETS and presetRange", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("labels the presets", () => {
    expect(Object.values(PRESETS).map((p) => p.label)).toEqual(["Today", "Next 7 days", "Next 30 days"])
  })

  it("covers today, 7 and 30 days in the location's zone, both dates included", () => {
    vi.setSystemTime(new Date("2026-10-21T08:00:00+02:00"))
    expect(presetRange("today", STOCKHOLM)).toEqual({ from: "2026-10-21", to: "2026-10-21" })
    expect(presetRange("7d", STOCKHOLM)).toEqual({ from: "2026-10-21", to: "2026-10-27" })
    expect(presetRange("30d", STOCKHOLM)).toEqual({ from: "2026-10-21", to: "2026-11-19" })
  })

  it("uses the location's date, not the browser's", () => {
    // 00:30 on Thursday in Stockholm is still Wednesday evening in New York.
    vi.setSystemTime(new Date("2026-10-22T00:30:00+02:00"))
    expect(presetRange("today", STOCKHOLM).from).toBe("2026-10-22")
    expect(presetRange("today", NEW_YORK).from).toBe("2026-10-21")
  })
})

describe("addDaysTo", () => {
  it("adds calendar days across DST and month ends", () => {
    expect(addDaysTo("2026-10-24", 1)).toBe("2026-10-25")
    expect(addDaysTo("2026-10-25", 1)).toBe("2026-10-26")
    expect(addDaysTo("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDaysTo("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDaysTo("2026-10-21", 0)).toBe("2026-10-21")
  })
})

describe("toZoned", () => {
  it("formats an instant with the zone's offset on either side of DST", () => {
    expect(toZoned(Date.parse("2026-10-23T15:00:00Z"), STOCKHOLM)).toBe("2026-10-23T17:00:00+02:00")
    expect(toZoned(Date.parse("2026-10-26T16:00:00Z"), STOCKHOLM)).toBe("2026-10-26T17:00:00+01:00")
    expect(toZoned(Date.parse("2026-10-29T14:00:00Z"), NEW_YORK)).toBe("2026-10-29T10:00:00-04:00")
    expect(toZoned(Date.parse("2026-11-02T15:00:00Z"), NEW_YORK)).toBe("2026-11-02T10:00:00-05:00")
  })
})

describe("lengthLabel", () => {
  it("humanizes milliseconds as hours and minutes", () => {
    expect(lengthLabel(60 * 60_000)).toBe("1 h")
    expect(lengthLabel(90 * 60_000)).toBe("1 h 30 min")
    expect(lengthLabel(45 * 60_000)).toBe("45 min")
    expect(lengthLabel(26 * 60 * 60_000)).toBe("26 h")
    expect(lengthLabel(0)).toBe("0 min")
  })

  it("rounds to whole minutes", () => {
    expect(lengthLabel(89.6 * 60_000)).toBe("1 h 30 min")
    expect(lengthLabel(29_000)).toBe("0 min")
  })
})

describe("defaultLength and fallbackLength", () => {
  it("has no default for fixed services", () => {
    expect(defaultLength(fixed)).toBeNull()
    expect(fallbackLength(fixed)).toBe("PT1H")
  })

  it("uses the flexible default, else the minimum as fallback", () => {
    expect(defaultLength(flexible)).toBeNull()
    expect(fallbackLength(flexible)).toBe("PT1H")
    const withDefault = { ...flexible, default_duration: "PT2H" }
    expect(defaultLength(withDefault)).toBe("PT2H")
    expect(fallbackLength(withDefault)).toBe("PT2H")
  })

  it("uses whole days for day services", () => {
    expect(defaultLength(day)).toBeNull()
    expect(fallbackLength(day)).toBe("P1D")
    expect(defaultLength({ ...day, default_days: 3 })).toBe("P3D")
    expect(fallbackLength({ ...day, default_days: 3 })).toBe("P3D")
    expect(fallbackLength({ ...day, min_days: 2 })).toBe("P2D")
  })
})

describe("hasEndRange", () => {
  it("detects flexible and day slots", () => {
    const s = slot("2026-10-21T09:00:00+02:00", "2026-10-21T10:00:00+02:00", "2026-10-21T13:00:00+02:00")
    expect(hasEndRange(s)).toBe(true)
    const plain = {
      buffer_starts_at: s.buffer_starts_at,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      buffer_ends_at: s.buffer_ends_at,
      resources: [],
    }
    expect(hasEndRange(plain)).toBe(false)
  })
})

describe("endOptions", () => {
  it("steps a flexible slot from the minimum to the maximum end", () => {
    const s = slot("2026-10-21T09:00:00+02:00", "2026-10-21T10:00:00+02:00", "2026-10-21T13:00:00+02:00")
    expect(endOptions(s, flexible, STOCKHOLM)).toEqual([
      "2026-10-21T10:00:00+02:00",
      "2026-10-21T10:30:00+02:00",
      "2026-10-21T11:00:00+02:00",
      "2026-10-21T11:30:00+02:00",
      "2026-10-21T12:00:00+02:00",
      "2026-10-21T12:30:00+02:00",
      "2026-10-21T13:00:00+02:00",
    ])
  })

  it("keeps the API's minimum end string as the first option", () => {
    const s = slot("2026-10-21T03:00:00-04:00", "2026-10-21T04:00:00-04:00", "2026-10-21T05:00:00-04:00")
    expect(endOptions(s, flexible, STOCKHOLM)[0]).toBe("2026-10-21T04:00:00-04:00")
  })

  it("stops at the last step that fits", () => {
    const s = slot("2026-10-21T09:00:00+02:00", "2026-10-21T10:00:00+02:00", "2026-10-21T11:45:00+02:00")
    expect(endOptions(s, flexible, STOCKHOLM)).toEqual([
      "2026-10-21T10:00:00+02:00",
      "2026-10-21T10:30:00+02:00",
      "2026-10-21T11:00:00+02:00",
      "2026-10-21T11:30:00+02:00",
    ])
  })

  it("steps in real time across the DST change", () => {
    const s = slot("2026-10-25T00:00:00+02:00", "2026-10-25T01:00:00+02:00", "2026-10-25T03:00:00+01:00")
    expect(endOptions(s, { ...flexible, duration_step: "PT1H" }, STOCKHOLM)).toEqual([
      "2026-10-25T01:00:00+02:00",
      "2026-10-25T02:00:00+02:00",
      "2026-10-25T02:00:00+01:00",
      "2026-10-25T03:00:00+01:00",
    ])
  })

  it("steps a day slot by whole days in wall time across DST", () => {
    const s = slot("2026-10-23T09:00:00+02:00", "2026-10-23T17:00:00+02:00", "2026-10-28T17:00:00+01:00")
    expect(endOptions(s, day, STOCKHOLM)).toEqual([
      "2026-10-23T17:00:00+02:00",
      "2026-10-24T17:00:00+02:00",
      "2026-10-25T17:00:00+01:00",
      "2026-10-26T17:00:00+01:00",
      "2026-10-27T17:00:00+01:00",
      "2026-10-28T17:00:00+01:00",
    ])
  })

  it("steps a New York day slot across US DST", () => {
    const s = slot("2026-10-30T09:00:00-04:00", "2026-10-30T17:00:00-04:00", "2026-11-02T17:00:00-05:00")
    expect(endOptions(s, day, NEW_YORK)).toEqual([
      "2026-10-30T17:00:00-04:00",
      "2026-10-31T17:00:00-04:00",
      "2026-11-01T17:00:00-05:00",
      "2026-11-02T17:00:00-05:00",
    ])
  })

  it("offers only the minimum when it equals the maximum", () => {
    const s = slot("2026-10-23T09:00:00+02:00", "2026-10-23T17:00:00+02:00", "2026-10-23T17:00:00+02:00")
    expect(endOptions(s, day, STOCKHOLM)).toEqual(["2026-10-23T17:00:00+02:00"])
    const f = slot("2026-10-21T09:00:00+02:00", "2026-10-21T10:00:00+02:00", "2026-10-21T10:00:00+02:00")
    expect(endOptions(f, flexible, STOCKHOLM)).toEqual(["2026-10-21T10:00:00+02:00"])
  })

  it(`caps the options at ${MAX_END_OPTIONS}`, () => {
    const f = slot("2026-10-21T09:00:00+02:00", "2026-10-21T09:01:00+02:00", "2026-10-21T19:00:00+02:00")
    const flexOptions = endOptions(f, { ...flexible, duration_step: "PT1M" }, STOCKHOLM)
    expect(flexOptions).toHaveLength(MAX_END_OPTIONS)
    expect(flexOptions.at(-1)).toBe("2026-10-21T11:00:00+02:00")

    const d = slot("2026-01-01T09:00:00+01:00", "2026-01-01T17:00:00+01:00", "2026-12-31T17:00:00+01:00")
    expect(endOptions(d, day, STOCKHOLM)).toHaveLength(MAX_END_OPTIONS)
  })

  it("offers just the minimum and maximum without a usable step", () => {
    const s = slot("2026-10-21T09:00:00+02:00", "2026-10-21T10:00:00+02:00", "2026-10-21T13:00:00+02:00")
    const both = ["2026-10-21T10:00:00+02:00", "2026-10-21T13:00:00+02:00"]
    expect(endOptions(s, { ...flexible, duration_step: "" }, STOCKHOLM)).toEqual(both)
    expect(endOptions(s, { ...flexible, duration_step: "PT0S" }, STOCKHOLM)).toEqual(both)
    expect(endOptions(s, fixed as Service, STOCKHOLM)).toEqual(both)
    const equal = slot("2026-10-21T09:00:00+02:00", "2026-10-21T10:00:00+02:00", "2026-10-21T10:00:00+02:00")
    expect(endOptions(equal, { ...flexible, duration_step: "" }, STOCKHOLM)).toEqual(["2026-10-21T10:00:00+02:00"])
  })
})

describe("bookingHref", () => {
  it("links to the new booking form with encoded timestamps", () => {
    expect(
      bookingHref({
        serviceId: "svc",
        locationId: "loc",
        resourceId: "res",
        startsAt: "2026-10-21T09:00:00+02:00",
        endsAt: "2026-10-21T09:45:00+02:00",
      })
    ).toBe(
      "/bookings/new?service=svc&location=loc&resource=res&starts_at=2026-10-21T09%3A00%3A00%2B02%3A00&ends_at=2026-10-21T09%3A45%3A00%2B02%3A00"
    )
  })

  it("leaves the resource out for auto-select", () => {
    const href = bookingHref({
      serviceId: "svc",
      locationId: "loc",
      resourceId: null,
      startsAt: "2026-10-29T10:00:00-04:00",
      endsAt: "2026-10-29T10:45:00-04:00",
    })
    expect(href).toBe(
      "/bookings/new?service=svc&location=loc&starts_at=2026-10-29T10%3A00%3A00-04%3A00&ends_at=2026-10-29T10%3A45%3A00-04%3A00"
    )
    const params = new URL(href, "http://x").searchParams
    expect(params.get("starts_at")).toBe("2026-10-29T10:00:00-04:00")
    expect(params.has("resource")).toBe(false)
  })

  it("round-trips a + offset through URLSearchParams", () => {
    const href = bookingHref({
      serviceId: "s",
      locationId: "l",
      resourceId: null,
      startsAt: "2026-10-23T09:00:00+02:00",
      endsAt: "2026-10-26T17:00:00+01:00",
    })
    const params = new URL(href, "http://x").searchParams
    expect(params.get("starts_at")).toBe("2026-10-23T09:00:00+02:00")
    expect(params.get("ends_at")).toBe("2026-10-26T17:00:00+01:00")
  })
})
