import { formatDate } from "@/lib/format/datetime"
import type { RecurringSchedule } from "@/lib/hapio/types"

/** "21 Sep 2026 → Indefinitely", "1 Nov 2026 → 30 Nov 2026". */
export function dateRange(schedule: RecurringSchedule) {
  return `${formatDate(schedule.start_date)} → ${schedule.end_date ? formatDate(schedule.end_date) : "Indefinitely"}`
}
