import { describe, expect, it } from "vitest"

import {
  bookingToRow,
  editEmptyGroupSchema,
  emptyRow,
  groupToValues,
  mapGroupErrors,
  planPatch,
  rowChanges,
  rowSchema,
  rowToNew,
  schema,
  toastUnlessShownInline,
  type RowValues,
  type Values,
} from "@/features/booking-groups/booking-group-form-model"
import { HapioApiError } from "@/lib/hapio/errors"
import type { BookingEmbedded, BookingGroup, Location, Resource, Service } from "@/lib/hapio/types"

// ---------------------------------------------------------------------------
// Fixtures

const service = (id: string, name = id) => ({ id, name }) as unknown as Service
const location = (id: string, name = id) => ({ id, name }) as unknown as Location
const resource = (id: string, name = id) => ({ id, name }) as unknown as Resource

function booking(id: string, overrides: Partial<BookingEmbedded> = {}): BookingEmbedded {
  return {
    id,
    resource: resource("res-anna"),
    service: service("svc-haircut"),
    location: location("loc-sthlm"),
    price: "450.000",
    metadata: null,
    protected_metadata: null,
    is_temporary: false,
    is_canceled: false,
    starts_at: "2026-11-03T10:00:00+01:00",
    ends_at: "2026-11-03T10:45:00+01:00",
    buffer_starts_at: "2026-11-03T10:00:00+01:00",
    buffer_ends_at: "2026-11-03T11:00:00+01:00",
    finalized_at: "2026-10-20T08:00:00+00:00",
    canceled_at: null,
    created_at: "2026-10-20T08:00:00+00:00",
    updated_at: "2026-10-20T08:00:00+00:00",
    ...overrides,
  } as BookingEmbedded
}

const A = booking("a")
const B = booking("b", { resource: resource("res-ben") })

function group(bookings: BookingEmbedded[] = [A, B], overrides: Partial<BookingGroup> = {}): BookingGroup {
  return {
    id: "group-1",
    bookings,
    metadata: { party: "Lindqvist" },
    protected_metadata: null,
    created_at: "2026-10-20T08:00:00+00:00",
    updated_at: "2026-10-20T08:00:00+00:00",
    ...overrides,
  } as BookingGroup
}

/** Form values as the edit dialog starts them, with optional edits. */
function editValues(edit: (values: Values) => void = () => {}, original = [A, B]): Values {
  const values = groupToValues(group(original), original)
  edit(values)
  return values
}

const newRow = (overrides: Partial<RowValues> = {}): RowValues => ({
  ...emptyRow(),
  service_id: "svc-studio",
  location_id: "loc-ny",
  starts_at: "2026-11-05T10:00:00-05:00",
  ends_at: "2026-11-05T11:00:00-05:00",
  ...overrides,
})

const validation = (init: { errors?: Record<string, string[]>; messages?: Record<string, string> }) =>
  new HapioApiError({ status: 422, message: "The given data was invalid.", ...init })

// ---------------------------------------------------------------------------
// Conversions

describe("bookingToRow / groupToValues / emptyRow", () => {
  it("turns a booking into a row, with empty strings for missing relations and price", () => {
    expect(bookingToRow(A)).toEqual({
      booking_id: "a",
      service_id: "svc-haircut",
      location_id: "loc-sthlm",
      resource_id: "res-anna",
      starts_at: "2026-11-03T10:00:00+01:00",
      ends_at: "2026-11-03T10:45:00+01:00",
      price: "450.000",
      is_temporary: false,
      is_canceled: false,
    })
    const orphan = booking("o", { service: null, location: null, resource: null, price: null, is_canceled: true })
    expect(bookingToRow(orphan)).toMatchObject({
      service_id: "",
      location_id: "",
      resource_id: "",
      price: "",
      is_canceled: true,
    })
  })

  it("starts a create form with one empty row, empty metadata and every override off", () => {
    expect(groupToValues(undefined, [])).toEqual({
      metadata: "",
      protected_metadata: "",
      bookings: [emptyRow()],
      ignore_schedule: false,
      ignore_fully_booked: false,
      ignore_bookable_slots: false,
      ignore_booking_window: false,
      ignore_cancelation_threshold: false,
    })
  })

  it("starts an edit form from the group's bookings and pretty-printed metadata", () => {
    const values = groupToValues(group(), [B, A])
    expect(values.bookings.map((r) => r.booking_id)).toEqual(["b", "a"])
    expect(values.metadata).toBe('{\n  "party": "Lindqvist"\n}')
    expect(values.protected_metadata).toBe("")
  })

  it("copies service, location, resource and temporary from the previous row, nothing else", () => {
    const from: RowValues = {
      ...bookingToRow(booking("x", { is_temporary: true, is_canceled: true })),
    }
    expect(emptyRow(from)).toEqual({
      booking_id: "",
      service_id: "svc-haircut",
      location_id: "loc-sthlm",
      resource_id: "res-anna",
      starts_at: "",
      ends_at: "",
      price: "",
      is_temporary: true,
      is_canceled: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Schema

describe("schema", () => {
  const issues = (row: RowValues) => {
    const result = rowSchema.safeParse(row)
    return result.success ? [] : result.error.issues.map((i) => [i.path.join("."), i.message])
  }

  it("requires a service and a location on new rows only", () => {
    expect(issues(newRow({ service_id: "", location_id: "" }))).toEqual([
      ["service_id", "Select a service"],
      ["location_id", "Select a location"],
    ])
    // Existing bookings may have lost their service or location.
    expect(issues({ ...bookingToRow(A), service_id: "", location_id: "" })).toEqual([])
  })

  it("requires start and end", () => {
    expect(issues(newRow({ starts_at: "", ends_at: "" }))).toEqual([
      ["starts_at", "Required"],
      ["ends_at", "Required"],
    ])
  })

  it("requires the end to be after the start, comparing instants across offsets", () => {
    expect(issues(newRow({ starts_at: "2026-11-05T10:00:00+01:00", ends_at: "2026-11-05T09:00:00Z" }))).toEqual([
      ["ends_at", "Must be after the start"],
    ])
    expect(issues(newRow({ starts_at: "2026-11-05T10:00:00+01:00", ends_at: "2026-11-05T09:01:00Z" }))).toEqual([])
  })

  it("validates the price text", () => {
    expect(issues(newRow({ price: "12.3456" }))).toEqual([
      ["price", "Use a number with up to 12 digits and 3 decimals, e.g. 149.000"],
    ])
    expect(issues(newRow({ price: "12,5" }))).toEqual([])
  })

  it("needs at least one booking and valid metadata JSON", () => {
    const result = schema.safeParse({ ...groupToValues(undefined, []), bookings: [], metadata: "[1]" })
    expect(result.success).toBe(false)
    const messages = result.success ? [] : result.error.issues.map((i) => [i.path.join("."), i.message])
    expect(messages).toContainEqual(["bookings", "Add at least one booking."])
    expect(messages).toContainEqual(["metadata", "Metadata must be a JSON object."])
  })

  it("lets an empty group be edited without adding a booking, still validating the rest", () => {
    const empty = groupToValues(group([]), [])
    expect(empty.bookings).toEqual([])
    expect(editEmptyGroupSchema.safeParse({ ...empty, metadata: '{"party":"Nobody"}' }).success).toBe(true)
    const result = editEmptyGroupSchema.safeParse({ ...empty, metadata: "[1]", bookings: [newRow({ starts_at: "" })] })
    const messages = result.success ? [] : result.error.issues.map((i) => [i.path.join("."), i.message])
    expect(messages).toEqual([
      ["metadata", "Metadata must be a JSON object."],
      ["bookings.0.starts_at", "Required"],
    ])
  })
})

// ---------------------------------------------------------------------------
// Request bodies

describe("rowToNew", () => {
  it("sends only the required fields when nothing optional is set", () => {
    expect(rowToNew(newRow(), {})).toEqual({
      service_id: "svc-studio",
      location_id: "loc-ny",
      starts_at: "2026-11-05T10:00:00-05:00",
      ends_at: "2026-11-05T11:00:00-05:00",
    })
  })

  it("adds the resource, a normalised price, is_temporary and the ignore flags", () => {
    expect(
      rowToNew(newRow({ resource_id: "res-room", price: "12,5", is_temporary: true }), {
        ignore_schedule: true,
        ignore_fully_booked: true,
      })
    ).toEqual({
      service_id: "svc-studio",
      location_id: "loc-ny",
      resource_id: "res-room",
      starts_at: "2026-11-05T10:00:00-05:00",
      ends_at: "2026-11-05T11:00:00-05:00",
      price: "12.500",
      is_temporary: true,
      ignore_schedule: true,
      ignore_fully_booked: true,
    })
  })

  it("leaves a blank price out so Hapio calculates it", () => {
    expect(rowToNew(newRow({ price: "   " }), {})).not.toHaveProperty("price")
  })
})

describe("rowChanges", () => {
  const before = bookingToRow(A)

  it("is empty for an untouched row", () => {
    expect(rowChanges({ ...before }, before)).toEqual({})
  })

  it("compares times as instants, so another offset for the same moment is no change", () => {
    expect(
      rowChanges({ ...before, starts_at: "2026-11-03T09:00:00Z", ends_at: "2026-11-03T04:45:00-05:00" }, before)
    ).toEqual({})
  })

  it("sends moved times as the row's own strings", () => {
    expect(rowChanges({ ...before, starts_at: "2026-11-03T11:00:00+01:00", ends_at: "2026-11-03T11:45:00+01:00" }, before)).toEqual({
      starts_at: "2026-11-03T11:00:00+01:00",
      ends_at: "2026-11-03T11:45:00+01:00",
    })
  })

  it("normalises prices before comparing", () => {
    expect(rowChanges({ ...before, price: "450" }, before)).toEqual({})
    expect(rowChanges({ ...before, price: " 450,0 " }, before)).toEqual({})
    expect(rowChanges({ ...before, price: "500" }, before)).toEqual({ price: "500.000" })
  })

  it("sends price null when the price is cleared, and nothing when it was already empty", () => {
    expect(rowChanges({ ...before, price: "" }, before)).toEqual({ price: null })
    const free = bookingToRow(booking("f", { price: null }))
    expect(rowChanges({ ...free }, free)).toEqual({})
  })

  it("sends changed relations but never clears one", () => {
    expect(rowChanges({ ...before, service_id: "svc-studio", location_id: "loc-ny", resource_id: "res-ben" }, before)).toEqual({
      service_id: "svc-studio",
      location_id: "loc-ny",
      resource_id: "res-ben",
    })
    expect(rowChanges({ ...before, service_id: "", location_id: "", resource_id: "" }, before)).toEqual({})
  })

  it("sends status switches in both directions", () => {
    expect(rowChanges({ ...before, is_canceled: true }, before)).toEqual({ is_canceled: true })
    const canceled = bookingToRow(booking("c", { is_canceled: true, is_temporary: true }))
    expect(rowChanges({ ...canceled, is_canceled: false, is_temporary: false }, canceled)).toEqual({
      is_canceled: false,
      is_temporary: false,
    })
  })
})

describe("planPatch", () => {
  it("has nothing to send when the form is untouched", () => {
    expect(planPatch(editValues(), [A, B], {})).toEqual({ body: null, removed: [] })
  })

  it("leaves bookings out of a metadata-only change", () => {
    const values = editValues((v) => (v.metadata = '{"party":"Holm"}'))
    expect(planPatch(values, [A, B], { metadata: values.metadata })).toEqual({
      body: { metadata: { party: "Holm" } },
      removed: [],
    })
  })

  it("sends null for cleared metadata and includes dirty protected metadata", () => {
    const values = editValues((v) => {
      v.metadata = ""
      v.protected_metadata = '{"vip":true}'
    })
    expect(planPatch(values, [A, B], { metadata: "", protected_metadata: values.protected_metadata }).body).toEqual({
      metadata: null,
      protected_metadata: { vip: true },
    })
  })

  it("ignores metadata that isn't dirty even if the text differs", () => {
    const values = editValues((v) => (v.metadata = '{"party":"Holm"}'))
    expect(planPatch(values, [A, B], {}).body).toBeNull()
  })

  it("sends unchanged rows as { id } and changed rows as { id, ...changes }", () => {
    const values = editValues((v) => (v.bookings[1].starts_at = "2026-11-03T11:00:00+01:00"))
    expect(planPatch(values, [A, B], {})).toEqual({
      body: { bookings: [{ id: "a" }, { id: "b", starts_at: "2026-11-03T11:00:00+01:00" }] },
      removed: [],
    })
  })

  it("adds active ignore flags to changed and new rows, not to unchanged ones", () => {
    const values = editValues((v) => {
      v.bookings[0].price = "300"
      v.bookings.push(newRow())
      v.ignore_schedule = true
      v.ignore_booking_window = true
    })
    expect(planPatch(values, [A, B], {}).body?.bookings).toEqual([
      { id: "a", price: "300.000", ignore_schedule: true, ignore_booking_window: true },
      { id: "b" },
      {
        service_id: "svc-studio",
        location_id: "loc-ny",
        starts_at: "2026-11-05T10:00:00-05:00",
        ends_at: "2026-11-05T11:00:00-05:00",
        ignore_schedule: true,
        ignore_booking_window: true,
      },
    ])
  })

  it("sends new rows without an id, keeping every existing row", () => {
    const values = editValues((v) => v.bookings.push(newRow({ is_temporary: true })))
    const plan = planPatch(values, [A, B], {})
    expect(plan.removed).toEqual([])
    expect(plan.body?.bookings).toEqual([
      { id: "a" },
      { id: "b" },
      expect.not.objectContaining({ id: expect.anything() }),
    ])
    expect(plan.body?.bookings?.[2]).toMatchObject({ service_id: "svc-studio", is_temporary: true })
  })

  it("lists removed bookings and sends the remaining rows even when nothing else changed", () => {
    const values = editValues((v) => v.bookings.splice(0, 1))
    expect(planPatch(values, [A, B], {})).toEqual({ body: { bookings: [{ id: "b" }] }, removed: [A] })
  })

  it("sends ignore_cancelation_threshold only on a row that is being canceled", () => {
    const values = editValues((v) => {
      v.bookings[0].is_canceled = true
      v.bookings[1].price = "1"
      v.ignore_cancelation_threshold = true
    })
    expect(planPatch(values, [A, B], {}).body?.bookings).toEqual([
      { id: "a", is_canceled: true, ignore_cancelation_threshold: true },
      { id: "b", price: "1.000" },
    ])
  })

  it("doesn't send ignore_cancelation_threshold when restoring, on new rows, or when switched off", () => {
    const canceled = booking("c", { is_canceled: true })
    const restoring = editValues(
      (v) => {
        v.bookings[0].is_canceled = false
        v.bookings.push(newRow())
        v.ignore_cancelation_threshold = true
      },
      [canceled]
    )
    const items = planPatch(restoring, [canceled], {}).body?.bookings ?? []
    expect(items[0]).toEqual({ id: "c", is_canceled: false })
    expect(items[1]).not.toHaveProperty("ignore_cancelation_threshold")

    const off = editValues((v) => (v.bookings[0].is_canceled = true))
    expect(planPatch(off, [A, B], {}).body?.bookings?.[0]).toEqual({ id: "a", is_canceled: true })
  })

  it("treats a row whose booking isn't in the snapshot as unchanged", () => {
    const values = editValues((v) => v.bookings.push({ ...bookingToRow(booking("ghost")), price: "1" }))
    expect(planPatch(values, [A, B], {}).body).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Errors

describe("mapGroupErrors", () => {
  it("maps nothing for errors that aren't Hapio errors", () => {
    const none = { fieldErrors: [], formErrors: [], rowSummary: null, rowErrors: {} }
    expect(mapGroupErrors(new Error("boom"))).toEqual(none)
    expect(mapGroupErrors(undefined)).toEqual(none)
  })

  it("puts errors for row inputs on the field and names the row (1-based) in the summary", () => {
    expect(mapGroupErrors(validation({ errors: { "bookings.1.starts_at": ["Too early.", "Not open."] } }))).toEqual({
      fieldErrors: [["bookings.1.starts_at", "Too early. Not open."]],
      formErrors: [],
      rowSummary: "Hapio rejected booking 2. See the details on that row.",
      rowErrors: {},
    })
  })

  it("puts errors on fields without an input into the row alert, prefixed with the field", () => {
    const result = mapGroupErrors(
      validation({
        errors: {
          "bookings.0.buffer_ends_at": ["Must be after the end."],
          "bookings.0.id": ["The selected bookings.0.id is invalid."],
          "bookings.0.ignore_schedule": ["Missing ability."],
          "bookings.2": ["The bookings.2 must be an object."],
        },
      })
    )
    expect(result.fieldErrors).toEqual([])
    expect(result.rowErrors).toEqual({
      0: [
        "buffer_ends_at: Must be after the end.",
        "id: The selected bookings.0.id is invalid.",
        "ignore_schedule: Missing ability.",
      ],
      2: ["The bookings.2 must be an object."],
    })
    expect(result.rowSummary).toBe("Hapio rejected booking 1, 3. See the details on those rows.")
    expect(result.formErrors).toEqual([])
  })

  it("maps every row input to its field path", () => {
    const fields = ["service_id", "location_id", "resource_id", "starts_at", "ends_at", "price", "is_temporary", "is_canceled"]
    const errors = Object.fromEntries(fields.map((f) => [`bookings.0.${f}`, [`bad ${f}`]]))
    const result = mapGroupErrors(validation({ errors }))
    expect(result.fieldErrors).toEqual(fields.map((f) => [`bookings.0.${f}`, `bad ${f}`]))
    expect(result.rowErrors).toEqual({})
  })

  it("puts group metadata errors on the metadata fields", () => {
    const result = mapGroupErrors(
      validation({ errors: { metadata: ["Too long."], protected_metadata: ["Not allowed."] } })
    )
    expect(result).toEqual({
      fieldErrors: [
        ["metadata", "Too long."],
        ["protected_metadata", "Not allowed."],
      ],
      formErrors: [],
      rowSummary: null,
      rowErrors: {},
    })
  })

  it("puts other keys in the form errors, unprefixed for the bookings array itself", () => {
    const result = mapGroupErrors(
      validation({ errors: { bookings: ["The bookings must have at least 1 item."], foo: ["Unknown."] } })
    )
    expect(result.formErrors).toEqual(["The bookings must have at least 1 item.", "foo: Unknown."])
    expect(result.rowSummary).toBeNull()
    expect(result.rowErrors).toEqual({})
  })

  it("puts per-booking messages in the row alert and other messages in the form errors", () => {
    const result = mapGroupErrors(validation({ messages: { "bookings.3": "Fully booked.", general: "Try again." } }))
    expect(result.rowErrors).toEqual({ 3: ["Fully booked."] })
    expect(result.rowSummary).toBe("Hapio rejected booking 4. See the details on that row.")
    expect(result.formErrors).toEqual(["Try again."])
  })

  it("lists failed rows in numeric order, once each, apart from other form errors", () => {
    const result = mapGroupErrors(
      validation({
        errors: { "bookings.10.price": ["Bad."], "bookings.2.ends_at": ["Bad."], other: ["Oops."] },
        messages: { "bookings.10": "Rejected.", "bookings.2": "Rejected." },
      })
    )
    expect(result.rowSummary).toBe("Hapio rejected booking 3, 11. See the details on those rows.")
    expect(result.formErrors).toEqual(["other: Oops."])
  })

  it("doesn't repeat a row message in the row alert when the field already shows it inline", () => {
    const result = mapGroupErrors(
      validation({
        errors: { "bookings.1.starts_at": ["The starts at is outside the schedule."] },
        messages: { "bookings.1": "The starts at is outside the schedule." },
      })
    )
    expect(result.fieldErrors).toEqual([["bookings.1.starts_at", "The starts at is outside the schedule."]])
    expect(result.rowErrors).toEqual({})
    expect(result.rowSummary).toBe("Hapio rejected booking 2. See the details on that row.")
  })

  it("matches repeated messages per row and per message, keeping the ones that differ", () => {
    const result = mapGroupErrors(
      validation({
        errors: {
          "bookings.0.starts_at": ["Too early.", "Outside the schedule."],
          "bookings.1": ["Fully booked."],
        },
        messages: { "bookings.0": "Outside the schedule.", "bookings.1": "Fully booked.", "bookings.2": "Too early." },
      })
    )
    expect(result.fieldErrors).toEqual([["bookings.0.starts_at", "Too early. Outside the schedule."]])
    expect(result.rowErrors).toEqual({ 1: ["Fully booked."], 2: ["Too early."] })
  })
})

describe("toastUnlessShownInline", () => {
  it("doesn't toast 422s that carry field errors or row messages", () => {
    expect(toastUnlessShownInline(validation({ errors: { "bookings.0.starts_at": ["x"] } }))).toBe(false)
    expect(toastUnlessShownInline(validation({ messages: { "bookings.0": "x" } }))).toBe(false)
  })

  it("toasts everything else", () => {
    expect(toastUnlessShownInline(validation({}))).toBe(true)
    expect(toastUnlessShownInline(validation({ errors: {}, messages: {} }))).toBe(true)
    expect(toastUnlessShownInline(new HapioApiError({ status: 500, message: "Server error" }))).toBe(true)
    expect(toastUnlessShownInline(new HapioApiError({ status: 0, message: "Network error" }))).toBe(true)
    expect(toastUnlessShownInline(new Error("boom"))).toBe(true)
  })
})
