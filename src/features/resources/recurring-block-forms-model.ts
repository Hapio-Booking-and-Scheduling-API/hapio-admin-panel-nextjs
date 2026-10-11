import { z } from "zod"

import { isTimeString } from "@/lib/format/datetime"
import { describeError, isHapioError } from "@/lib/hapio/errors"
import { WEEKDAYS, type Weekday } from "@/lib/hapio/types"

const startTime = () => z.string().refine((v) => isTimeString(v), "Enter a time")
const endTime = () => z.string().refine((v) => isTimeString(v, true), "Enter a time")
const endAfterStart = {
  path: ["end_time"],
  message: "Must be after the start time",
}
export const isOrdered = (v: { start_time: string; end_time: string }) =>
  !isTimeString(v.start_time) || !isTimeString(v.end_time, true) || v.end_time > v.start_time

export const OVERLAP_HINT = "Blocks in the same recurring schedule can't overlap."

// ---------------------------------------------------------------------------
// Single block

export const blockSchema = z
  .object({ weekday: z.enum(WEEKDAYS), start_time: startTime(), end_time: endTime() })
  .refine(isOrdered, endAfterStart)
export type BlockValues = z.infer<typeof blockSchema>
export const BLOCK_FIELDS = ["weekday", "start_time", "end_time"]

// ---------------------------------------------------------------------------
// Same hours on several weekdays

export const hoursSchema = z
  .object({
    weekdays: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day"),
    start_time: startTime(),
    end_time: endTime(),
  })
  .refine(isOrdered, endAfterStart)
export type HoursValues = z.infer<typeof hoursSchema>

export const PRESETS: Array<{ label: string; days: Weekday[] }> = [
  { label: "Mon–Fri", days: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
  { label: "Weekend", days: ["saturday", "sunday"] },
  { label: "Every day", days: [...WEEKDAYS] },
]

export class BulkCreateError extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join("\n"))
  }
}

export function failureMessage(error: unknown): string {
  if (isHapioError(error) && error.errors && Object.keys(error.errors).length) {
    return Object.values(error.errors).flat().join(" ")
  }
  return describeError(error)
}

/** Success toast after adding weekday hours: "Added 2 of 7 blocks", "Block added", "Added 5 blocks". */
export function bulkResultMessage({ created, failed }: { created: number; failed: unknown[] }): string {
  return failed.length
    ? `Added ${created} of ${created + failed.length} blocks`
    : created === 1
      ? "Block added"
      : `Added ${created} blocks`
}
