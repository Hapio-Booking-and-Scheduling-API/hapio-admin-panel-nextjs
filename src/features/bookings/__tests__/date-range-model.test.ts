import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PRESETS, monthRange, rangeLabel, shortStamp } from "../date-range-model"

const STOCKHOLM = "Europe/Stockholm"
const NEW_YORK = "America/New_York"

const preset = (key: string, tz: string) => PRESETS.find((p) => p.key === key)!.range(tz)

beforeEach(() => {
  vi.useFakeTimers()
  // Wed 21 Oct 2026 08:00 in Stockholm (the e2e "now").
  vi.setSystemTime(new Date("2026-10-21T08:00:00+02:00"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("PRESETS", () => {
  it("are listed in order", () => {
    expect(PRESETS.map((p) => p.label)).toEqual(["Today", "Next 7 days", "This month", "Past 7 days"])
  })

  it("compute day ranges in Stockholm, crossing the EU DST change", () => {
    expect(preset("today", STOCKHOLM)).toEqual({ from: "2026-10-21T00:00:00+02:00", to: "2026-10-22T00:00:00+02:00" })
    expect(preset("next7", STOCKHOLM)).toEqual({ from: "2026-10-21T00:00:00+02:00", to: "2026-10-28T00:00:00+01:00" })
    expect(preset("past7", STOCKHOLM)).toEqual({ from: "2026-10-15T00:00:00+02:00", to: "2026-10-22T00:00:00+02:00" })
    expect(preset("month", STOCKHOLM)).toEqual({ from: "2026-10-01T00:00:00+02:00", to: "2026-11-01T00:00:00+01:00" })
  })

  it("compute day ranges in New York", () => {
    expect(preset("today", NEW_YORK)).toEqual({ from: "2026-10-21T00:00:00-04:00", to: "2026-10-22T00:00:00-04:00" })
    expect(preset("next7", NEW_YORK)).toEqual({ from: "2026-10-21T00:00:00-04:00", to: "2026-10-28T00:00:00-04:00" })
    // US DST ends at 02:00 on 1 November, so midnight is still -04:00.
    expect(preset("month", NEW_YORK)).toEqual({ from: "2026-10-01T00:00:00-04:00", to: "2026-11-01T00:00:00-04:00" })
  })

  it("use today in the given zone, not the browser's", () => {
    // 21 Oct 03:00 in Stockholm is still 20 Oct in New York.
    vi.setSystemTime(new Date("2026-10-21T03:00:00+02:00"))
    expect(preset("today", NEW_YORK)).toEqual({ from: "2026-10-20T00:00:00-04:00", to: "2026-10-21T00:00:00-04:00" })
    expect(preset("today", STOCKHOLM)).toEqual({ from: "2026-10-21T00:00:00+02:00", to: "2026-10-22T00:00:00+02:00" })
  })
})

describe("monthRange", () => {
  it("spans the EU spring DST change", () => {
    vi.setSystemTime(new Date("2026-03-15T12:00:00+01:00"))
    expect(monthRange(STOCKHOLM)).toEqual({ from: "2026-03-01T00:00:00+01:00", to: "2026-04-01T00:00:00+02:00" })
  })

  it("spans the US autumn DST change", () => {
    vi.setSystemTime(new Date("2026-11-15T12:00:00-05:00"))
    expect(monthRange(NEW_YORK)).toEqual({ from: "2026-11-01T00:00:00-04:00", to: "2026-12-01T00:00:00-05:00" })
  })

  it("picks the month of the zone at a month boundary", () => {
    // 31 Oct 23:30 in New York is 1 Nov 04:30 in Stockholm.
    vi.setSystemTime(new Date("2026-10-31T23:30:00-04:00"))
    expect(monthRange(NEW_YORK).from).toBe("2026-10-01T00:00:00-04:00")
    expect(monthRange(STOCKHOLM)).toEqual({ from: "2026-11-01T00:00:00+01:00", to: "2026-12-01T00:00:00+01:00" })
  })

  it("rolls over the year", () => {
    vi.setSystemTime(new Date("2026-12-24T12:00:00+01:00"))
    expect(monthRange(STOCKHOLM)).toEqual({ from: "2026-12-01T00:00:00+01:00", to: "2027-01-01T00:00:00+01:00" })
  })
})

describe("shortStamp", () => {
  it("drops midnight times", () => {
    expect(shortStamp("2026-10-22T00:00:00+02:00", STOCKHOLM)).toBe("22 Oct 2026")
    expect(shortStamp("2026-10-22T09:30:00+02:00", STOCKHOLM)).toBe("22 Oct 2026, 09:30")
  })

  it("shows the time in the given zone", () => {
    expect(shortStamp("2026-10-22T06:00:00+02:00", NEW_YORK)).toBe("22 Oct 2026")
    expect(shortStamp("2026-10-22T00:00:00+02:00", NEW_YORK)).toBe("21 Oct 2026, 18:00")
  })
})

describe("rangeLabel", () => {
  it("says Any date without bounds", () => {
    expect(rangeLabel({ from: null, to: null }, STOCKHOLM)).toBe("Any date")
  })

  it("names every preset", () => {
    for (const p of PRESETS) {
      expect(rangeLabel(p.range(STOCKHOLM), STOCKHOLM)).toBe(p.label)
      expect(rangeLabel(p.range(NEW_YORK), NEW_YORK)).toBe(p.label)
    }
  })

  it("matches presets by instant, whatever the offset notation", () => {
    expect(rangeLabel({ from: "2026-10-20T22:00:00Z", to: "2026-10-21T22:00:00+00:00" }, STOCKHOLM)).toBe("Today")
  })

  it("doesn't treat another zone's preset as a preset", () => {
    expect(rangeLabel(preset("today", STOCKHOLM), NEW_YORK)).toBe("20 Oct 2026, 18:00 – 21 Oct 2026, 18:00")
  })

  it("labels custom ranges", () => {
    expect(rangeLabel({ from: "2026-10-22T09:00:00+02:00", to: "2026-10-23T00:00:00+02:00" }, STOCKHOLM)).toBe(
      "22 Oct 2026, 09:00 – 23 Oct 2026"
    )
  })

  it("labels open-ended ranges", () => {
    expect(rangeLabel({ from: "2026-10-22T09:00:00+02:00", to: null }, STOCKHOLM)).toBe("From 22 Oct 2026, 09:00")
    expect(rangeLabel({ from: null, to: "2026-11-01T00:00:00+01:00" }, STOCKHOLM)).toBe("Until 1 Nov 2026")
    expect(rangeLabel({ from: "2026-10-22T15:00:00+02:00", to: null }, NEW_YORK)).toBe("From 22 Oct 2026, 09:00")
  })

  it("follows the clock: yesterday's Today becomes a custom range", () => {
    const today = preset("today", STOCKHOLM)
    vi.setSystemTime(new Date("2026-10-22T08:00:00+02:00"))
    expect(rangeLabel(today, STOCKHOLM)).toBe("21 Oct 2026 – 22 Oct 2026")
  })
})
