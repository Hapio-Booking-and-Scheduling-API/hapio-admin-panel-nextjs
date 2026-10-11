import { afterEach, describe, expect, it, vi } from "vitest"

import type { Location, RecurringSchedule, RecurringScheduleBlock } from "@/lib/hapio/types"

import {
  SERVICE_TYPE_LABELS,
  addDaysTo,
  compareWeeklyBlocks,
  formatHours,
  formatMaxSimultaneous,
  formatMinutes,
  intervalLabel,
  isDateString,
  mondayOf,
  nowWallDate,
  parseDateString,
  recurringScheduleStatus,
  spanMinutes,
  toDateString,
  zonedWallDate,
} from "../utils"

/** Local wall-clock fields of a Date, for readable assertions. */
const wall = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`

afterEach(() => {
  vi.useRealTimers()
})

describe("labels", () => {
  it("labels service types", () => {
    expect(SERVICE_TYPE_LABELS).toEqual({ fixed: "Fixed", flexible: "Flexible", day: "Day" })
  })

  it("formats max simultaneous bookings", () => {
    expect(formatMaxSimultaneous(null)).toBe("Unlimited")
    expect(formatMaxSimultaneous(1)).toBe("1")
    expect(formatMaxSimultaneous(12)).toBe("12")
  })

  it("labels the repeat interval", () => {
    expect(intervalLabel(1)).toBe("Every week")
    expect(intervalLabel(2)).toBe("Every 2 weeks")
    expect(intervalLabel(52)).toBe("Every 52 weeks")
  })
})

describe("spanMinutes", () => {
  it("measures absolute time between two timestamps", () => {
    expect(spanMinutes("2026-10-22T09:00:00+02:00", "2026-10-22T17:00:00+02:00")).toBe(480)
    // Different offsets for the same instant.
    expect(spanMinutes("2026-10-22T09:00:00-04:00", "2026-10-22T15:00:00+02:00")).toBe(0)
  })

  it("counts the extra hour on the night the clocks go back", () => {
    expect(spanMinutes("2026-10-25T00:00:00+02:00", "2026-10-26T00:00:00+01:00")).toBe(25 * 60)
    expect(spanMinutes("2026-03-29T00:00:00+01:00", "2026-03-30T00:00:00+02:00")).toBe(23 * 60)
  })

  it("never goes negative and treats garbage as zero", () => {
    expect(spanMinutes("2026-10-22T17:00:00+02:00", "2026-10-22T09:00:00+02:00")).toBe(0)
    expect(spanMinutes("not a date", "2026-10-22T09:00:00+02:00")).toBe(0)
    expect(spanMinutes("", "")).toBe(0)
  })

  it("rounds to whole minutes", () => {
    expect(spanMinutes("2026-10-22T09:00:00+02:00", "2026-10-22T09:00:40+02:00")).toBe(1)
    expect(spanMinutes("2026-10-22T09:00:00+02:00", "2026-10-22T09:00:20+02:00")).toBe(0)
  })
})

describe("formatMinutes", () => {
  it.each([
    [0, "0 min"],
    [-30, "0 min"],
    [1, "1 min"],
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [480, "8 h"],
    [1440, "1 d"],
    [1500, "1 d 1 h"],
    [2940, "2 d 1 h"],
    [1441, "1 d 1 min"],
    [6 * 1440 + 30, "6 d 30 min"],
  ])("%i → %s", (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text)
  })

  it("drops minutes from spans of a week or more", () => {
    expect(formatMinutes(7 * 1440 + 30)).toBe("7 d")
    expect(formatMinutes(7 * 1440 + 90)).toBe("7 d 1 h")
  })
})

describe("formatHours", () => {
  it.each([
    [0, "0 h"],
    [-1, "0 h"],
    [30, "30 min"],
    [59, "59 min"],
    [60, "1 h"],
    [90, "1.5 h"],
    [100, "1.7 h"],
    [2400, "40 h"],
    [2670, "44.5 h"],
  ])("%i → %s", (minutes, text) => {
    expect(formatHours(minutes)).toBe(text)
  })
})

describe("date strings", () => {
  it("parses YYYY-MM-DD as local midnight", () => {
    const d = parseDateString("2026-10-25")
    expect(wall(d)).toBe("2026-10-25 00:00")
  })

  it("returns an invalid date for anything else", () => {
    for (const value of ["", "2026-1-5", "2026/10/25", "25-10-2026", "2026-10-25T00:00", " 2026-10-25", "tomorrow"]) {
      expect(Number.isNaN(parseDateString(value).getTime()), value).toBe(true)
    }
  })

  it("validates date strings", () => {
    expect(isDateString("2026-10-25")).toBe(true)
    expect(isDateString("2024-02-29")).toBe(true)
    expect(isDateString(null)).toBe(false)
    expect(isDateString(undefined)).toBe(false)
    expect(isDateString("")).toBe(false)
    expect(isDateString("2026-10-25T09:00")).toBe(false)
  })

  it("rejects impossible calendar dates (BUG-RES-1)", () => {
    // new Date() would roll 30 Feb over to 2 March.
    expect(isDateString("2026-02-30")).toBe(false)
    expect(isDateString("2026-13-01")).toBe(false)
    expect(isDateString("2026-00-10")).toBe(false)
    expect(isDateString("2026-04-31")).toBe(false)
    expect(isDateString("2025-02-29")).toBe(false)
    expect(isDateString("2026-12-31")).toBe(true)
  })

  it("formats a Date as YYYY-MM-DD", () => {
    expect(toDateString(new Date(2026, 9, 21, 23, 59))).toBe("2026-10-21")
    expect(toDateString(new Date(2027, 0, 1))).toBe("2027-01-01")
  })

  it("adds calendar days, across DST and year ends", () => {
    expect(addDaysTo("2026-10-24", 1)).toBe("2026-10-25")
    expect(addDaysTo("2026-10-25", 1)).toBe("2026-10-26")
    expect(addDaysTo("2026-03-29", 1)).toBe("2026-03-30")
    expect(addDaysTo("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDaysTo("2026-10-19", 7)).toBe("2026-10-26")
    expect(addDaysTo("2026-10-19", -7)).toBe("2026-10-12")
    expect(addDaysTo("2024-02-28", 1)).toBe("2024-02-29")
  })

  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19") // Monday
    expect(mondayOf("2026-10-21")).toBe("2026-10-19") // Wednesday
    expect(mondayOf("2026-10-24")).toBe("2026-10-19") // Saturday
    expect(mondayOf("2026-10-25")).toBe("2026-10-19") // Sunday (and the DST change)
    expect(mondayOf("2026-10-26")).toBe("2026-10-26")
    expect(mondayOf("2026-03-29")).toBe("2026-03-23") // Sunday, spring DST change
    expect(mondayOf("2027-01-03")).toBe("2026-12-28") // across the year end
  })
})

describe("wall dates", () => {
  it("keeps a timestamp's own wall time without a zone", () => {
    expect(wall(zonedWallDate("2026-10-29T10:00:00-04:00"))).toBe("2026-10-29 10:00")
    expect(wall(zonedWallDate("2026-10-25T02:30:00+01:00"))).toBe("2026-10-25 02:30")
  })

  it("converts to the wall time of a zone", () => {
    expect(wall(zonedWallDate("2026-10-29T15:00:00+01:00", "America/New_York"))).toBe("2026-10-29 10:00")
    expect(wall(zonedWallDate("2026-10-21T06:00:00Z", "Europe/Stockholm"))).toBe("2026-10-21 08:00")
    expect(wall(zonedWallDate("2026-10-21T02:00:00Z", "America/New_York"))).toBe("2026-10-20 22:00")
  })

  it("gives the current wall time in a zone", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-21T08:00:00+02:00"))
    expect(wall(nowWallDate("Europe/Stockholm"))).toBe("2026-10-21 08:00")
    expect(wall(nowWallDate("America/New_York"))).toBe("2026-10-21 02:00")
    expect(wall(nowWallDate("Asia/Tokyo"))).toBe("2026-10-21 15:00")
  })

  it("uses the browser's zone without a zone, like todayIn() (BUG-RES-2)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-21T08:00:00+02:00"))
    // Not the UTC wall time ("06:00") of toISOString().
    expect(wall(nowWallDate())).toBe("2026-10-21 08:00")
    expect(wall(nowWallDate(null))).toBe("2026-10-21 08:00")
  })
})

describe("recurringScheduleStatus", () => {
  const location = (time_zone: string) => ({ time_zone }) as Location
  const schedule = (start_date: string, end_date: string | null, time_zone: string | null = "Europe/Stockholm") =>
    ({
      id: "s",
      location: time_zone ? location(time_zone) : null,
      start_date,
      end_date,
      interval: 1,
    }) as unknown as RecurringSchedule

  it("is active from the start date through the end date (inclusive)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-21T08:00:00+02:00"))
    expect(recurringScheduleStatus(schedule("2026-09-21", null))).toBe("active")
    expect(recurringScheduleStatus(schedule("2026-10-21", null))).toBe("active")
    expect(recurringScheduleStatus(schedule("2026-10-01", "2026-10-21"))).toBe("active")
  })

  it("is upcoming before the start date and ended after the end date", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-21T08:00:00+02:00"))
    expect(recurringScheduleStatus(schedule("2026-10-22", null))).toBe("upcoming")
    expect(recurringScheduleStatus(schedule("2026-10-22", "2026-12-31"))).toBe("upcoming")
    expect(recurringScheduleStatus(schedule("2026-09-01", "2026-10-20"))).toBe("ended")
  })

  it("uses today in the location's zone", () => {
    vi.useFakeTimers()
    // 00:30 in Stockholm is still the previous evening in New York.
    vi.setSystemTime(new Date("2026-10-21T00:30:00+02:00"))
    expect(recurringScheduleStatus(schedule("2026-10-21", null, "Europe/Stockholm"))).toBe("active")
    expect(recurringScheduleStatus(schedule("2026-10-21", null, "America/New_York"))).toBe("upcoming")
    expect(recurringScheduleStatus(schedule("2026-09-01", "2026-10-20", "Europe/Stockholm"))).toBe("ended")
    expect(recurringScheduleStatus(schedule("2026-09-01", "2026-10-20", "America/New_York"))).toBe("active")
  })

  it("flips at midnight", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-21T23:59:59+02:00"))
    expect(recurringScheduleStatus(schedule("2026-10-22", null))).toBe("upcoming")
    vi.setSystemTime(new Date("2026-10-22T00:00:00+02:00"))
    expect(recurringScheduleStatus(schedule("2026-10-22", null))).toBe("active")
  })

  it("falls back to the browser's zone without a location", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-21T00:30:00+02:00"))
    expect(recurringScheduleStatus(schedule("2026-10-21", null, null))).toBe("active")
  })
})

describe("compareWeeklyBlocks", () => {
  const block = (weekday: RecurringScheduleBlock["weekday"], start_time: string, end_time: string) =>
    ({ id: `${weekday}-${start_time}-${end_time}`, weekday, start_time, end_time }) as RecurringScheduleBlock

  it("orders by weekday, then start, then end", () => {
    const blocks = [
      block("sunday", "09:00:00", "10:00:00"),
      block("monday", "13:00:00", "17:00:00"),
      block("wednesday", "09:00:00", "17:00:00"),
      block("monday", "09:00:00", "12:00:00"),
      block("monday", "09:00:00", "11:00:00"),
      block("saturday", "22:00:00", "24:00:00"),
    ]
    expect([...blocks].sort(compareWeeklyBlocks).map((b) => b.id)).toEqual([
      "monday-09:00:00-11:00:00",
      "monday-09:00:00-12:00:00",
      "monday-13:00:00-17:00:00",
      "wednesday-09:00:00-17:00:00",
      "saturday-22:00:00-24:00:00",
      "sunday-09:00:00-10:00:00",
    ])
  })

  it("treats identical blocks as equal", () => {
    expect(compareWeeklyBlocks(block("friday", "09:00:00", "17:00:00"), block("friday", "09:00:00", "17:00:00"))).toBe(0)
  })
})
