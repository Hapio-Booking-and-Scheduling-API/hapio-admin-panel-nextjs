import { wallMinutes, weekdaySpan } from "@/components/entity/week-timeline-model"
import { shortTime } from "@/lib/format/datetime"
import type { RecurringScheduleBlock } from "@/lib/hapio/types"

/** "09:00–17:00", "22:00–24:00". */
export function blockTimes(block: RecurringScheduleBlock) {
  return `${shortTime(block.start_time)}–${shortTime(block.end_time)}`
}

/** Length of a weekly block in minutes (24:00:00 counts as the end of the day). */
export function blockMinutes(block: RecurringScheduleBlock) {
  const { start, end } = weekdaySpan(block.weekday, block.start_time, block.end_time)
  return Math.max(0, wallMinutes(end) - wallMinutes(start))
}
