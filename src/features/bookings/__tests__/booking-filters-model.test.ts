import { describe, expect, it } from "vitest"

import {
  BOOKING_FILTER_PARSERS,
  bookingFilterParams,
  bookingFiltersActive,
  type BookingFilters,
} from "../booking-filters-model"
import { BOOKING_FILTER_FIELDS } from "../utils"

const DEFAULTS: BookingFilters = {
  from: null,
  to: null,
  location: null,
  resource: null,
  service: null,
  temporary: "include",
  canceled: "include",
  f: null,
}

describe("BOOKING_FILTER_PARSERS", () => {
  it("default temporary and canceled to include", () => {
    expect(BOOKING_FILTER_PARSERS.temporary.defaultValue).toBe("include")
    expect(BOOKING_FILTER_PARSERS.canceled.defaultValue).toBe("include")
  })

  it("accept only the three inclusion values", () => {
    expect(BOOKING_FILTER_PARSERS.temporary.parse("only")).toBe("only")
    expect(BOOKING_FILTER_PARSERS.canceled.parse("exclude")).toBe("exclude")
    expect(BOOKING_FILTER_PARSERS.canceled.parse("maybe")).toBeNull()
  })

  it("parse advanced filter rows from JSON", () => {
    expect(BOOKING_FILTER_PARSERS.f.parse('[{"field":"price","op":"gte","value":"400"},{"bad":1}]')).toEqual([
      { field: "price", op: "gte", value: "400" },
    ])
  })
})

describe("bookingFilterParams", () => {
  it("sends the inclusion filters and nothing else by default", () => {
    expect(bookingFilterParams(DEFAULTS, BOOKING_FILTER_FIELDS)).toEqual({
      from: undefined,
      to: undefined,
      location: undefined,
      resource: undefined,
      service: undefined,
      temporary: "include",
      canceled: "include",
    })
  })

  it("passes through range, entity and inclusion filters", () => {
    expect(
      bookingFilterParams(
        {
          ...DEFAULTS,
          from: "2026-10-21T00:00:00+02:00",
          to: "2026-10-28T00:00:00+01:00",
          location: "loc",
          resource: "res",
          service: "svc",
          temporary: "only",
          canceled: "exclude",
        },
        BOOKING_FILTER_FIELDS
      )
    ).toEqual({
      from: "2026-10-21T00:00:00+02:00",
      to: "2026-10-28T00:00:00+01:00",
      location: "loc",
      resource: "res",
      service: "svc",
      temporary: "only",
      canceled: "exclude",
    })
  })

  it("converts advanced filter rows into operator and metadata params", () => {
    const params = bookingFilterParams(
      {
        ...DEFAULTS,
        f: [
          { field: "price", op: "gte", value: "400.000" },
          { field: "price", op: "lt", value: "600.000" },
          { field: "metadata", property: "customer->name", op: "seq", value: "Erik Lund" },
          { field: "starts_at", op: "gte", value: "" },
        ],
      },
      BOOKING_FILTER_FIELDS
    )
    expect(params).toMatchObject({
      price: { gte: "400.000", lt: "600.000" },
      metadata: [{ property: "customer->name", operator: "seq", value: "Erik Lund" }],
    })
    expect("starts_at" in params).toBe(false)
  })
})

describe("bookingFiltersActive", () => {
  it("is false for the defaults", () => {
    expect(bookingFiltersActive(DEFAULTS)).toBe(false)
    expect(bookingFiltersActive({ ...DEFAULTS, f: [] })).toBe(false)
  })

  it("is true when any filter differs from its default", () => {
    const changes: Partial<BookingFilters>[] = [
      { from: "2026-10-21T00:00:00+02:00" },
      { to: "2026-10-21T00:00:00+02:00" },
      { location: "loc" },
      { resource: "res" },
      { service: "svc" },
      { temporary: "exclude" },
      { temporary: "only" },
      { canceled: "exclude" },
      { canceled: "only" },
      { f: [{ field: "price", op: "gte", value: "1" }] },
    ]
    for (const change of changes) {
      expect(bookingFiltersActive({ ...DEFAULTS, ...change }), JSON.stringify(change)).toBe(true)
    }
  })
})
