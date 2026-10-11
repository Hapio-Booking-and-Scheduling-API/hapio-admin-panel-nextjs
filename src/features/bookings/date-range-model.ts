import { TZDate } from "@date-fns/tz"
import { addMonths, format, startOfMonth } from "date-fns"

import { dayRange, formatDateTime } from "@/lib/format/datetime"

import { instant } from "./utils"

export interface DateRange {
  from: string | null
  to: string | null
}

export function monthRange(timeZone: string): { from: string; to: string } {
  const start = startOfMonth(new TZDate(Date.now(), timeZone))
  return {
    from: format(start, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    to: format(addMonths(start, 1), "yyyy-MM-dd'T'HH:mm:ssxxx"),
  }
}

export const PRESETS: Array<{ key: string; label: string; range: (tz: string) => { from: string; to: string } }> = [
  { key: "today", label: "Today", range: (tz) => dayRange(0, 1, tz) },
  { key: "next7", label: "Next 7 days", range: (tz) => dayRange(0, 7, tz) },
  { key: "month", label: "This month", range: monthRange },
  { key: "past7", label: "Past 7 days", range: (tz) => dayRange(-6, 7, tz) },
]

export function shortStamp(iso: string, timeZone: string) {
  const time = formatDateTime(iso, { timeZone, pattern: "HH:mm" })
  return formatDateTime(iso, { timeZone, pattern: time === "00:00" ? "d MMM yyyy" : "d MMM yyyy, HH:mm" })
}

export function rangeLabel({ from, to }: DateRange, timeZone: string): string {
  if (!from && !to) return "Any date"
  const preset = PRESETS.find((p) => {
    const r = p.range(timeZone)
    return instant(r.from) === instant(from) && instant(r.to) === instant(to)
  })
  if (preset) return preset.label
  if (from && to) return `${shortStamp(from, timeZone)} – ${shortStamp(to, timeZone)}`
  if (from) return `From ${shortStamp(from, timeZone)}`
  return `Until ${shortStamp(to!, timeZone)}`
}
