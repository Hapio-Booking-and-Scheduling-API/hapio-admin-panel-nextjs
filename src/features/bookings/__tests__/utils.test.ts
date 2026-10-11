import { afterEach, describe, expect, it, vi } from "vitest"

import {
  BOOKING_FILTER_FIELDS,
  BOOKING_GROUP_FILTER_FIELDS,
  BOOKING_SORT_FIELDS,
  UUID_RE,
  addIsoDuration,
  bookingStatus,
  bookingTimeRange,
  bookingTitle,
  bookingWhen,
  defaultDurationOf,
  endAfterStartChange,
  formatMinutes,
  groupSpan,
  instant,
  minutesBetween,
  offsetLabel,
  rezoneWallTime,
  shiftTimestamp,
  shortId,
  sortByStart,
  statusSummary,
  toBookingPutBody,
  toGroupBookingPutItem,
  toGroupPutBody,
  uniqueNames,
} from "../utils"
import {
  BEN,
  EQUIPMENT,
  GROUP_ID,
  HAIRCUT,
  NEW_YORK,
  STOCKHOLM,
  STUDIO,
  booking,
  embeddedBooking,
} from "./fixtures"

afterEach(() => {
  vi.useRealTimers()
})

describe("ids", () => {
  it("UUID_RE accepts UUIDs in any case and rejects everything else", () => {
    expect(UUID_RE.test(GROUP_ID)).toBe(true)
    expect(UUID_RE.test(GROUP_ID.toUpperCase())).toBe(true)
    expect(UUID_RE.test("")).toBe(false)
    expect(UUID_RE.test("not-a-uuid")).toBe(false)
    expect(UUID_RE.test(`${GROUP_ID}0`)).toBe(false)
    expect(UUID_RE.test(` ${GROUP_ID}`)).toBe(false)
    expect(UUID_RE.test(GROUP_ID.replace(/-/g, ""))).toBe(false)
  })

  it("shortId keeps the first 8 characters", () => {
    expect(shortId(GROUP_ID)).toBe("88888888")
    expect(shortId("abc")).toBe("abc")
  })
})

describe("status", () => {
  it("canceled wins over temporary, temporary over confirmed", () => {
    expect(bookingStatus({ is_canceled: true, is_temporary: true })).toBe("canceled")
    expect(bookingStatus({ is_canceled: false, is_temporary: true })).toBe("temporary")
    expect(bookingStatus({ is_canceled: false, is_temporary: false })).toBe("confirmed")
  })

  it("statusSummary counts in a fixed order and skips zeros", () => {
    expect(statusSummary([])).toBe("No bookings")
    expect(statusSummary([embeddedBooking(), embeddedBooking()])).toBe("2 confirmed")
    expect(
      statusSummary([
        embeddedBooking({ is_canceled: true }),
        embeddedBooking({ is_temporary: true }),
        embeddedBooking(),
        embeddedBooking(),
      ])
    ).toBe("2 confirmed · 1 temporary · 1 canceled")
    expect(statusSummary([embeddedBooking({ is_canceled: true, is_temporary: true })])).toBe("1 canceled")
  })
})

describe("time helpers", () => {
  it("offsetLabel reads the timestamp's own offset", () => {
    expect(offsetLabel("2026-10-22T09:00:00+02:00")).toBe("UTC+02:00")
    expect(offsetLabel("2026-10-29T10:00:00-04:00")).toBe("UTC-04:00")
    expect(offsetLabel("2026-10-22T09:00:00+00:00")).toBe("UTC")
    expect(offsetLabel("2026-10-22T09:00:00Z")).toBe("UTC")
    expect(offsetLabel("2026-10-22T09:00:00")).toBe("")
  })

  it("instant is NaN for empty or invalid input", () => {
    expect(instant("2026-10-22T09:00:00+02:00")).toBe(Date.UTC(2026, 9, 22, 7))
    expect(instant(null)).toBeNaN()
    expect(instant(undefined)).toBeNaN()
    expect(instant("")).toBeNaN()
    expect(instant("garbage")).toBeNaN()
  })

  it("minutesBetween compares instants, also across offsets and DST", () => {
    expect(minutesBetween("2026-10-22T09:00:00+02:00", "2026-10-22T09:45:00+02:00")).toBe(45)
    expect(minutesBetween("2026-10-22T09:00:00+02:00", "2026-10-22T03:30:00-04:00")).toBe(30)
    // The night the clocks go back: 01:30 → 03:30 wall time is three hours.
    expect(minutesBetween("2026-10-25T01:30:00+02:00", "2026-10-25T03:30:00+01:00")).toBe(180)
    expect(minutesBetween("2026-10-22T10:00:00+02:00", "2026-10-22T09:00:00+02:00")).toBe(-60)
    expect(minutesBetween("", "2026-10-22T09:00:00+02:00")).toBe(0)
    expect(minutesBetween("2026-10-22T09:00:00+02:00", "nope")).toBe(0)
  })

  it("formatMinutes", () => {
    expect(formatMinutes(0)).toBe("0 min")
    expect(formatMinutes(45)).toBe("45 min")
    expect(formatMinutes(60)).toBe("1 h")
    expect(formatMinutes(90)).toBe("1 h 30 min")
    expect(formatMinutes(1440)).toBe("1 day")
    expect(formatMinutes(2880 + 75)).toBe("2 days 1 h 15 min")
    expect(formatMinutes(-30)).toBe("−30 min")
    expect(formatMinutes(44.6)).toBe("45 min")
    expect(formatMinutes(Number.NaN)).toBe("—")
    expect(formatMinutes(Number.POSITIVE_INFINITY)).toBe("—")
  })

  it("bookingWhen shows the location's wall time", () => {
    expect(bookingWhen({ starts_at: "2026-10-22T09:00:00+02:00", ends_at: "2026-10-22T09:45:00+02:00" })).toEqual({
      date: "Thu 22 Oct 2026",
      time: "09:00–09:45",
    })
    // New York wall time, not the browser's (Stockholm).
    expect(bookingWhen({ starts_at: "2026-10-29T10:00:00-04:00", ends_at: "2026-10-29T10:45:00-04:00" })).toEqual({
      date: "Thu 29 Oct 2026",
      time: "10:00–10:45",
    })
    expect(bookingWhen({ starts_at: "2026-10-26T09:00:00+01:00", ends_at: "2026-10-27T17:00:00+01:00" })).toEqual({
      date: "Mon 26 Oct 2026",
      time: "09:00 → 27 Oct, 17:00",
    })
    expect(bookingWhen({ starts_at: "bad", ends_at: "2026-10-27T17:00:00+01:00" })).toEqual({ date: "bad", time: "" })
  })

  it("bookingTimeRange", () => {
    expect(bookingTimeRange({ starts_at: "2026-10-22T09:00:00+02:00", ends_at: "2026-10-22T09:45:00+02:00" })).toBe(
      "Thu 22 Oct 2026, 09:00–09:45"
    )
    expect(bookingTimeRange({ starts_at: "2026-10-26T09:00:00+01:00", ends_at: "2026-10-27T17:00:00+01:00" })).toBe(
      "26 Oct 2026, 09:00 → 27 Oct 2026, 17:00"
    )
    expect(bookingTimeRange({ starts_at: "x", ends_at: "y" })).toBe("x → y")
  })

  // A group across time zones: 09:00–13:45 UTC, from Stockholm to New York.
  const acrossZones = { starts_at: "2026-11-03T10:00:00+01:00", ends_at: "2026-11-03T08:45:00-05:00" }

  it("bookingTimeRange labels each end's offset when they differ", () => {
    expect(bookingTimeRange(acrossZones)).toBe("Tue 3 Nov 2026, 10:00 (UTC+01:00) → 08:45 (UTC-05:00)")
    expect(bookingTimeRange({ starts_at: "2026-11-03T10:00:00+01:00", ends_at: "2026-11-04T08:45:00-05:00" })).toBe(
      "3 Nov 2026, 10:00 (UTC+01:00) → 4 Nov 2026, 08:45 (UTC-05:00)"
    )
    // Across the DST change: 13 hours, not 12.
    expect(bookingTimeRange({ starts_at: "2026-10-24T22:00:00+02:00", ends_at: "2026-10-25T10:00:00+01:00" })).toBe(
      "24 Oct 2026, 22:00 (UTC+02:00) → 25 Oct 2026, 10:00 (UTC+01:00)"
    )
    // Z and +00:00 are the same offset.
    expect(bookingTimeRange({ starts_at: "2026-11-03T10:00:00Z", ends_at: "2026-11-03T11:00:00+00:00" })).toBe(
      "Tue 3 Nov 2026, 10:00–11:00"
    )
  })

  it("bookingWhen labels each end's offset when they differ", () => {
    expect(bookingWhen(acrossZones)).toEqual({ date: "Tue 3 Nov 2026", time: "10:00 (UTC+01:00) → 08:45 (UTC-05:00)" })
    expect(bookingWhen({ starts_at: "2026-11-03T22:00:00+01:00", ends_at: "2026-11-04T08:45:00-05:00" })).toEqual({
      date: "Tue 3 Nov 2026",
      time: "22:00 (UTC+01:00) → 4 Nov, 08:45 (UTC-05:00)",
    })
  })

  it("bookingTitle falls back when the service is gone", () => {
    expect(bookingTitle({ service: HAIRCUT })).toBe("Haircut")
    expect(bookingTitle({ service: null })).toBe("Booking")
  })
})

describe("collections", () => {
  const stockholm = embeddedBooking({
    id: "a",
    starts_at: "2026-10-29T15:00:00+01:00",
    ends_at: "2026-10-29T15:45:00+01:00",
  })
  // 10:00 in New York is 15:00 in Stockholm: starts at the same instant, ends later.
  const newYork = embeddedBooking({
    id: "b",
    location: NEW_YORK,
    service: STUDIO,
    starts_at: "2026-10-29T09:30:00-04:00",
    ends_at: "2026-10-29T11:00:00-04:00",
  })
  const early = embeddedBooking({
    id: "c",
    resource: BEN,
    starts_at: "2026-10-29T09:00:00+01:00",
    ends_at: "2026-10-29T09:45:00+01:00",
  })

  it("groupSpan uses instants, not wall times", () => {
    expect(groupSpan([])).toBeNull()
    expect(groupSpan([stockholm, newYork, early])).toEqual({
      starts_at: "2026-10-29T09:00:00+01:00",
      ends_at: "2026-10-29T11:00:00-04:00",
    })
  })

  it("a span across time zones is shown with each end's offset, never ending before it starts", () => {
    const span = groupSpan([stockholm, newYork, early])!
    expect(bookingTimeRange(span)).toBe("Thu 29 Oct 2026, 09:00 (UTC+01:00) → 11:00 (UTC-04:00)")
    expect(bookingWhen(span)).toEqual({ date: "Thu 29 Oct 2026", time: "09:00 (UTC+01:00) → 11:00 (UTC-04:00)" })
    // Bookings in one zone keep the plain range.
    expect(bookingTimeRange(groupSpan([stockholm, early])!)).toBe("Thu 29 Oct 2026, 09:00–15:45")
  })

  it("sortByStart sorts by instant without mutating", () => {
    const input = [stockholm, newYork, early]
    expect(sortByStart(input).map((b) => b.id)).toEqual(["c", "b", "a"])
    expect(input.map((b) => b.id)).toEqual(["a", "b", "c"])
  })

  it("uniqueNames keeps first-seen order and skips missing entities", () => {
    const orphan = embeddedBooking({ service: null, resource: null, location: null })
    expect(uniqueNames([stockholm, newYork, early, orphan], "service")).toEqual(["Haircut", "Studio rental"])
    expect(uniqueNames([stockholm, newYork, early, orphan], "resource")).toEqual(["Anna", "Ben"])
    expect(uniqueNames([stockholm, newYork, orphan], "location")).toEqual(["Stockholm Studio", "New York Loft"])
    expect(uniqueNames([], "service")).toEqual([])
  })
})

describe("durations", () => {
  it("defaultDurationOf", () => {
    expect(defaultDurationOf(undefined)).toBeNull()
    expect(defaultDurationOf(HAIRCUT)).toBe("PT45M")
    expect(defaultDurationOf(STUDIO)).toBe("PT1H")
    expect(defaultDurationOf({ ...STUDIO, default_duration: "PT2H" })).toBe("PT2H")
    expect(defaultDurationOf(EQUIPMENT)).toBeNull()
  })

  it("addIsoDuration adds exact hours across the EU DST change", () => {
    expect(addIsoDuration("2026-10-24T22:00:00+02:00", "PT6H", "Europe/Stockholm")).toBe("2026-10-25T03:00:00+01:00")
  })

  it("addIsoDuration adds calendar days in the zone (keeps the wall time)", () => {
    expect(addIsoDuration("2026-10-24T10:00:00+02:00", "P1D", "Europe/Stockholm")).toBe("2026-10-25T10:00:00+01:00")
    expect(addIsoDuration("2026-10-31T10:00:00-04:00", "P1D", "America/New_York")).toBe("2026-11-01T10:00:00-05:00")
    expect(addIsoDuration("2026-10-22T09:00:00+02:00", "PT45M", "Europe/Stockholm")).toBe("2026-10-22T09:45:00+02:00")
  })

  it("addIsoDuration expresses the result in the given zone, or the browser's", () => {
    expect(addIsoDuration("2026-10-22T09:00:00+02:00", "PT1H", "America/New_York")).toBe("2026-10-22T04:00:00-04:00")
    // vitest runs with TZ=Europe/Stockholm.
    expect(addIsoDuration("2026-10-22T03:00:00-04:00", "PT1H", null)).toBe("2026-10-22T10:00:00+02:00")
  })

  it("addIsoDuration returns null for bad input", () => {
    expect(addIsoDuration("2026-10-22T09:00:00+02:00", "1 hour", "Europe/Stockholm")).toBeNull()
    expect(addIsoDuration("2026-10-22T09:00:00+02:00", "", "Europe/Stockholm")).toBeNull()
    expect(addIsoDuration("not a date", "PT1H", "Europe/Stockholm")).toBeNull()
  })

  it("shiftTimestamp moves by milliseconds and formats in the zone", () => {
    expect(shiftTimestamp("2026-10-22T09:00:00+02:00", 3_600_000, "Europe/Stockholm")).toBe("2026-10-22T10:00:00+02:00")
    expect(shiftTimestamp("2026-10-24T22:00:00+02:00", 6 * 3_600_000, "Europe/Stockholm")).toBe(
      "2026-10-25T03:00:00+01:00"
    )
    expect(shiftTimestamp("2026-10-22T09:00:00+02:00", 0, "America/New_York")).toBe("2026-10-22T03:00:00-04:00")
    expect(shiftTimestamp("2026-10-22T09:00:00+02:00", -60_000, undefined)).toBe("2026-10-22T08:59:00+02:00")
    expect(shiftTimestamp("", 1000, "Europe/Stockholm")).toBeNull()
    expect(shiftTimestamp("2026-10-22T09:00:00+02:00", Number.NaN, "Europe/Stockholm")).toBeNull()
  })

  it("rezoneWallTime keeps the wall time in the new zone", () => {
    expect(rezoneWallTime("2026-10-22T09:00:00+02:00", "Europe/Stockholm", "America/New_York")).toBe(
      "2026-10-22T09:00:00-04:00"
    )
    expect(rezoneWallTime("2026-10-29T10:00:00-04:00", "America/New_York", "Europe/Stockholm")).toBe(
      "2026-10-29T10:00:00+01:00"
    )
    // Without a source zone, the timestamp's own wall time is kept.
    expect(rezoneWallTime("2026-10-22T09:00:00+02:00", null, "America/New_York")).toBe("2026-10-22T09:00:00-04:00")
    expect(rezoneWallTime("", "Europe/Stockholm", "America/New_York")).toBe("")
  })
})

describe("endAfterStartChange", () => {
  const zone = "Europe/Stockholm"

  it("does nothing without a new start", () => {
    expect(
      endAfterStartChange({ previousStart: "2026-10-22T09:00:00+02:00", nextStart: "", end: "x", service: HAIRCUT })
    ).toBeNull()
  })

  it("keeps the length when start and end are set", () => {
    expect(
      endAfterStartChange({
        previousStart: "2026-10-22T09:00:00+02:00",
        nextStart: "2026-10-22T10:30:00+02:00",
        end: "2026-10-22T09:45:00+02:00",
        service: HAIRCUT,
        timeZone: zone,
      })
    ).toBe("2026-10-22T11:15:00+02:00")
  })

  it("keeps the length in absolute time when the move crosses DST", () => {
    expect(
      endAfterStartChange({
        previousStart: "2026-10-23T10:00:00+02:00",
        nextStart: "2026-10-26T10:00:00+01:00",
        end: "2026-10-23T10:45:00+02:00",
        service: HAIRCUT,
        timeZone: zone,
      })
    ).toBe("2026-10-26T10:45:00+01:00")
  })

  it("returns null when the start didn't move", () => {
    expect(
      endAfterStartChange({
        previousStart: "2026-10-22T09:00:00+02:00",
        nextStart: "2026-10-22T09:00:00+02:00",
        end: "2026-10-22T09:45:00+02:00",
        service: HAIRCUT,
        timeZone: zone,
      })
    ).toBeNull()
  })

  it("fills an empty end from the service's default length", () => {
    const base = { previousStart: "", nextStart: "2026-10-22T09:00:00+02:00", end: "", timeZone: zone }
    expect(endAfterStartChange({ ...base, service: HAIRCUT })).toBe("2026-10-22T09:45:00+02:00")
    expect(endAfterStartChange({ ...base, service: STUDIO })).toBe("2026-10-22T10:00:00+02:00")
    expect(endAfterStartChange({ ...base, service: { ...STUDIO, default_duration: "PT2H30M" } })).toBe(
      "2026-10-22T11:30:00+02:00"
    )
    expect(endAfterStartChange({ ...base, service: EQUIPMENT })).toBeNull()
    expect(endAfterStartChange({ ...base, service: undefined })).toBeNull()
  })

  it("fills an empty end even when there was a previous start", () => {
    expect(
      endAfterStartChange({
        previousStart: "2026-10-22T08:00:00+02:00",
        nextStart: "2026-10-22T09:00:00+02:00",
        end: "",
        service: HAIRCUT,
        timeZone: zone,
      })
    ).toBe("2026-10-22T09:45:00+02:00")
  })

  it("leaves an end alone when there was no previous start", () => {
    expect(
      endAfterStartChange({
        previousStart: "",
        nextStart: "2026-10-22T09:00:00+02:00",
        end: "2026-10-22T12:00:00+02:00",
        service: HAIRCUT,
        timeZone: zone,
      })
    ).toBeNull()
  })

  it("expresses the new end in the location's zone", () => {
    expect(
      endAfterStartChange({
        previousStart: "",
        nextStart: "2026-10-29T10:00:00-04:00",
        end: "",
        service: HAIRCUT,
        timeZone: "America/New_York",
      })
    ).toBe("2026-10-29T10:45:00-04:00")
  })
})

describe("PUT bodies", () => {
  it("toBookingPutBody takes ids from the nested entities", () => {
    const b = booking({ booking_group: { ...booking(), id: GROUP_ID, metadata: { party: "x" } } })
    expect(toBookingPutBody(b)).toEqual({
      resource_id: b.resource!.id,
      service_id: HAIRCUT.id,
      location_id: STOCKHOLM.id,
      booking_group_id: GROUP_ID,
      price: "450.000",
      metadata: { customer: { name: "Erik Lund" } },
      protected_metadata: null,
      is_temporary: false,
      is_canceled: false,
      starts_at: "2026-10-22T09:00:00+02:00",
      ends_at: "2026-10-22T09:45:00+02:00",
      buffer_starts_at: "2026-10-22T09:00:00+02:00",
      buffer_ends_at: "2026-10-22T10:00:00+02:00",
    })
  })

  it("toBookingPutBody sends null for deleted entities and leaves out unreturned protected metadata", () => {
    const b = booking({ resource: null, service: null, location: null, price: null, protected_metadata: undefined })
    const body = toBookingPutBody(b)
    expect(body).toMatchObject({ resource_id: null, service_id: null, location_id: null, booking_group_id: null, price: null })
    expect("protected_metadata" in body).toBe(false)
    expect(Object.keys(body)).not.toContain("id")
    expect(Object.keys(body)).not.toContain("finalized_at")
  })

  it("toGroupBookingPutItem keeps the id but no group id", () => {
    const item = toGroupBookingPutItem(embeddedBooking({ protected_metadata: { secret: 1 } }))
    expect(item).toMatchObject({ id: "99999999-9999-4999-8999-999999999999", protected_metadata: { secret: 1 } })
    expect("booking_group_id" in item).toBe(false)
    expect("protected_metadata" in toGroupBookingPutItem(embeddedBooking({ protected_metadata: undefined }))).toBe(false)
  })

  it("toGroupPutBody sorts bookings by start", () => {
    const later = embeddedBooking({ id: "later", starts_at: "2026-11-03T11:00:00+01:00", ends_at: "2026-11-03T11:45:00+01:00" })
    const earlier = embeddedBooking({ id: "earlier", starts_at: "2026-11-03T10:00:00+01:00", ends_at: "2026-11-03T10:45:00+01:00" })
    const group = {
      id: GROUP_ID,
      created_at: "2026-10-01T10:00:00+02:00",
      updated_at: "2026-10-01T10:00:00+02:00",
      metadata: { party: "Lindqvist" },
      protected_metadata: null,
      bookings: [later, earlier],
    }
    const body = toGroupPutBody(group)
    expect(body.metadata).toEqual({ party: "Lindqvist" })
    expect(body.protected_metadata).toBeNull()
    expect(body.bookings.map((b) => b.id)).toEqual(["earlier", "later"])
    expect("protected_metadata" in toGroupPutBody({ ...group, protected_metadata: undefined })).toBe(false)
  })
})

describe("filter and sort fields", () => {
  it("booking filter fields cover the list's comparison filters", () => {
    expect(BOOKING_FILTER_FIELDS.map((f) => f.key)).toEqual([
      "starts_at",
      "ends_at",
      "price",
      "buffer_starts_at",
      "buffer_ends_at",
      "finalized_at",
      "canceled_at",
      "created_at",
      "updated_at",
      "metadata",
      "protected_metadata",
    ])
    expect(BOOKING_FILTER_FIELDS.find((f) => f.key === "price")?.type).toBe("price")
  })

  it("group filter fields prefix booking fields", () => {
    expect(BOOKING_GROUP_FILTER_FIELDS.slice(0, 4).map((f) => f.key)).toEqual([
      "group_created_at",
      "group_updated_at",
      "group_metadata",
      "group_protected_metadata",
    ])
    expect(BOOKING_GROUP_FILTER_FIELDS.find((f) => f.key === "starts_at")?.label).toBe("Booking starts")
    expect(BOOKING_GROUP_FILTER_FIELDS).toHaveLength(BOOKING_FILTER_FIELDS.length + 4)
  })

  it("sort fields", () => {
    expect(BOOKING_SORT_FIELDS.map(([key]) => key)).toEqual([
      "starts_at",
      "ends_at",
      "buffer_starts_at",
      "buffer_ends_at",
      "created_at",
      "updated_at",
    ])
  })
})
