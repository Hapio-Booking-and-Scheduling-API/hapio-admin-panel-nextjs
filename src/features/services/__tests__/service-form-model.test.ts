import { describe, expect, it, vi } from "vitest"

import { applyValidationErrors, HapioApiError } from "@/lib/hapio/errors"
import { WEEKDAYS, type Service, type ServiceDay, type ServiceFixed, type ServiceFlexible } from "@/lib/hapio/types"

import {
  DEFAULT_END,
  DEFAULT_START,
  FIELDS,
  TYPE_FIELDS,
  createBody,
  durationIssue,
  errorFieldMap,
  parseDays,
  patchBody,
  schema,
  toBody,
  toValues,
  weekdayRecord,
  type Values,
} from "../service-form-model"

// ---------------------------------------------------------------------------
// Fixtures

const timestamps = { created_at: "2026-09-01T10:00:00+00:00", updated_at: "2026-09-01T10:00:00+00:00" }
const common = {
  price: "450.000",
  buffer_time_before: "PT0S",
  buffer_time_after: "PT15M",
  booking_window_start: "PT0S",
  booking_window_end: null,
  cancelation_threshold: "PT0S",
  metadata: { category: "hair" },
  protected_metadata: null,
  enabled: true,
  ...timestamps,
}

const haircut: ServiceFixed = {
  id: "svc-fixed",
  name: "Haircut",
  type: "fixed",
  duration: "PT45M",
  bookable_interval: null,
  ...common,
}

const studio: ServiceFlexible = {
  id: "svc-flex",
  name: "Studio rental",
  type: "flexible",
  min_duration: "PT1H",
  max_duration: "PT4H",
  default_duration: null,
  duration_step: "PT30M",
  bookable_interval: null,
  ...common,
  price: "300.000",
}

const equipment: ServiceDay = {
  id: "svc-day",
  name: "Equipment rental",
  type: "day",
  start_time: "09:00:00",
  end_time: "17:00:00",
  min_days: 1,
  max_days: 7,
  default_days: null,
  ...common,
  price: "150.000",
}

const perWeekday = (time: string, overrides: Partial<Record<(typeof WEEKDAYS)[number], string>> = {}) =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, overrides[d] ?? time])) as Record<(typeof WEEKDAYS)[number], string>

/** Valid values for a new service of a type, with overrides. */
function values(overrides: Partial<Values> = {}): Values {
  return { ...toValues(), name: "Massage", ...overrides }
}

/** Issues from the schema as "path: message" strings. */
function issues(v: Values): string[] {
  const result = schema.safeParse(v)
  if (result.success) return []
  return result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
}

const all = () => true

// ---------------------------------------------------------------------------

describe("durationIssue", () => {
  it("allows null only when nullable", () => {
    expect(durationIssue(null, true)).toBeNull()
    expect(durationIssue(null)).toBe("Required")
  })

  it("rejects empty, invalid and zero durations", () => {
    expect(durationIssue("")).toBe("Required")
    expect(durationIssue("", true)).toBe("Required")
    expect(durationIssue("1H")).toBe("Not a valid ISO 8601 duration (e.g. PT1H30M)")
    expect(durationIssue("PT1.5H")).toBe("Not a valid ISO 8601 duration (e.g. PT1H30M)")
    expect(durationIssue("P1WT1H")).toBe("Not a valid ISO 8601 duration (e.g. PT1H30M)")
    expect(durationIssue("PT0S")).toBe("Must be longer than zero")
    expect(durationIssue("P0D", true)).toBe("Must be longer than zero")
  })

  it("accepts valid positive durations", () => {
    for (const value of ["PT45M", "PT1H30M", "P2W", "P1D", "PT30S"]) expect(durationIssue(value)).toBeNull()
  })
})

describe("parseDays", () => {
  it("treats empty text as null", () => {
    expect(parseDays("")).toBeNull()
    expect(parseDays("   ")).toBeNull()
  })

  it("parses whole numbers of at least 1, trimming whitespace", () => {
    expect(parseDays("1")).toBe(1)
    expect(parseDays(" 7 ")).toBe(7)
    expect(parseDays("120")).toBe(120)
  })

  it("returns NaN for anything else", () => {
    for (const text of ["0", "-1", "1.5", "1.0", "abc", "2 days", "1e2"]) {
      expect(parseDays(text), text).toBeNaN()
    }
  })
})

describe("weekdayRecord", () => {
  it("copies one time to every weekday", () => {
    expect(weekdayRecord("08:00:00", DEFAULT_START)).toEqual(perWeekday("08:00:00"))
  })

  it("uses the fallback for missing or empty values", () => {
    expect(weekdayRecord(undefined, DEFAULT_START)).toEqual(perWeekday("09:00:00"))
    expect(weekdayRecord("", DEFAULT_END)).toEqual(perWeekday("17:00:00"))
  })

  it("keeps per-weekday values and fills missing days", () => {
    const partial = { monday: "08:00:00", friday: "10:00:00" } as unknown as Record<(typeof WEEKDAYS)[number], string>
    expect(weekdayRecord(partial, DEFAULT_START)).toEqual(
      perWeekday("09:00:00", { monday: "08:00:00", friday: "10:00:00" })
    )
  })

  it("orders keys Monday to Sunday", () => {
    expect(Object.keys(weekdayRecord("09:00:00", DEFAULT_START))).toEqual([...WEEKDAYS])
  })
})

describe("toValues", () => {
  it("has defaults for a new service", () => {
    expect(toValues()).toEqual({
      name: "",
      type: "fixed",
      duration: "PT1H",
      bookable_interval: null,
      min_duration: "PT30M",
      max_duration: "PT4H",
      default_duration: null,
      duration_step: "PT30M",
      day_times_mode: "same",
      start_time: "09:00:00",
      end_time: "17:00:00",
      start_times: perWeekday("09:00:00"),
      end_times: perWeekday("17:00:00"),
      min_days: "1",
      max_days: "",
      default_days: "",
      price: "",
      buffer_time_before: "PT0S",
      buffer_time_after: "PT0S",
      booking_window_start: "PT0S",
      booking_window_end: null,
      cancelation_threshold: "PT0S",
      enabled: true,
      metadata: "",
      protected_metadata: "",
    })
  })

  it("reads a fixed service and keeps defaults for the other types' fields", () => {
    const v = toValues(haircut)
    expect(v).toMatchObject({
      name: "Haircut",
      type: "fixed",
      duration: "PT45M",
      bookable_interval: null,
      price: "450.000",
      buffer_time_after: "PT15M",
      min_duration: "PT30M",
      max_duration: "PT4H",
      min_days: "1",
    })
    expect(JSON.parse(v.metadata)).toEqual({ category: "hair" })
    expect(v.protected_metadata).toBe("")
  })

  it("reads a flexible service, keeping a null maximum", () => {
    expect(toValues(studio)).toMatchObject({ type: "flexible", min_duration: "PT1H", max_duration: "PT4H", duration_step: "PT30M" })
    expect(toValues({ ...studio, max_duration: null }).max_duration).toBeNull()
  })

  it("reads a day service with one time for every day", () => {
    expect(toValues(equipment)).toMatchObject({
      type: "day",
      day_times_mode: "same",
      start_time: "09:00:00",
      end_time: "17:00:00",
      start_times: perWeekday("09:00:00"),
      min_days: "1",
      max_days: "7",
      default_days: "",
    })
  })

  it("reads per-weekday times into weekday mode, with Monday as the single time", () => {
    const start = perWeekday("09:00:00", { monday: "08:00:00", saturday: "10:00:00" })
    const v = toValues({ ...equipment, start_time: start, end_time: "17:00:00", default_days: 2 })
    expect(v.day_times_mode).toBe("weekday")
    expect(v.start_time).toBe("08:00:00")
    expect(v.start_times).toEqual(start)
    expect(v.end_times).toEqual(perWeekday("17:00:00"))
    expect(v.default_days).toBe("2")
  })

  it("shows no maximum days as an empty field", () => {
    expect(toValues({ ...equipment, max_days: null }).max_days).toBe("")
  })
})

describe("schema: common fields", () => {
  it("accepts the defaults with a name", () => {
    expect(issues(values())).toEqual([])
  })

  it("requires a name of at most 100 characters", () => {
    expect(issues(values({ name: "   " }))).toEqual(["name: Required"])
    expect(issues(values({ name: "x".repeat(101) }))).toEqual(["name: At most 100 characters"])
    expect(issues(values({ name: "x".repeat(100) }))).toEqual([])
  })

  it("validates the price format", () => {
    expect(issues(values({ price: "149" }))).toEqual([])
    expect(issues(values({ price: "12,5" }))).toEqual([])
    expect(issues(values({ price: "" }))).toEqual([])
    expect(issues(values({ price: "abc" }))).toEqual([
      "price: Use a number with up to 12 digits and 3 decimals, e.g. 149.000",
    ])
    expect(issues(values({ price: "1.2345" }))).toHaveLength(1)
  })

  it("requires buffers, minimum notice and cancelation threshold, allowing zero", () => {
    // zod reports every failed check; the form shows the first one.
    expect(issues(values({ buffer_time_before: "" }))[0]).toBe("buffer_time_before: Required")
    expect(issues(values({ buffer_time_after: "15M" }))).toEqual([
      "buffer_time_after: Not a valid ISO 8601 duration (e.g. PT1H30M)",
    ])
    expect(issues(values({ booking_window_start: "PT0S", cancelation_threshold: "PT0S" }))).toEqual([])
    expect(issues(values({ cancelation_threshold: "P1W2D" }))).toHaveLength(1)
  })

  it("allows no booking horizon but rejects a zero one", () => {
    expect(issues(values({ booking_window_end: null }))).toEqual([])
    expect(issues(values({ booking_window_end: "P30D" }))).toEqual([])
    expect(issues(values({ booking_window_end: "PT0S" }))).toEqual(["booking_window_end: Must be longer than zero"])
    expect(issues(values({ booking_window_end: "nope" }))).toEqual([
      "booking_window_end: Not a valid ISO 8601 duration (e.g. PT1H30M)",
    ])
  })

  it("validates metadata JSON", () => {
    expect(issues(values({ metadata: '{"a":1}', protected_metadata: "" }))).toEqual([])
    expect(issues(values({ metadata: "[1]" }))).toEqual(["metadata: Metadata must be a JSON object."])
    expect(issues(values({ protected_metadata: "{oops" }))).toHaveLength(1)
  })
})

describe("schema: fixed", () => {
  it("requires a positive valid duration", () => {
    expect(issues(values({ duration: "" }))).toEqual(["duration: Required"])
    expect(issues(values({ duration: "PT1.5H" }))).toEqual(["duration: Not a valid ISO 8601 duration (e.g. PT1H30M)"])
    expect(issues(values({ duration: "PT0S" }))).toEqual(["duration: Must be longer than zero"])
    expect(issues(values({ duration: "P2W" }))).toEqual([])
  })

  it("allows a default bookable interval but rejects zero", () => {
    expect(issues(values({ bookable_interval: null }))).toEqual([])
    expect(issues(values({ bookable_interval: "PT15M" }))).toEqual([])
    expect(issues(values({ bookable_interval: "PT0S" }))).toEqual(["bookable_interval: Must be longer than zero"])
  })

  it("ignores the other types' fields", () => {
    expect(
      issues(values({ min_duration: "", duration_step: "x", start_time: "", min_days: "0", max_days: "abc" }))
    ).toEqual([])
  })
})

describe("schema: flexible", () => {
  const flex = (o: Partial<Values> = {}) =>
    values({ type: "flexible", min_duration: "PT1H", max_duration: "PT4H", duration_step: "PT30M", ...o })

  it("accepts a valid range", () => {
    expect(issues(flex())).toEqual([])
    expect(issues(flex({ max_duration: null }))).toEqual([])
    expect(issues(flex({ default_duration: "PT2H" }))).toEqual([])
    expect(issues(flex({ default_duration: "PT1H" }))).toEqual([])
    expect(issues(flex({ default_duration: "PT4H" }))).toEqual([])
  })

  it("requires minimum and step, and validates every duration", () => {
    expect(issues(flex({ min_duration: "" }))).toEqual(["min_duration: Required"])
    expect(issues(flex({ duration_step: "PT0S" }))).toEqual(["duration_step: Must be longer than zero"])
    expect(issues(flex({ max_duration: "4H" }))).toEqual(["max_duration: Not a valid ISO 8601 duration (e.g. PT1H30M)"])
    expect(issues(flex({ default_duration: "PT0S" }))).toEqual(["default_duration: Must be longer than zero"])
    expect(issues(flex({ bookable_interval: "" }))).toEqual(["bookable_interval: Required"])
  })

  it("rejects a maximum below the minimum", () => {
    expect(issues(flex({ max_duration: "PT30M" }))).toEqual(["max_duration: Must be at least the minimum length"])
    expect(issues(flex({ max_duration: "PT1H" }))).toEqual([])
  })

  it("rejects a default outside the range", () => {
    expect(issues(flex({ default_duration: "PT30M" }))).toEqual([
      "default_duration: Must be between the minimum and maximum length",
    ])
    expect(issues(flex({ default_duration: "PT5H" }))).toEqual([
      "default_duration: Must be between the minimum and maximum length",
    ])
    // No maximum: anything from the minimum up is fine.
    expect(issues(flex({ max_duration: null, default_duration: "P2D" }))).toEqual([])
  })

  it("skips range checks when an end of the range is invalid", () => {
    expect(issues(flex({ min_duration: "x", default_duration: "PT30M" }))).toEqual([
      "min_duration: Not a valid ISO 8601 duration (e.g. PT1H30M)",
    ])
    expect(issues(flex({ max_duration: "PT0S", default_duration: "PT5H" }))).toEqual([
      "max_duration: Must be longer than zero",
    ])
  })

  it("ignores the fixed duration", () => {
    expect(issues(flex({ duration: "" }))).toEqual([])
  })
})

describe("schema: day", () => {
  const day = (o: Partial<Values> = {}) => values({ type: "day", min_days: "1", max_days: "7", ...o })

  it("accepts valid same-time settings", () => {
    expect(issues(day())).toEqual([])
    expect(issues(day({ max_days: "", default_days: "" }))).toEqual([])
  })

  it("validates the single times in same-time mode only", () => {
    expect(issues(day({ start_time: "" }))).toEqual(["start_time: Required"])
    expect(issues(day({ end_time: "25:00:00" }))).toEqual(["end_time: Not a valid time"])
    expect(issues(day({ end_time: "17:00" }))).toEqual(["end_time: Not a valid time"])
    // Per-weekday values are ignored in this mode.
    expect(issues(day({ start_times: perWeekday("", { monday: "x" }) }))).toEqual([])
  })

  it("validates every weekday in per-weekday mode", () => {
    const v = day({
      day_times_mode: "weekday",
      start_time: "",
      start_times: perWeekday("09:00:00", { wednesday: "" }),
      end_times: perWeekday("17:00:00", { sunday: "99:00:00" }),
    })
    expect(issues(v)).toEqual(["start_times.wednesday: Required", "end_times.sunday: Not a valid time"])
  })

  it("accepts the end of the day (24:00:00) as an end time, but not as a start time", () => {
    expect(issues(day({ end_time: "24:00:00" }))).toEqual([])
    expect(issues(day({ start_time: "24:00:00" }))).toEqual(["start_time: Not a valid time"])
    const weekday = (o: Partial<Values>) => day({ day_times_mode: "weekday", ...o })
    expect(issues(weekday({ end_times: perWeekday("17:00:00", { friday: "24:00:00" }) }))).toEqual([])
    expect(issues(weekday({ start_times: perWeekday("09:00:00", { friday: "24:00:00" }) }))).toEqual([
      "start_times.friday: Not a valid time",
    ])
  })

  it("puts per-weekday issues on nested paths", () => {
    const result = schema.safeParse(day({ day_times_mode: "weekday", start_times: perWeekday("", {}) }))
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual(["start_times", "monday"])
  })

  it("validates day counts", () => {
    expect(issues(day({ min_days: "" }))).toEqual(["min_days: Required"])
    expect(issues(day({ min_days: "0" }))).toEqual(["min_days: Enter a whole number of at least 1"])
    expect(issues(day({ min_days: "1.5" }))).toEqual(["min_days: Enter a whole number of at least 1"])
    expect(issues(day({ max_days: "abc" }))).toEqual(["max_days: Enter a whole number of at least 1, or leave empty"])
    expect(issues(day({ default_days: "0" }))).toEqual([
      "default_days: Enter a whole number of at least 1, or leave empty",
    ])
  })

  it("checks the maximum and default against the minimum", () => {
    expect(issues(day({ min_days: "3", max_days: "2" }))).toEqual(["max_days: Must be at least the minimum days"])
    expect(issues(day({ min_days: "3", max_days: "3" }))).toEqual([])
    expect(issues(day({ min_days: "2", default_days: "1" }))).toEqual([
      "default_days: Must be between the minimum and maximum days",
    ])
    expect(issues(day({ max_days: "7", default_days: "8" }))).toEqual([
      "default_days: Must be between the minimum and maximum days",
    ])
    expect(issues(day({ max_days: "", default_days: "30" }))).toEqual([])
  })

  it("skips cross checks when the minimum is invalid", () => {
    expect(issues(day({ min_days: "x", max_days: "1", default_days: "1" }))).toEqual([
      "min_days: Enter a whole number of at least 1",
    ])
  })

  it("ignores the fixed and flexible fields", () => {
    expect(issues(day({ duration: "", min_duration: "", duration_step: "", bookable_interval: "PT0S" }))).toEqual([])
  })
})

describe("toBody", () => {
  it("sends every fixed field and nothing of the other types", () => {
    const body = toBody(values({ price: "149", metadata: '{"a":1}', protected_metadata: "" }), all)
    expect(body).toEqual({
      name: "Massage",
      buffer_time_before: "PT0S",
      buffer_time_after: "PT0S",
      booking_window_start: "PT0S",
      booking_window_end: null,
      cancelation_threshold: "PT0S",
      enabled: true,
      price: "149.000",
      metadata: { a: 1 },
      protected_metadata: null,
      duration: "PT1H",
      bookable_interval: null,
    })
  })

  it("sends an empty price as null", () => {
    expect(toBody(values({ price: "" }), all).price).toBeNull()
    expect(toBody(values({ price: "12,5" }), all).price).toBe("12.500")
  })

  it("sends only the fields `include` accepts", () => {
    const dirty = new Set(["name", "price"])
    expect(toBody(values({ price: "10" }), (k) => dirty.has(k))).toEqual({ name: "Massage", price: "10.000" })
    expect(toBody(values(), () => false)).toEqual({})
  })

  it("sends the flexible fields for a flexible service", () => {
    const body = toBody(values({ type: "flexible", max_duration: null, default_duration: "PT1H" }), all)
    expect(body).toMatchObject({
      min_duration: "PT30M",
      max_duration: null,
      default_duration: "PT1H",
      duration_step: "PT30M",
      bookable_interval: null,
    })
    expect(body).not.toHaveProperty("duration")
    expect(body).not.toHaveProperty("start_time")
  })

  it("sends single times and parsed day counts for a day service", () => {
    const body = toBody(values({ type: "day", min_days: "2", max_days: "", default_days: "3" }), all)
    expect(body).toMatchObject({ start_time: "09:00:00", end_time: "17:00:00", min_days: 2, max_days: null, default_days: 3 })
    expect(body).not.toHaveProperty("start_times")
    expect(body).not.toHaveProperty("day_times_mode")
    expect(body).not.toHaveProperty("duration")
  })

  it("sends per-weekday times ordered Monday to Sunday", () => {
    // Built in reverse order on purpose.
    const reversed = Object.fromEntries(
      [...WEEKDAYS].reverse().map((d) => [d, d === "saturday" ? "10:00:00" : "08:00:00"])
    ) as Record<(typeof WEEKDAYS)[number], string>
    const body = toBody(values({ type: "day", day_times_mode: "weekday", start_times: reversed }), all)
    expect(Object.keys(body.start_time as object)).toEqual([...WEEKDAYS])
    expect(Object.keys(body.end_time as object)).toEqual([...WEEKDAYS])
    expect(body.start_time).toEqual(perWeekday("08:00:00", { saturday: "10:00:00" }))
  })

  it("sends a changed day time only for the active mode", () => {
    const v = values({ type: "day", start_time: "08:00:00", start_times: perWeekday("07:00:00") })
    expect(toBody(v, (k) => k === "start_time")).toEqual({ start_time: "08:00:00" })
    // A per-weekday change is ignored while in same-time mode.
    expect(toBody(v, (k) => k === "start_times")).toEqual({})
    const w = { ...v, day_times_mode: "weekday" as const }
    expect(toBody(w, (k) => k === "end_times")).toEqual({ end_time: perWeekday("17:00:00") })
  })

  it("sends both times when the mode changes", () => {
    const v = values({ type: "day", day_times_mode: "weekday" })
    expect(toBody(v, (k) => k === "day_times_mode")).toEqual({
      start_time: perWeekday("09:00:00"),
      end_time: perWeekday("17:00:00"),
    })
    expect(toBody({ ...v, day_times_mode: "same" }, (k) => k === "day_times_mode")).toEqual({
      start_time: "09:00:00",
      end_time: "17:00:00",
    })
  })
})

describe("patchBody", () => {
  it("sends only dirty fields when the type stays", () => {
    const v = { ...toValues(haircut), price: "500", name: "Haircut" }
    expect(patchBody(v, haircut, new Set(["price"]))).toEqual({ price: "500.000" })
  })

  it("sends an empty body when nothing is dirty", () => {
    expect(patchBody(toValues(haircut), haircut, new Set())).toEqual({})
  })

  it("sends the new type and all its fields when the type changes to day", () => {
    const v = { ...toValues(haircut), type: "day" as const }
    expect(patchBody(v, haircut, new Set(["type"]))).toEqual({
      type: "day",
      start_time: "09:00:00",
      end_time: "17:00:00",
      min_days: 1,
      max_days: null,
      default_days: null,
    })
  })

  it("sends the new type and all its fields when the type changes to flexible", () => {
    const v = { ...toValues(haircut), type: "flexible" as const, name: "Hourly cut" }
    expect(patchBody(v, haircut, new Set(["type", "name"]))).toEqual({
      type: "flexible",
      name: "Hourly cut",
      min_duration: "PT30M",
      max_duration: "PT4H",
      default_duration: null,
      duration_step: "PT30M",
      bookable_interval: null,
    })
  })

  it("sends the fixed fields when a day service becomes fixed", () => {
    const v = { ...toValues(equipment), type: "fixed" as const }
    expect(patchBody(v, equipment, new Set(["type"]))).toEqual({ type: "fixed", duration: "PT1H", bookable_interval: null })
  })
})

describe("createBody", () => {
  it("adds the type and sends every field of it", () => {
    const body = createBody(values({ price: "149" }))
    expect(body).toMatchObject({ type: "fixed", name: "Massage", duration: "PT1H", bookable_interval: null, price: "149.000" })
    expect(Object.keys(body).sort()).toEqual(
      [
        "type",
        "name",
        "buffer_time_before",
        "buffer_time_after",
        "booking_window_start",
        "booking_window_end",
        "cancelation_threshold",
        "enabled",
        "price",
        "metadata",
        "duration",
        "bookable_interval",
      ].sort()
    )
  })

  it("omits empty protected metadata", () => {
    expect(createBody(values({ protected_metadata: "" }))).not.toHaveProperty("protected_metadata")
  })

  it("sends protected metadata when given", () => {
    expect(createBody(values({ protected_metadata: '{"secret":true}' })).protected_metadata).toEqual({ secret: true })
  })

  it("omits whitespace-only protected metadata", () => {
    expect(createBody(values({ protected_metadata: "  \n " }))).not.toHaveProperty("protected_metadata")
  })
})

describe("errorFieldMap", () => {
  it("maps per-weekday API keys to the single time in same-time mode", () => {
    const map = errorFieldMap("same")
    expect(map["start_time.monday"]).toBe("start_time")
    expect(map["end_time.sunday"]).toBe("end_time")
    expect(map).not.toHaveProperty("start_time")
    expect(Object.keys(map)).toHaveLength(14)
  })

  it("maps API keys to the weekday fields in per-weekday mode", () => {
    const map = errorFieldMap("weekday")
    expect(map.start_time).toBe("start_times")
    expect(map.end_time).toBe("end_times")
    expect(map["start_time.monday"]).toBe("start_times.monday")
    expect(map["end_time.friday"]).toBe("end_times.friday")
    expect(Object.keys(map)).toHaveLength(16)
  })

  it("routes server errors to the right fields with applyValidationErrors", () => {
    const error = new HapioApiError({
      status: 422,
      message: "The given data was invalid.",
      errors: { "start_time.monday": ["Bad Monday."], min_days: ["Too small."], unknown_field: ["Huh?"] },
    })
    const same = vi.fn()
    expect(applyValidationErrors(error, same, FIELDS, errorFieldMap("same"))).toEqual(["Huh?"])
    expect(same).toHaveBeenCalledWith("start_time", { type: "server", message: "Bad Monday." })
    expect(same).toHaveBeenCalledWith("min_days", { type: "server", message: "Too small." })

    const weekday = vi.fn()
    applyValidationErrors(error, weekday, FIELDS, errorFieldMap("weekday"))
    expect(weekday).toHaveBeenCalledWith("start_times.monday", { type: "server", message: "Bad Monday." })
  })
})

describe("FIELDS and TYPE_FIELDS", () => {
  it("lists every form field", () => {
    expect(FIELDS).toEqual(Object.keys(toValues()))
  })

  it("lists each type's own fields", () => {
    expect(TYPE_FIELDS.fixed).toEqual(["duration", "bookable_interval"])
    expect(TYPE_FIELDS.flexible).toContain("bookable_interval")
    expect(TYPE_FIELDS.day).toEqual(expect.arrayContaining(["start_times", "end_times", "day_times_mode", "min_days"]))
    for (const keys of Object.values(TYPE_FIELDS)) for (const key of keys) expect(FIELDS).toContain(key)
  })

  it("covers a real service of every type", () => {
    for (const service of [haircut, studio, equipment] as Service[]) {
      expect(issues(toValues(service)), service.name).toEqual([])
    }
  })
})
