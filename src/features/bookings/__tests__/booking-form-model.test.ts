import { describe, expect, it } from "vitest"

import {
  FIELDS,
  bookingToValues,
  emptyValues,
  schema,
  serviceBuffers,
  toPatchBody,
  toPostBody,
  type Values,
} from "../booking-form-model"
import { ANNA, EQUIPMENT, GROUP_ID, HAIRCUT, STOCKHOLM, STUDIO, booking } from "./fixtures"

const START = "2026-10-22T09:00:00+02:00"
const END = "2026-10-22T09:45:00+02:00"

/** A valid create form: Haircut at Stockholm, 09:00–09:45. */
function filled(overrides: Partial<Values> = {}): Values {
  return {
    ...emptyValues(),
    service_id: HAIRCUT.id,
    location_id: STOCKHOLM.id,
    starts_at: START,
    ends_at: END,
    ...overrides,
  }
}

/** Zod issue messages by top-level field. */
function issues(values: Values): Record<string, string[]> {
  const result = schema.safeParse(values)
  if (result.success) return {}
  const out: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    const key = String(issue.path[0])
    ;(out[key] ??= []).push(issue.message)
  }
  return out
}

describe("schema", () => {
  it("accepts a filled-in booking", () => {
    expect(issues(filled())).toEqual({})
  })

  it("requires service, location and times", () => {
    expect(issues(emptyValues())).toEqual({
      service_id: ["Select a service"],
      location_id: ["Select a location"],
      starts_at: ["Required"],
      ends_at: ["Required"],
    })
  })

  it("requires the end after the start, comparing instants", () => {
    expect(issues(filled({ ends_at: START }))).toEqual({ ends_at: ["Must be after the start"] })
    expect(issues(filled({ ends_at: "2026-10-22T08:00:00+02:00" }))).toEqual({ ends_at: ["Must be after the start"] })
    // 03:30 in New York is 09:30 in Stockholm: after the start.
    expect(issues(filled({ ends_at: "2026-10-22T03:30:00-04:00" }))).toEqual({})
  })

  it("validates the booking group id (trimmed)", () => {
    expect(issues(filled({ booking_group_id: "nope" }))).toEqual({ booking_group_id: ["Not a valid booking group ID"] })
    expect(issues(filled({ booking_group_id: `  ${GROUP_ID}  ` }))).toEqual({})
    expect(schema.parse(filled({ booking_group_id: `  ${GROUP_ID}  ` })).booking_group_id).toBe(GROUP_ID)
    expect(issues(filled({ booking_group_id: "   " }))).toEqual({})
  })

  it("validates metadata as a JSON object", () => {
    expect(issues(filled({ metadata: "{" })).metadata).toHaveLength(1)
    expect(issues(filled({ metadata: "[1]" }))).toEqual({ metadata: ["Metadata must be a JSON object."] })
    expect(issues(filled({ protected_metadata: '"x"' }))).toEqual({ protected_metadata: ["Metadata must be a JSON object."] })
    expect(issues(filled({ metadata: "null", protected_metadata: '{"a":1}' }))).toEqual({})
  })

  it("validates a manual price", () => {
    expect(issues(filled({ auto_price: false, price: "12.3456" }))).toEqual({
      price: ["Use a number with up to 12 digits and 3 decimals, e.g. 149.000"],
    })
    expect(issues(filled({ auto_price: false, price: "500" }))).toEqual({})
    expect(issues(filled({ auto_price: false, price: "" }))).toEqual({})
  })

  it("ignores the hidden price while it is calculated automatically", () => {
    expect(issues(filled({ auto_price: true, price: "abc" }))).toEqual({})
  })

  it("reports a bad manual price next to other errors", () => {
    expect(issues({ ...emptyValues(), auto_price: false, price: "abc" })).toMatchObject({
      service_id: ["Select a service"],
      price: ["Use a number with up to 12 digits and 3 decimals, e.g. 149.000"],
    })
  })

  describe("custom buffers", () => {
    const withBuffers = (overrides: Partial<Values> = {}) =>
      filled({
        custom_buffers: true,
        ignore_bookable_slots: true,
        buffer_starts_at: "2026-10-22T08:45:00+02:00",
        buffer_ends_at: "2026-10-22T10:00:00+02:00",
        ...overrides,
      })

    it("accepts valid buffers", () => {
      expect(issues(withBuffers())).toEqual({})
      expect(issues(withBuffers({ buffer_starts_at: START, buffer_ends_at: END }))).toEqual({})
    })

    it("requires both buffer times", () => {
      expect(issues(withBuffers({ buffer_starts_at: "", buffer_ends_at: "" }))).toEqual({
        buffer_starts_at: ["Required"],
        buffer_ends_at: ["Required"],
      })
    })

    it("orders buffers around the booking", () => {
      expect(
        issues(withBuffers({ buffer_starts_at: "2026-10-22T09:15:00+02:00", buffer_ends_at: "2026-10-22T09:30:00+02:00" }))
      ).toEqual({
        buffer_starts_at: ["Must be at or before the start"],
        buffer_ends_at: ["Must be at or after the end"],
      })
    })

    it("needs ignore bookable slots, or ignore schedule which implies it", () => {
      expect(issues(withBuffers({ ignore_bookable_slots: false }))).toEqual({
        custom_buffers: ["Custom buffers need “Ignore bookable slots” (under Override rules)."],
      })
      expect(issues(withBuffers({ ignore_bookable_slots: false, ignore_schedule: true }))).toEqual({})
    })

    it("are not validated while switched off", () => {
      expect(issues(filled({ custom_buffers: false, buffer_starts_at: "2026-10-22T09:30:00+02:00" }))).toEqual({})
    })
  })
})

describe("values", () => {
  it("FIELDS lists every form field", () => {
    expect(FIELDS).toEqual(Object.keys(emptyValues()))
    expect(FIELDS).toContain("ignore_cancelation_threshold")
    expect(FIELDS).toContain("custom_buffers")
  })

  it("emptyValues: auto price on, flags off, defaults merged", () => {
    const empty = emptyValues()
    expect(empty.auto_price).toBe(true)
    expect(empty.is_temporary).toBe(false)
    expect(empty.custom_buffers).toBe(false)
    expect(empty.ignore_schedule).toBe(false)
    expect(empty.ignore_cancelation_threshold).toBe(false)
    expect(emptyValues({ service_id: HAIRCUT.id, is_temporary: true, starts_at: START })).toMatchObject({
      service_id: HAIRCUT.id,
      is_temporary: true,
      starts_at: START,
      ends_at: "",
    })
  })

  it("bookingToValues maps nested entities and JSON", () => {
    const b = booking({
      booking_group: { ...booking(), id: GROUP_ID, metadata: null },
      protected_metadata: { secret: true },
      is_canceled: true,
    })
    expect(bookingToValues(b)).toEqual({
      service_id: HAIRCUT.id,
      location_id: STOCKHOLM.id,
      resource_id: ANNA.id,
      starts_at: START,
      ends_at: END,
      auto_price: true,
      price: "450.000",
      is_temporary: false,
      is_canceled: true,
      booking_group_id: GROUP_ID,
      metadata: JSON.stringify({ customer: { name: "Erik Lund" } }, null, 2),
      protected_metadata: JSON.stringify({ secret: true }, null, 2),
      ignore_schedule: false,
      ignore_fully_booked: false,
      ignore_bookable_slots: false,
      ignore_booking_window: false,
      ignore_cancelation_threshold: false,
      custom_buffers: false,
      buffer_starts_at: "2026-10-22T09:00:00+02:00",
      buffer_ends_at: "2026-10-22T10:00:00+02:00",
    })
  })

  it("bookingToValues uses empty strings for missing entities, price and metadata", () => {
    const v = bookingToValues(
      booking({ service: null, location: null, resource: null, price: null, metadata: null, protected_metadata: undefined })
    )
    expect(v).toMatchObject({ service_id: "", location_id: "", resource_id: "", price: "", metadata: "", protected_metadata: "" })
  })

  it("serviceBuffers describes the service's buffers", () => {
    expect(serviceBuffers(HAIRCUT)).toBe("0 min before, 15 min after")
    expect(serviceBuffers(STUDIO)).toBe("none")
    expect(serviceBuffers({ ...EQUIPMENT, buffer_time_before: "PT1H", buffer_time_after: "PT30M" })).toBe(
      "1 h before, 30 min after"
    )
  })
})

describe("toPostBody", () => {
  it("sends only the required fields for a minimal booking", () => {
    expect(toPostBody(filled())).toEqual({
      service_id: HAIRCUT.id,
      location_id: STOCKHOLM.id,
      starts_at: START,
      ends_at: END,
    })
  })

  it("adds the resource and group when set", () => {
    expect(toPostBody(filled({ resource_id: ANNA.id, booking_group_id: GROUP_ID }))).toMatchObject({
      resource_id: ANNA.id,
      booking_group_id: GROUP_ID,
    })
  })

  it("price: omitted while automatic, null when empty, normalised otherwise", () => {
    expect("price" in toPostBody(filled({ auto_price: true, price: "999" }))).toBe(false)
    expect(toPostBody(filled({ auto_price: false, price: "" })).price).toBeNull()
    expect(toPostBody(filled({ auto_price: false, price: "500" })).price).toBe("500.000")
    expect(toPostBody(filled({ auto_price: false, price: "12,5" })).price).toBe("12.500")
  })

  it("is_temporary only when on", () => {
    expect(toPostBody(filled({ is_temporary: true })).is_temporary).toBe(true)
    expect("is_temporary" in toPostBody(filled({ is_temporary: false }))).toBe(false)
  })

  it("never sends is_canceled", () => {
    expect("is_canceled" in toPostBody(filled({ is_canceled: true }))).toBe(false)
  })

  it("metadata: parsed objects; empty and null are left out", () => {
    expect(toPostBody(filled({ metadata: '{ "customer": { "name": "Ada" } }' })).metadata).toEqual({
      customer: { name: "Ada" },
    })
    expect("metadata" in toPostBody(filled({ metadata: "null" }))).toBe(false)
    expect("metadata" in toPostBody(filled({ metadata: "   " }))).toBe(false)
    expect(toPostBody(filled({ protected_metadata: '{"vip":true}' })).protected_metadata).toEqual({ vip: true })
    expect("protected_metadata" in toPostBody(filled({ protected_metadata: " \n " }))).toBe(false)
  })

  it("sends only the ignore flags that are on, and never the cancelation one", () => {
    const body = toPostBody(
      filled({ ignore_schedule: true, ignore_booking_window: true, ignore_cancelation_threshold: true })
    )
    expect(body).toMatchObject({ ignore_schedule: true, ignore_booking_window: true })
    expect("ignore_fully_booked" in body).toBe(false)
    expect("ignore_bookable_slots" in body).toBe(false)
    expect("ignore_cancelation_threshold" in body).toBe(false)
  })

  it("sends buffers only when custom buffers are on", () => {
    const buffers = { buffer_starts_at: "2026-10-22T08:45:00+02:00", buffer_ends_at: "2026-10-22T10:00:00+02:00" }
    expect(toPostBody(filled({ custom_buffers: true, ignore_bookable_slots: true, ...buffers }))).toMatchObject(buffers)
    const off = toPostBody(filled({ custom_buffers: false, ...buffers }))
    expect("buffer_starts_at" in off).toBe(false)
    expect("buffer_ends_at" in off).toBe(false)
  })
})

describe("toPatchBody", () => {
  const original = booking({ is_temporary: true, finalized_at: null })
  const loaded = bookingToValues(original)
  /** Values after editing, plus the dirty subset react-hook-form would report. */
  const edit = (changes: Partial<Values>) => {
    const values = { ...loaded, ...changes }
    return toPatchBody(values, changes)
  }

  it("returns null when nothing changed", () => {
    expect(toPatchBody(loaded, {})).toBeNull()
  })

  it("sends only dirty fields", () => {
    expect(edit({ starts_at: "2026-10-22T10:00:00+02:00", ends_at: "2026-10-22T10:45:00+02:00" })).toEqual({
      starts_at: "2026-10-22T10:00:00+02:00",
      ends_at: "2026-10-22T10:45:00+02:00",
    })
    expect(edit({ service_id: STUDIO.id })).toEqual({ service_id: STUDIO.id })
    expect(edit({ location_id: "loc" })).toEqual({ location_id: "loc" })
    expect(edit({ resource_id: "res" })).toEqual({ resource_id: "res" })
  })

  it("never sends an empty resource", () => {
    expect(edit({ resource_id: "" })).toBeNull()
  })

  it("metadata: parsed, and null when cleared", () => {
    expect(edit({ metadata: '{"a":1}' })).toEqual({ metadata: { a: 1 } })
    expect(edit({ metadata: "" })).toEqual({ metadata: null })
    expect(edit({ protected_metadata: '{"b":2}' })).toEqual({ protected_metadata: { b: 2 } })
  })

  it("booking group: null when cleared", () => {
    expect(edit({ booking_group_id: "" })).toEqual({ booking_group_id: null })
    expect(edit({ booking_group_id: GROUP_ID })).toEqual({ booking_group_id: GROUP_ID })
  })

  it("status switches", () => {
    expect(edit({ is_temporary: false })).toEqual({ is_temporary: false })
    expect(edit({ is_canceled: true })).toEqual({ is_canceled: true })
  })

  it("price: sent when automatic is off and the price changed", () => {
    expect(edit({ auto_price: false, price: "500" })).toEqual({ price: "500.000" })
    expect(edit({ auto_price: false, price: "" })).toEqual({ price: null })
  })

  it("price: nothing when switching back to automatic", () => {
    expect(toPatchBody({ ...loaded, auto_price: true, price: "500" }, { price: "500" })).toBeNull()
  })

  it("turning automatic price off without changing the price saves nothing", () => {
    expect(edit({ auto_price: false })).toBeNull()
  })

  it("price: with automatic off, new times or a new service keep the current price", () => {
    const later = { starts_at: "2026-10-22T10:00:00+02:00", ends_at: "2026-10-22T10:45:00+02:00" }
    expect(edit({ auto_price: false, ...later })).toEqual({ ...later, price: "450.000" })
    expect(edit({ auto_price: false, service_id: STUDIO.id })).toEqual({ service_id: STUDIO.id, price: "450.000" })
    // A new location or metadata doesn't make Hapio recalculate.
    expect(edit({ auto_price: false, metadata: '{"a":1}' })).toEqual({ metadata: { a: 1 } })
    // With automatic on, Hapio recalculates.
    expect(edit(later)).toEqual(later)
  })

  it("custom buffers are always sent while on", () => {
    expect(
      toPatchBody(
        { ...loaded, custom_buffers: true, buffer_starts_at: "2026-10-22T08:30:00+02:00" },
        { custom_buffers: true, buffer_starts_at: "2026-10-22T08:30:00+02:00" }
      )
    ).toEqual({ buffer_starts_at: "2026-10-22T08:30:00+02:00", buffer_ends_at: "2026-10-22T10:00:00+02:00" })
  })

  it("adds the ignore flags that are on, but only to a non-empty body", () => {
    expect(toPatchBody({ ...loaded, ignore_schedule: true }, { ignore_schedule: true })).toBeNull()
    expect(
      toPatchBody({ ...loaded, ignore_schedule: true, starts_at: "2026-10-22T10:00:00+02:00" }, {
        ignore_schedule: true,
        starts_at: "2026-10-22T10:00:00+02:00",
      })
    ).toEqual({ starts_at: "2026-10-22T10:00:00+02:00", ignore_schedule: true })
  })

  it("adds ignore_cancelation_threshold only when canceling", () => {
    expect(edit({ is_canceled: true, ignore_cancelation_threshold: true })).toEqual({
      is_canceled: true,
      ignore_cancelation_threshold: true,
    })
    expect(edit({ metadata: '{"a":1}', ignore_cancelation_threshold: true })).toEqual({ metadata: { a: 1 } })
  })

  it("an already canceled booking doesn't resend ignore_cancelation_threshold on unrelated edits", () => {
    const canceled = bookingToValues(booking({ is_canceled: true, canceled_at: "2026-10-20T08:00:00+02:00" }))
    const values = { ...canceled, metadata: '{"note":"x"}', ignore_cancelation_threshold: true }
    expect(toPatchBody(values, { metadata: values.metadata, ignore_cancelation_threshold: true })).toEqual({
      metadata: { note: "x" },
    })
  })
})
