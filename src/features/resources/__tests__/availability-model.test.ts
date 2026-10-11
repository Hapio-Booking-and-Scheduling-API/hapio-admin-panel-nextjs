import { describe, expect, it } from "vitest"

import { wallMinutes } from "@/components/entity/week-timeline-model"

import { chipTimes, dayIndexOf, toDaySpans, weekDays, weekLabel, weekRange } from "../availability-model"

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
const wall = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`

describe("chipTimes", () => {
  it("shows a same-day span as start–end", () => {
    expect(chipTimes(at(2026, 10, 19, 9), at(2026, 10, 19, 17))).toBe("09:00–17:00")
    expect(chipTimes(at(2026, 10, 28, 14), at(2026, 10, 28, 17, 30))).toBe("14:00–17:30")
  })

  it("shows a span to midnight as 24:00", () => {
    expect(chipTimes(at(2026, 10, 19, 22), at(2026, 10, 20, 0))).toBe("22:00–24:00")
    expect(chipTimes(at(2026, 10, 19, 0), at(2026, 10, 20, 0))).toBe("00:00–24:00")
  })

  it("names the end day when a span runs past midnight", () => {
    expect(chipTimes(at(2026, 10, 19, 22), at(2026, 10, 20, 2))).toBe("22:00–Tue 02:00")
    expect(chipTimes(at(2026, 10, 23, 9), at(2026, 10, 26, 17))).toBe("09:00–Mon 17:00")
  })

  it("uses wall time, so the night the clocks go back is still a 24:00 day", () => {
    expect(chipTimes(at(2026, 10, 25, 0), at(2026, 10, 26, 0))).toBe("00:00–24:00")
  })
})

describe("toDaySpans", () => {
  it("converts spans to wall time in the location's zone", () => {
    const [span] = toDaySpans(
      [{ starts_at: "2026-10-28T15:00:00+01:00", ends_at: "2026-10-28T22:00:00+01:00" }],
      "open",
      "America/New_York"
    )
    expect(span.key).toBe("open-0-2026-10-28T15:00:00+01:00")
    expect(wall(span.start)).toBe("2026-10-28 10:00")
    expect(wall(span.end)).toBe("2026-10-28 17:00")
    expect(span.minutes).toBe(420)
  })

  it("keeps the timestamp's own wall time without a zone", () => {
    const [span] = toDaySpans([{ starts_at: "2026-10-28T09:00:00-04:00", ends_at: "2026-10-28T12:00:00-04:00" }], "b", undefined)
    expect(wall(span.start)).toBe("2026-10-28 09:00")
  })

  it("measures real minutes across a DST change", () => {
    const [span] = toDaySpans(
      [{ starts_at: "2026-11-01T00:00:00-04:00", ends_at: "2026-11-02T00:00:00-05:00" }],
      "open",
      "America/New_York"
    )
    expect(span.minutes).toBe(25 * 60)
    expect(wallMinutes(span.end) - wallMinutes(span.start)).toBe(24 * 60)
  })

  it("handles a missing list and keeps keys unique per index", () => {
    expect(toDaySpans(undefined, "open", "Europe/Stockholm")).toEqual([])
    const spans = toDaySpans(
      [
        { starts_at: "2026-10-19T09:00:00+02:00", ends_at: "2026-10-19T12:00:00+02:00" },
        { starts_at: "2026-10-19T09:00:00+02:00", ends_at: "2026-10-19T12:00:00+02:00" },
      ],
      "booked",
      "Europe/Stockholm"
    )
    expect(new Set(spans.map((s) => s.key)).size).toBe(2)
  })
})

describe("weeks", () => {
  it("lists the seven days from Monday", () => {
    const days = weekDays("2026-10-19")
    expect(days).toHaveLength(7)
    expect(days.map((d) => wall(d))).toEqual([
      "2026-10-19 00:00",
      "2026-10-20 00:00",
      "2026-10-21 00:00",
      "2026-10-22 00:00",
      "2026-10-23 00:00",
      "2026-10-24 00:00",
      "2026-10-25 00:00",
    ])
  })

  it("builds the week's range in the location's zone, across DST", () => {
    expect(weekRange("2026-10-19", "Europe/Stockholm")).toEqual({
      from: "2026-10-19T00:00:00+02:00",
      to: "2026-10-26T00:00:00+01:00",
    })
    expect(weekRange("2026-10-26", "America/New_York")).toEqual({
      from: "2026-10-26T00:00:00-04:00",
      to: "2026-11-02T00:00:00-05:00",
    })
  })

  it("labels the week", () => {
    expect(weekLabel(weekDays("2026-10-19"))).toBe("19 Oct – 25 Oct 2026")
    expect(weekLabel(weekDays("2026-12-28"))).toBe("28 Dec – 3 Jan 2027")
  })

  it("buckets spans by the day they start on", () => {
    const weekStart = wallMinutes(at(2026, 10, 19))
    expect(dayIndexOf({ start: at(2026, 10, 19, 0) }, weekStart)).toBe(0)
    expect(dayIndexOf({ start: at(2026, 10, 21, 9) }, weekStart)).toBe(2)
    expect(dayIndexOf({ start: at(2026, 10, 25, 23, 59) }, weekStart)).toBe(6)
  })

  it("clamps spans that start outside the week", () => {
    const weekStart = wallMinutes(at(2026, 10, 19))
    expect(dayIndexOf({ start: at(2026, 10, 18, 22) }, weekStart)).toBe(0)
    expect(dayIndexOf({ start: at(2026, 10, 27, 9) }, weekStart)).toBe(6)
  })
})
