import { describe, expect, it } from "vitest"

import {
  CREATE_FLAGS,
  IGNORE_FLAGS,
  IGNORE_FLAG_DEFAULTS,
  activeIgnoreFlags,
  type IgnoreFlagValues,
} from "../override-rules-model"

const on = (...keys: Array<keyof IgnoreFlagValues>): IgnoreFlagValues => ({
  ...IGNORE_FLAG_DEFAULTS,
  ...Object.fromEntries(keys.map((k) => [k, true])),
})

describe("ignore flags", () => {
  it("default to off", () => {
    expect(Object.values(IGNORE_FLAG_DEFAULTS).every((v) => v === false)).toBe(true)
    expect(Object.keys(IGNORE_FLAG_DEFAULTS).sort()).toEqual(IGNORE_FLAGS.map((f) => f.key).sort())
  })

  it("list the cancelation flag for edit forms only", () => {
    expect(IGNORE_FLAGS.map((f) => f.key)).toEqual([
      "ignore_schedule",
      "ignore_fully_booked",
      "ignore_bookable_slots",
      "ignore_booking_window",
      "ignore_cancelation_threshold",
    ])
    expect(CREATE_FLAGS.map((f) => f.key)).not.toContain("ignore_cancelation_threshold")
    expect(CREATE_FLAGS).toHaveLength(4)
  })

  it("label every flag", () => {
    expect(IGNORE_FLAGS.map((f) => f.label)).toEqual([
      "Ignore schedule",
      "Ignore fully booked",
      "Ignore bookable slots",
      "Ignore booking window",
      "Ignore cancelation threshold",
    ])
  })
})

describe("activeIgnoreFlags", () => {
  it("is empty when nothing is on", () => {
    expect(activeIgnoreFlags(IGNORE_FLAG_DEFAULTS)).toEqual({})
  })

  it("returns only the flags that are on, as true", () => {
    expect(activeIgnoreFlags(on("ignore_schedule", "ignore_booking_window"))).toEqual({
      ignore_schedule: true,
      ignore_booking_window: true,
    })
  })

  it("leaves out ignore_cancelation_threshold unless asked for", () => {
    expect(activeIgnoreFlags(on("ignore_cancelation_threshold", "ignore_fully_booked"))).toEqual({
      ignore_fully_booked: true,
    })
    expect(activeIgnoreFlags(on("ignore_cancelation_threshold"), { cancelation: false })).toEqual({})
    expect(activeIgnoreFlags(on("ignore_cancelation_threshold"), { cancelation: true })).toEqual({
      ignore_cancelation_threshold: true,
    })
  })

  it("doesn't add implied flags", () => {
    // The UI shows ignore_bookable_slots as on when ignore_schedule is; the request carries only what was switched.
    expect(activeIgnoreFlags(on("ignore_schedule"))).toEqual({ ignore_schedule: true })
  })
})
