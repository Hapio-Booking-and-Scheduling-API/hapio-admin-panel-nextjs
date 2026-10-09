import { describe, expect, it } from "vitest"
import {
  formatDuration,
  humanizeDuration,
  isValidDuration,
  isZeroDuration,
  parseDuration,
} from "@/lib/format/duration"
import { formatPrice, normalizePrice } from "@/lib/format/price"
import {
  formatDateTime,
  normalizeTime,
  toHapioDateTime,
  toWallTime,
} from "@/lib/format/datetime"

describe("duration", () => {
  it("parses and formats round-trip", () => {
    for (const value of ["PT0S", "PT15M", "PT1H30M", "P30D", "P2W", "P1Y2M3DT4H5M6S"]) {
      expect(formatDuration(parseDuration(value)!)).toBe(value)
    }
  })

  it("rejects invalid values", () => {
    for (const value of ["", "P", "PT", "P1H", "PT1.5H", "PT12345M", "1H", "P1WT1H"]) {
      expect(isValidDuration(value)).toBe(false)
    }
  })

  it("detects zero", () => {
    expect(isZeroDuration("PT0S")).toBe(true)
    expect(isZeroDuration("P0D")).toBe(true)
    expect(isZeroDuration("PT1M")).toBe(false)
  })

  it("formats zero as PT0S and folds weeks into days when mixed", () => {
    expect(formatDuration({})).toBe("PT0S")
    expect(formatDuration({ weeks: 1, hours: 2 })).toBe("P7DT2H")
  })

  it("humanizes", () => {
    expect(humanizeDuration("PT1H30M")).toBe("1 h 30 min")
    expect(humanizeDuration("P1D")).toBe("1 day")
    expect(humanizeDuration("PT0S")).toBe("0 min")
    expect(humanizeDuration(null)).toBe("—")
  })
})

describe("price", () => {
  it("normalises input", () => {
    expect(normalizePrice("149")).toBe("149.000")
    expect(normalizePrice("12,5")).toBe("12.500")
    expect(normalizePrice("0.125")).toBe("0.125")
    expect(normalizePrice("")).toBeNull()
    expect(normalizePrice("1.2345")).toBeUndefined()
    expect(normalizePrice("abc")).toBeUndefined()
  })

  it("formats for display", () => {
    expect(formatPrice(null)).toBe("—")
    expect(formatPrice("149.000")).toMatch(/149[.,]00/)
  })
})

describe("datetime", () => {
  it("converts wall time in a zone to a Hapio timestamp", () => {
    expect(toHapioDateTime("2024-05-14T08:30", "America/New_York")).toBe("2024-05-14T08:30:00-04:00")
    expect(toHapioDateTime("2024-01-14T08:30", "Europe/Stockholm")).toBe("2024-01-14T08:30:00+01:00")
    expect(toHapioDateTime("2024-01-14T08:30", "UTC")).toBe("2024-01-14T08:30:00+00:00")
  })

  it("converts timestamps back to wall time", () => {
    expect(toWallTime("2024-05-14T08:30:00-04:00")).toBe("2024-05-14T08:30")
    expect(toWallTime("2024-05-14T12:30:00+00:00", "Europe/Stockholm")).toBe("2024-05-14T14:30")
  })

  it("displays the timestamp's own wall time by default", () => {
    expect(formatDateTime("2024-05-14T08:30:00-04:00")).toBe("14 May 2024, 08:30")
    expect(formatDateTime("2024-05-14T08:30:00-04:00", { withOffset: true })).toBe(
      "14 May 2024, 08:30 (UTC-04:00)"
    )
  })

  it("normalises times", () => {
    expect(normalizeTime("9:00")).toBe("09:00:00")
    expect(normalizeTime("24:00")).toBe("24:00:00")
  })
})
