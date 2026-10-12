// Pure helpers for the bookable slots explorer: date presets, lengths, end
// options for flexible/day slots and links to the new-booking form.

import { TZDate } from "@date-fns/tz"
import { addDays, format, parseISO } from "date-fns"

import { toHapioTimestamp, todayIn } from "@/lib/format/datetime"
import { durationToMinutes, formatDuration, humanizeDuration } from "@/lib/format/duration"
import type { AnyBookableSlot, BookableSlotFlexible, Service } from "@/lib/hapio/types"

export const PRESETS = { today: { label: "Today", days: 1 }, "7d": { label: "Next 7 days", days: 7 }, "30d": { label: "Next 30 days", days: 30 } }
export type Preset = keyof typeof PRESETS

/** Max end options offered per slot. */
export const MAX_END_OPTIONS = 120

export const addDaysTo = (date: string, days: number) => format(addDays(parseISO(date), days), "yyyy-MM-dd")

export function presetRange(preset: Preset, timeZone: string) {
  const from = todayIn(timeZone)
  return { from, to: addDaysTo(from, PRESETS[preset].days - 1) }
}

/** Hapio timestamp of an instant, in the location's zone. */
export const toZoned = (time: number, timeZone: string) => toHapioTimestamp(time, timeZone)

export function lengthLabel(ms: number) {
  const minutes = Math.round(ms / 60_000)
  return humanizeDuration(formatDuration({ hours: Math.floor(minutes / 60), minutes: minutes % 60 }))
}

export function defaultLength(service: Service): string | null {
  if (service.type === "flexible") return service.default_duration
  if (service.type === "day") return service.default_days ? `P${service.default_days}D` : null
  return null
}

export function fallbackLength(service: Service): string {
  if (service.type === "flexible") return service.default_duration ?? service.min_duration
  if (service.type === "day") return `P${service.default_days ?? service.min_days}D`
  return "PT1H"
}

export const hasEndRange = (slot: AnyBookableSlot): slot is BookableSlotFlexible => "min_ends_at" in slot

/** Valid ends for a flexible/day slot: from the minimum end to the maximum, by step or by day. */
export function endOptions(slot: BookableSlotFlexible, service: Service, timeZone: string): string[] {
  const min = new Date(slot.min_ends_at).getTime()
  const max = new Date(slot.ends_at).getTime()
  const out = [slot.min_ends_at]
  if (service.type === "day") {
    // Whole days in the location's wall time, so DST changes keep the end time.
    let next = addDays(new TZDate(min, timeZone), 1)
    while (next.getTime() <= max && out.length < MAX_END_OPTIONS) {
      out.push(toZoned(next.getTime(), timeZone))
      next = addDays(next, 1)
    }
    return out
  }
  const stepMinutes = service.type === "flexible" ? durationToMinutes(service.duration_step) : null
  if (!stepMinutes || stepMinutes <= 0) return max > min ? [...out, slot.ends_at] : out
  const step = stepMinutes * 60_000
  for (let t = min + step; t <= max && out.length < MAX_END_OPTIONS; t += step) out.push(toZoned(t, timeZone))
  return out
}

export function bookingHref(input: {
  serviceId: string
  locationId: string
  resourceId: string | null
  startsAt: string
  endsAt: string
}) {
  let href = `/bookings/new?service=${input.serviceId}&location=${input.locationId}`
  if (input.resourceId) href += `&resource=${input.resourceId}`
  return `${href}&starts_at=${encodeURIComponent(input.startsAt)}&ends_at=${encodeURIComponent(input.endsAt)}`
}
