import { describe, expect, it } from "vitest"

import type { RecurringSchedule, RecurringScheduleBlock } from "@/lib/hapio/types"

import { DELETE_RESOURCE_WARNING, RESOURCE_TABS } from "../constants"
import { blockMinutes, blockTimes } from "../recurring-schedule-blocks-model"
import { dateRange } from "../recurring-schedules-model"
import { sameWallDay } from "../schedule-blocks-model"

const block = (weekday: RecurringScheduleBlock["weekday"], start_time: string, end_time: string) =>
  ({ id: "b", weekday, start_time, end_time }) as RecurringScheduleBlock

describe("recurring schedule blocks", () => {
  it("formats block times", () => {
    expect(blockTimes(block("monday", "09:00:00", "17:00:00"))).toBe("09:00–17:00")
    expect(blockTimes(block("friday", "22:00:00", "24:00:00"))).toBe("22:00–24:00")
    expect(blockTimes(block("friday", "09:00:30", "17:00:00"))).toBe("09:00:30–17:00")
  })

  it("measures block length, with 24:00 as the end of the day", () => {
    expect(blockMinutes(block("monday", "09:00:00", "17:00:00"))).toBe(480)
    expect(blockMinutes(block("sunday", "22:00:00", "24:00:00"))).toBe(120)
    expect(blockMinutes(block("tuesday", "00:00:00", "24:00:00"))).toBe(1440)
    expect(blockMinutes(block("tuesday", "17:00:00", "09:00:00"))).toBe(0)
  })

  it("adds up Mon–Fri 09–17 to 40 hours", () => {
    const week = (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((d) =>
      block(d, "09:00:00", "17:00:00")
    )
    expect(week.reduce((sum, b) => sum + blockMinutes(b), 0)).toBe(40 * 60)
  })
})

describe("recurring schedules", () => {
  const schedule = (start_date: string, end_date: string | null) =>
    ({ id: "s", start_date, end_date, interval: 1 }) as unknown as RecurringSchedule

  it("describes the date range", () => {
    expect(dateRange(schedule("2026-09-21", null))).toBe("21 Sep 2026 → Indefinitely")
    expect(dateRange(schedule("2026-11-01", "2026-11-30"))).toBe("1 Nov 2026 → 30 Nov 2026")
  })
})

describe("schedule blocks", () => {
  it("compares the local date parts of two timestamps", () => {
    expect(sameWallDay("2026-10-28T12:00:00+01:00", "2026-10-28T14:00:00+01:00")).toBe(true)
    expect(sameWallDay("2026-10-28T22:00:00+01:00", "2026-10-29T02:00:00+01:00")).toBe(false)
    // Same instant, but different local dates.
    expect(sameWallDay("2026-10-28T23:00:00-04:00", "2026-10-29T04:00:00+01:00")).toBe(false)
  })
})

describe("constants", () => {
  it("lists the detail tabs in order", () => {
    expect(RESOURCE_TABS).toEqual(["overview", "services", "blocks", "recurring", "availability", "json"])
  })

  it("warns what deleting a resource removes", () => {
    expect(DELETE_RESOURCE_WARNING).toMatch(/schedule blocks, recurring schedules/)
    expect(DELETE_RESOURCE_WARNING).toMatch(/bookings are kept but lose their resource/)
  })
})
