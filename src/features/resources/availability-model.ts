import { format } from "date-fns"

import { wallMinutes } from "@/components/entity/week-timeline-model"
import { toHapioDateTime } from "@/lib/format/datetime"
import type { TimeSpan } from "@/lib/hapio/types"

import { addDaysTo, parseDateString, spanMinutes, zonedWallDate } from "./utils"

export interface DaySpan {
  key: string
  start: Date
  end: Date
  minutes: number
}

/** "09:00–17:00", "22:00–24:00", "22:00–Tue 02:00". */
export function chipTimes(start: Date, end: Date) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const minutesFromStartDay = wallMinutes(end) - wallMinutes(startDay)
  if (minutesFromStartDay <= 1440) {
    return `${format(start, "HH:mm")}–${minutesFromStartDay === 1440 ? "24:00" : format(end, "HH:mm")}`
  }
  return `${format(start, "HH:mm")}–${format(end, "EEE HH:mm")}`
}

/** API spans → wall-clock spans in the location's zone. */
export function toDaySpans(spans: TimeSpan[] | undefined, prefix: string, timeZone: string | undefined): DaySpan[] {
  return (spans ?? []).map((s, i) => ({
    key: `${prefix}-${i}-${s.starts_at}`,
    start: zonedWallDate(s.starts_at, timeZone),
    end: zonedWallDate(s.ends_at, timeZone),
    minutes: spanMinutes(s.starts_at, s.ends_at),
  }))
}

/** The seven wall-clock midnights of the week starting on `monday` (`YYYY-MM-DD`). */
export function weekDays(monday: string): Date[] {
  return Array.from({ length: 7 }, (_, i) => parseDateString(addDaysTo(monday, i)))
}

/** The week as a Hapio from/to range in the location's zone. */
export function weekRange(monday: string, timeZone: string | undefined): { from: string; to: string } {
  return {
    from: toHapioDateTime(`${monday}T00:00`, timeZone),
    to: toHapioDateTime(`${addDaysTo(monday, 7)}T00:00`, timeZone),
  }
}

/** "19 Oct – 25 Oct 2026". */
export function weekLabel(days: Date[]): string {
  return `${format(days[0], "d MMM")} – ${format(days[6], "d MMM yyyy")}`
}

/** Which day of the week (0–6) a span starts on; spans outside the week clamp to its ends. */
export function dayIndexOf(span: Pick<DaySpan, "start">, weekStart: number): number {
  return Math.min(6, Math.max(0, Math.floor((wallMinutes(span.start) - weekStart) / 1440)))
}
