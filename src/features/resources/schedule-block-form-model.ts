import { z } from "zod"

import { toHapioDateTime, toWallTime, wallAt } from "@/lib/format/datetime"
import type { ScheduleBlock } from "@/lib/hapio/types"

import { formatMinutes, spanMinutes } from "./utils"

export const schema = z
  .object({
    location_id: z.string().min(1, "Required"),
    starts_at: z.string().min(1, "Required"),
    ends_at: z.string().min(1, "Required"),
    is_available: z.boolean(),
  })
  .refine((v) => !v.starts_at || !v.ends_at || Date.parse(v.ends_at) > Date.parse(v.starts_at), {
    path: ["ends_at"],
    message: "Must be after the start",
  })
export type Values = z.infer<typeof schema>
export const FIELDS = ["location_id", "starts_at", "ends_at", "is_available"]
export const FIELD_MAP = { location: "location_id" }

export function toValues(block: ScheduleBlock | undefined, locationId: string | null | undefined, timeZone?: string): Values {
  if (block) {
    return {
      location_id: block.location?.id ?? "",
      starts_at: block.starts_at,
      ends_at: block.ends_at,
      is_available: block.is_available,
    }
  }
  return {
    location_id: locationId ?? "",
    starts_at: toHapioDateTime(wallAt(1, 9, timeZone), timeZone),
    ends_at: toHapioDateTime(wallAt(1, 17, timeZone), timeZone),
    is_available: true,
  }
}

/** "8 h" for a valid span, null while the end isn't after the start. */
export function durationLabel(startsAt: string, endsAt: string): string | null {
  return startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt) ? formatMinutes(spanMinutes(startsAt, endsAt)) : null
}

/** Re-expresses a timestamp so it keeps its wall-clock time in another zone (switching locations). */
export function keepWallTime(value: string, prevZone: string | undefined, nextZone: string | undefined): string {
  return toHapioDateTime(toWallTime(value, prevZone), nextZone)
}
