import { describe, expect, it } from "vitest"

import {
  canonicalWeek,
  dayStartMinutes,
  describeSpan,
  hourLabel,
  parseTime,
  sameDay,
  segmentsFor,
  wallMinutes,
  weekdaySpan,
  weeklySpans,
  type TimelineSpan,
} from "../week-timeline-model"

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s)
const span = (key: string, start: Date, end: Date): TimelineSpan => ({ key, start, end, tone: "available" })

describe("wall minutes", () => {
  it("counts wall-clock minutes, ignoring the browser's DST", () => {
    // In Stockholm, 01:00 → 03:00 on 25 Oct 2026 is three real hours, but two on the wall.
    expect(wallMinutes(at(2026, 10, 25, 3)) - wallMinutes(at(2026, 10, 25, 1))).toBe(120)
    // 01:00 → 04:00 on 29 Mar 2026 is two real hours, but three on the wall.
    expect(wallMinutes(at(2026, 3, 29, 4)) - wallMinutes(at(2026, 3, 29, 1))).toBe(180)
    expect(wallMinutes(at(2026, 10, 26)) - wallMinutes(at(2026, 10, 25))).toBe(1440)
  })

  it("includes seconds as fractions", () => {
    expect(wallMinutes(at(2026, 10, 21, 9, 0, 30)) - wallMinutes(at(2026, 10, 21, 9))).toBe(0.5)
  })

  it("finds the start of a day", () => {
    expect(dayStartMinutes(at(2026, 10, 21, 17, 45))).toBe(wallMinutes(at(2026, 10, 21)))
  })

  it("compares calendar days", () => {
    expect(sameDay(at(2026, 10, 21, 0), at(2026, 10, 21, 23, 59))).toBe(true)
    expect(sameDay(at(2026, 10, 21, 23, 59), at(2026, 10, 22, 0))).toBe(false)
    expect(sameDay(at(2025, 10, 21), at(2026, 10, 21))).toBe(false)
  })

  it("labels hours", () => {
    expect(hourLabel(0)).toBe("00:00")
    expect(hourLabel(9)).toBe("09:00")
    expect(hourLabel(24)).toBe("24:00")
  })
})

describe("describeSpan", () => {
  it("describes a span within one day", () => {
    expect(describeSpan(at(2026, 10, 19, 9), at(2026, 10, 19, 17))).toBe("Mon 09:00–17:00")
    expect(describeSpan(at(2026, 10, 19, 9), at(2026, 10, 19, 17), true)).toBe("Mon 19 Oct 09:00–17:00")
  })

  it("describes a span to midnight as 24:00", () => {
    expect(describeSpan(at(2026, 10, 23, 18), at(2026, 10, 24, 0))).toBe("Fri 18:00–24:00")
    expect(describeSpan(at(2026, 10, 23, 18), at(2026, 10, 24, 0), true)).toBe("Fri 23 Oct 18:00–24:00")
  })

  it("names both days for a span across midnight", () => {
    expect(describeSpan(at(2026, 10, 19, 22), at(2026, 10, 20, 2))).toBe("Mon 22:00 – Tue 02:00")
    expect(describeSpan(at(2026, 10, 19, 22), at(2026, 10, 20, 2), true)).toBe("Mon 19 Oct 22:00 – Tue 20 Oct 02:00")
  })
})

describe("segmentsFor", () => {
  const day = at(2026, 10, 21)

  it("positions a span as a percentage of the visible hours", () => {
    const [segment] = segmentsFor(day, [span("a", at(2026, 10, 21, 9), at(2026, 10, 21, 17))], [0, 24])
    expect(segment.left).toBeCloseTo(37.5)
    expect(segment.width).toBeCloseTo(33.333, 2)
    expect(segment.continuesBefore).toBe(false)
    expect(segment.continuesAfter).toBe(false)
  })

  it("respects a narrower hour range and clips to it", () => {
    const [segment] = segmentsFor(day, [span("a", at(2026, 10, 21, 7), at(2026, 10, 21, 17))], [8, 20])
    expect(segment.left).toBe(0)
    expect(segment.width).toBeCloseTo((9 / 12) * 100)
  })

  it("skips spans on other days or outside the visible hours", () => {
    expect(segmentsFor(day, [span("a", at(2026, 10, 22, 9), at(2026, 10, 22, 17))], [0, 24])).toEqual([])
    expect(segmentsFor(day, [span("a", at(2026, 10, 21, 6), at(2026, 10, 21, 8))], [8, 20])).toEqual([])
  })

  it("skips empty and backwards spans", () => {
    const nine = at(2026, 10, 21, 9)
    expect(segmentsFor(day, [span("a", nine, nine)], [0, 24])).toEqual([])
    expect(segmentsFor(day, [span("a", at(2026, 10, 21, 17), nine)], [0, 24])).toEqual([])
  })

  it("marks spans that continue from the previous or into the next day", () => {
    const overnight = span("night", at(2026, 10, 20, 22), at(2026, 10, 22, 2))
    const [segment] = segmentsFor(day, [overnight], [0, 24])
    expect(segment).toMatchObject({ left: 0, width: 100, continuesBefore: true, continuesAfter: true })
  })

  it("doesn't mark a span that ends exactly at midnight as continuing", () => {
    const [segment] = segmentsFor(day, [span("late", at(2026, 10, 21, 18), at(2026, 10, 22, 0))], [0, 24])
    expect(segment.continuesAfter).toBe(false)
    expect(segment.left + segment.width).toBeCloseTo(100)
  })

  it("lays out a DST day by wall time", () => {
    const dst = at(2026, 10, 25)
    const [segment] = segmentsFor(dst, [span("a", at(2026, 10, 25, 12), at(2026, 10, 25, 18))], [0, 24])
    expect(segment.left).toBeCloseTo(50)
    expect(segment.width).toBeCloseTo(25)
  })

  it("keeps every span on the day, in order", () => {
    const segments = segmentsFor(
      day,
      [span("a", at(2026, 10, 21, 9), at(2026, 10, 21, 12)), span("b", at(2026, 10, 21, 14), at(2026, 10, 21, 17))],
      [0, 24]
    )
    expect(segments.map((s) => s.span.key)).toEqual(["a", "b"])
  })
})

describe("weekly patterns", () => {
  it("uses Monday 1 to Sunday 7 January 2024 as the canonical week", () => {
    const week = canonicalWeek()
    expect(week).toHaveLength(7)
    expect(week[0].getDay()).toBe(1)
    expect(week[6].getDay()).toBe(0)
    expect(week.map((d) => d.getDate())).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(week.every((d) => d.getHours() === 0 && d.getMinutes() === 0)).toBe(true)
  })

  it("parses times", () => {
    expect(parseTime("09:00")).toEqual([9, 0, 0])
    expect(parseTime("9:05:30")).toEqual([9, 5, 30])
    expect(parseTime("24:00:00")).toEqual([24, 0, 0])
    expect(parseTime("nonsense")).toEqual([0, 0, 0])
  })

  it("places a weekday's times on the canonical week", () => {
    const { start, end } = weekdaySpan("wednesday", "09:00:00", "17:30:00")
    expect(start).toEqual(at(2024, 1, 3, 9))
    expect(end).toEqual(at(2024, 1, 3, 17, 30))
  })

  it("turns 24:00 into the next midnight", () => {
    const { end } = weekdaySpan("sunday", "22:00:00", "24:00:00")
    expect(end).toEqual(at(2024, 1, 8))
  })

  it("maps weekly blocks to spans", () => {
    const spans = weeklySpans(
      [
        { id: "1", weekday: "monday" as const, start_time: "09:00:00", end_time: "17:00:00" },
        { id: "2", weekday: "friday" as const, start_time: "10:00:00", end_time: "12:00:00" },
      ],
      (b) => (b.id === "1" ? { key: b.id, label: "Monday" } : { key: b.id, tone: "blocked" })
    )
    expect(spans).toEqual([
      { key: "1", tone: "available", label: "Monday", start: at(2024, 1, 1, 9), end: at(2024, 1, 1, 17) },
      { key: "2", tone: "blocked", label: undefined, start: at(2024, 1, 5, 10), end: at(2024, 1, 5, 12) },
    ])
  })

  it("lines weekly spans up with the canonical week's rows", () => {
    const week = canonicalWeek()
    const spans = weeklySpans([{ weekday: "tuesday" as const, start_time: "09:00:00", end_time: "17:00:00" }], () => ({
      key: "t",
    }))
    expect(week.map((d) => segmentsFor(d, spans, [0, 24]).length)).toEqual([0, 1, 0, 0, 0, 0, 0])
  })
})
