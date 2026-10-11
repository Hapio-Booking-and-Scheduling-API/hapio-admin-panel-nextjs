import { z } from "zod"

import { todayIn } from "@/lib/format/datetime"
import type { RecurringSchedule, RecurringScheduleInput } from "@/lib/hapio/types"

import { isDateString } from "./utils"

export const schema = z
  .object({
    location_id: z.string().min(1, "Required"),
    start_date: z.string().refine(isDateString, "Pick a date"),
    /** null = runs indefinitely */
    end_date: z
      .string()
      .nullable()
      .refine((v) => v === null || isDateString(v), "Pick a date"),
    interval: z
      .string()
      .refine((v) => /^\d+$/.test(v.trim()), "Enter a whole number")
      .refine((v) => !/^\d+$/.test(v.trim()) || Number(v) >= 1, "Must be at least 1"),
  })
  .refine((v) => v.end_date === null || !isDateString(v.start_date) || v.end_date >= v.start_date, {
    path: ["end_date"],
    message: "Can't be before the start date",
  })
export type Values = z.infer<typeof schema>
export const FIELDS = ["location_id", "start_date", "end_date", "interval"]
export const FIELD_MAP = { location: "location_id" }

export function toValues(schedule: RecurringSchedule | undefined, locationId: string | null | undefined, timeZone?: string): Values {
  if (schedule) {
    return {
      location_id: schedule.location?.id ?? "",
      start_date: schedule.start_date,
      end_date: schedule.end_date,
      interval: String(schedule.interval),
    }
  }
  return { location_id: locationId ?? "", start_date: todayIn(timeZone), end_date: null, interval: "1" }
}

export function toBody(values: Partial<Values>): Partial<RecurringScheduleInput> {
  const body: Partial<RecurringScheduleInput> = {}
  if (values.location_id !== undefined) body.location_id = values.location_id
  if (values.start_date !== undefined) body.start_date = values.start_date
  if (values.end_date !== undefined) body.end_date = values.end_date
  if (values.interval !== undefined) body.interval = Number(values.interval)
  return body
}
