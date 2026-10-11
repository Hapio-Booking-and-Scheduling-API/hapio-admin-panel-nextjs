import { describe, expect, it } from "vitest"

import {
  durationToMinutes,
  EMPTY_DURATION,
  formatDuration,
  humanizeDuration,
  isValidDuration,
  isZeroDuration,
  parseDuration,
} from "@/lib/format/duration"

describe("parseDuration", () => {
  it("parses every element", () => {
    expect(parseDuration("P1Y2M3DT4H5M6S")).toEqual({
      years: 1,
      months: 2,
      weeks: 0,
      days: 3,
      hours: 4,
      minutes: 5,
      seconds: 6,
    })
    expect(parseDuration("P2W")).toEqual({ ...EMPTY_DURATION, weeks: 2 })
    expect(parseDuration("PT45M")).toEqual({ ...EMPTY_DURATION, minutes: 45 })
  })

  it("distinguishes months (date part) from minutes (time part)", () => {
    expect(parseDuration("P1M")).toEqual({ ...EMPTY_DURATION, months: 1 })
    expect(parseDuration("PT1M")).toEqual({ ...EMPTY_DURATION, minutes: 1 })
  })

  it("is case-insensitive", () => {
    expect(parseDuration("pt1h30m")).toEqual({ ...EMPTY_DURATION, hours: 1, minutes: 30 })
  })

  it("returns null for empty, bare and malformed values", () => {
    for (const value of [null, undefined, "", "P", "PT", "P1DT", "T1H", "PT1H2", "P-1D", "PT10000M", "P1.5D"]) {
      expect(parseDuration(value)).toBeNull()
    }
  })

  it("accepts the four-digit maximum", () => {
    expect(parseDuration("PT9999M")).toEqual({ ...EMPTY_DURATION, minutes: 9999 })
  })
})

describe("isValidDuration", () => {
  it("accepts weeks on their own only", () => {
    expect(isValidDuration("P3W")).toBe(true)
    expect(isValidDuration("P1W1D")).toBe(false)
    expect(isValidDuration("P1Y1W")).toBe(false)
    expect(isValidDuration("P1WT1S")).toBe(false)
  })

  it("accepts zero durations", () => {
    expect(isValidDuration("PT0S")).toBe(true)
    expect(isValidDuration("P0D")).toBe(true)
  })

  it("rejects a trailing T hidden by trailing whitespace ('P1DT ')", () => {
    expect(isValidDuration("P1DT ")).toBe(false)
    expect(parseDuration("P1DT ")).toBeNull()
  })

  it("rejects surrounding whitespace, which Hapio would reject too", () => {
    expect(isValidDuration(" PT1H ")).toBe(false)
    expect(isValidDuration("PT1H\n")).toBe(false)
    expect(parseDuration(" PT1H")).toBeNull()
  })
})

describe("isZeroDuration", () => {
  it("is true only for valid all-zero durations", () => {
    expect(isZeroDuration("PT0S")).toBe(true)
    expect(isZeroDuration("P0Y0M0DT0H0M0S")).toBe(true)
    expect(isZeroDuration("P0W")).toBe(true)
    expect(isZeroDuration("PT1S")).toBe(false)
    expect(isZeroDuration("")).toBe(false)
    expect(isZeroDuration("garbage")).toBe(false)
    expect(isZeroDuration(null)).toBe(false)
  })
})

describe("formatDuration", () => {
  it("formats weeks alone as P[n]W", () => {
    expect(formatDuration({ weeks: 2 })).toBe("P2W")
  })

  it("folds weeks into days when combined with anything else", () => {
    expect(formatDuration({ weeks: 1, days: 2 })).toBe("P9D")
    expect(formatDuration({ weeks: 2, minutes: 30 })).toBe("P14DT30M")
    expect(formatDuration({ years: 1, weeks: 1 })).toBe("P1Y7D")
  })

  it("clamps every element to 0..9999 and drops fractions", () => {
    expect(formatDuration({ hours: 12345 })).toBe("PT9999H")
    expect(formatDuration({ weeks: 20000 })).toBe("P9999W")
    expect(formatDuration({ weeks: 2000, days: 1 })).toBe("P9999D")
    expect(formatDuration({ minutes: 1.7 })).toBe("PT1M")
    expect(formatDuration({ minutes: -5, hours: 1 })).toBe("PT1H0M")
  })

  it("treats NaN as zero", () => {
    expect(formatDuration({ minutes: Number.NaN })).toBe("PT0S")
  })

  it("orders elements and omits empty parts", () => {
    expect(formatDuration({ seconds: 6, years: 1, hours: 4 })).toBe("P1YT4H6S")
    expect(formatDuration({ days: 1 })).toBe("P1D")
    expect(formatDuration({ ...EMPTY_DURATION })).toBe("PT0S")
  })

  it("produces values isValidDuration accepts", () => {
    for (const parts of [{ weeks: 3 }, { weeks: 1, hours: 1 }, { hours: 99999 }, {}]) {
      expect(isValidDuration(formatDuration(parts))).toBe(true)
    }
  })
})

describe("humanizeDuration", () => {
  it.each([
    ["P1Y", "1 year"],
    ["P2Y", "2 years"],
    ["P1M", "1 month"],
    ["P3M", "3 months"],
    ["P1W", "1 week"],
    ["P2W", "2 weeks"],
    ["P1D", "1 day"],
    ["P7D", "7 days"],
    ["PT1H", "1 h"],
    ["PT2H", "2 h"],
    ["PT1M", "1 min"],
    ["PT45M", "45 min"],
    ["PT1S", "1 s"],
    ["PT30S", "30 s"],
    ["P1Y2M3DT4H5M6S", "1 year 2 months 3 days 4 h 5 min 6 s"],
    ["PT0S", "0 min"],
    ["P0D", "0 min"],
  ])("%s → %s", (value, text) => {
    expect(humanizeDuration(value)).toBe(text)
  })

  it("shows a dash when empty and the raw value when invalid", () => {
    expect(humanizeDuration(null)).toBe("—")
    expect(humanizeDuration(undefined)).toBe("—")
    expect(humanizeDuration("")).toBe("—")
    expect(humanizeDuration("1 hour")).toBe("1 hour")
  })
})

describe("durationToMinutes", () => {
  it.each([
    ["PT45M", 45],
    ["PT1H30M", 90],
    ["P1D", 1440],
    ["P1W", 10080],
    ["P1M", 43200],
    ["P1Y", 525600],
    ["PT30S", 0.5],
    ["PT0S", 0],
    ["P1DT1H1M", 1501],
  ])("%s → %d", (value, minutes) => {
    expect(durationToMinutes(value)).toBe(minutes)
  })

  it("returns null for empty or invalid values", () => {
    expect(durationToMinutes(null)).toBeNull()
    expect(durationToMinutes("")).toBeNull()
    expect(durationToMinutes("garbage")).toBeNull()
  })
})
