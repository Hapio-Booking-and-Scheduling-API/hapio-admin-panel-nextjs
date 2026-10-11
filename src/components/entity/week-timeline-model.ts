import { format } from "date-fns"
import type { ReactNode } from "react"

import { WEEKDAYS, type Weekday } from "@/lib/hapio/types"

// Pure layout helpers for WeekTimeline. Spans are positioned by their wall-clock
// fields (convert Hapio timestamps with `wallDate`), so the view shows the
// location's local time regardless of the browser's zone.

export type TimelineTone = "available" | "blocked" | "booked" | "muted"

export interface TimelineSpan {
  key: string
  /** Wall-clock start: a Date whose local fields are the location's local time. */
  start: Date
  /** Wall-clock end (exclusive). */
  end: Date
  tone: TimelineTone
  /** Tooltip text; defaults to the span's times. */
  label?: ReactNode
}

/** Minutes since the epoch of a wall-clock Date's local fields (unaffected by the browser's DST). */
export function wallMinutes(date: Date): number {
  return (
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    ) / 60_000
  )
}

export function dayStartMinutes(day: Date): number {
  return Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 60_000
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`
}

/** "Mon 09:00–17:00", "Mon 22:00 – Tue 02:00", "Fri 18:00–24:00". */
export function describeSpan(start: Date, end: Date, withDate = false): string {
  const day = withDate ? "EEE d MMM" : "EEE"
  const startDay = dayStartMinutes(start)
  const endMinutes = wallMinutes(end)
  if (sameDay(start, end)) return `${format(start, `${day} HH:mm`)}–${format(end, "HH:mm")}`
  if (endMinutes === startDay + 1440) return `${format(start, `${day} HH:mm`)}–24:00`
  return `${format(start, `${day} HH:mm`)} – ${format(end, `${day} HH:mm`)}`
}

export interface Segment {
  span: TimelineSpan
  left: number
  width: number
  continuesBefore: boolean
  continuesAfter: boolean
}

export function segmentsFor(day: Date, spans: TimelineSpan[], [h0, h1]: [number, number]): Segment[] {
  const dayStart = dayStartMinutes(day)
  const viewStart = dayStart + h0 * 60
  const viewEnd = dayStart + h1 * 60
  const total = viewEnd - viewStart
  const out: Segment[] = []
  for (const span of spans) {
    const s = wallMinutes(span.start)
    const e = wallMinutes(span.end)
    if (!(e > s)) continue
    const a = Math.max(s, viewStart)
    const b = Math.min(e, viewEnd)
    if (b <= a) continue
    out.push({
      span,
      left: ((a - viewStart) / total) * 100,
      width: ((b - a) / total) * 100,
      continuesBefore: s < dayStart,
      continuesAfter: e > dayStart + 1440,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Weekly patterns (weekday + times, no dates) on a fixed Monday–Sunday week.

/** Monday 1 January 2024 to Sunday 7 January 2024, as wall-clock midnights. */
export function canonicalWeek(): Date[] {
  return WEEKDAYS.map((_, i) => new Date(2024, 0, 1 + i))
}

export function parseTime(value: string): [number, number, number] {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) return [0, 0, 0]
  return [+m[1], +m[2], +(m[3] ?? 0)]
}

/** A weekday with `hh:mm:ss` times (end may be `24:00:00`) → wall-clock Dates on the canonical week. */
export function weekdaySpan(weekday: Weekday, startTime: string, endTime: string): { start: Date; end: Date } {
  const offset = WEEKDAYS.indexOf(weekday)
  const [sh, sm, ss] = parseTime(startTime)
  const [eh, em, es] = parseTime(endTime)
  return {
    start: new Date(2024, 0, 1 + offset, sh, sm, ss),
    end: new Date(2024, 0, 1 + offset, eh, em, es),
  }
}

/** Maps weekly blocks (e.g. recurring schedule blocks) to spans on the canonical week. */
export function weeklySpans<T extends { weekday: Weekday; start_time: string; end_time: string }>(
  items: T[],
  toSpan: (item: T) => { key: string; tone?: TimelineTone; label?: ReactNode }
): TimelineSpan[] {
  return items.map((item) => {
    const { key, tone = "available", label } = toSpan(item)
    return { key, tone, label, ...weekdaySpan(item.weekday, item.start_time, item.end_time) }
  })
}
