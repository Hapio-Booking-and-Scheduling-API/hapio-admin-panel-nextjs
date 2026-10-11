// Form model for the service create/edit dialog: schema, conversions between a
// service and form values, and request bodies. Pure, so it can be unit-tested.

import { z } from "zod"

import { isTimeString } from "@/lib/format/datetime"
import { durationToMinutes, isValidDuration, isZeroDuration } from "@/lib/format/duration"
import { metadataToText } from "@/lib/format/json"
import { durationValue, metadataText, nullableDurationValue, priceText, textToMetadata, textToPrice } from "@/lib/forms"
import {
  SERVICE_TYPES,
  WEEKDAYS,
  type DayTime,
  type Service,
  type ServiceDay,
  type ServiceFixed,
  type ServiceFlexible,
  type ServiceType,
  type Weekday,
} from "@/lib/hapio/types"

import { isPerWeekday } from "./utils"

export const DAY_MODES = ["same", "weekday"] as const
export type DayMode = (typeof DAY_MODES)[number]

const weekdayTimes = () => z.record(z.enum(WEEKDAYS), z.string())

// Every type's fields live in one flat form so switching type keeps what was
// typed. Type-specific fields are validated only for the selected type.
export const baseSchema = z.object({
  name: z.string().trim().min(1, "Required").max(100, "At most 100 characters"),
  type: z.enum(SERVICE_TYPES),
  // fixed
  duration: z.string(),
  // fixed & flexible
  bookable_interval: z.string().nullable(),
  // flexible
  min_duration: z.string(),
  max_duration: z.string().nullable(),
  default_duration: z.string().nullable(),
  duration_step: z.string(),
  // day
  day_times_mode: z.enum(DAY_MODES),
  start_time: z.string(),
  end_time: z.string(),
  start_times: weekdayTimes(),
  end_times: weekdayTimes(),
  min_days: z.string(),
  max_days: z.string(),
  default_days: z.string(),
  // common
  price: priceText(),
  buffer_time_before: durationValue(),
  buffer_time_after: durationValue(),
  booking_window_start: durationValue(),
  booking_window_end: nullableDurationValue({ allowZero: false }),
  cancelation_threshold: durationValue(),
  enabled: z.boolean(),
  metadata: metadataText(),
  protected_metadata: metadataText(),
})
export type Values = z.infer<typeof baseSchema>
export const FIELDS = Object.keys(baseSchema.shape)

export const TYPE_FIELDS: Record<ServiceType, ReadonlyArray<keyof Values>> = {
  fixed: ["duration", "bookable_interval"],
  flexible: ["min_duration", "max_duration", "default_duration", "duration_step", "bookable_interval"],
  day: ["day_times_mode", "start_time", "end_time", "start_times", "end_times", "min_days", "max_days", "default_days"],
}

export function durationIssue(value: string | null, nullable = false): string | null {
  if (value === null) return nullable ? null : "Required"
  if (!value) return "Required"
  if (!isValidDuration(value)) return "Not a valid ISO 8601 duration (e.g. PT1H30M)"
  if (isZeroDuration(value)) return "Must be longer than zero"
  return null
}

/** "" → null; whole numbers ≥ 1 → number; anything else → NaN. */
export function parseDays(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return /^\d+$/.test(trimmed) && Number(trimmed) >= 1 ? Number(trimmed) : Number.NaN
}

export const schema = baseSchema.superRefine((v, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: path.split("."), message })
  const checkDuration = (key: keyof Values, value: string | null, nullable = false) => {
    const message = durationIssue(value, nullable)
    if (message) issue(key, message)
    return !message
  }

  if (v.type === "fixed") {
    checkDuration("duration", v.duration)
    checkDuration("bookable_interval", v.bookable_interval, true)
  }

  if (v.type === "flexible") {
    const minOk = checkDuration("min_duration", v.min_duration)
    const maxOk = checkDuration("max_duration", v.max_duration, true)
    const defaultOk = checkDuration("default_duration", v.default_duration, true)
    checkDuration("duration_step", v.duration_step)
    checkDuration("bookable_interval", v.bookable_interval, true)
    const min = durationToMinutes(v.min_duration) ?? 0
    const max = v.max_duration === null ? Infinity : durationToMinutes(v.max_duration) ?? Infinity
    if (minOk && maxOk && max < min) issue("max_duration", "Must be at least the minimum length")
    if (minOk && maxOk && defaultOk && v.default_duration !== null) {
      const def = durationToMinutes(v.default_duration) ?? 0
      if (def < min || def > max) issue("default_duration", "Must be between the minimum and maximum length")
    }
  }

  if (v.type === "day") {
    // Bookings can end at the end of the day (24:00:00), but not start then.
    const checkTime = (path: string, value: string, endOfDay = false) => {
      if (!isTimeString(value, endOfDay)) issue(path, value ? "Not a valid time" : "Required")
    }
    if (v.day_times_mode === "same") {
      checkTime("start_time", v.start_time)
      checkTime("end_time", v.end_time, true)
    } else {
      for (const day of WEEKDAYS) {
        checkTime(`start_times.${day}`, v.start_times[day])
        checkTime(`end_times.${day}`, v.end_times[day], true)
      }
    }
    const min = parseDays(v.min_days)
    const max = parseDays(v.max_days)
    const def = parseDays(v.default_days)
    if (min === null || Number.isNaN(min)) issue("min_days", min === null ? "Required" : "Enter a whole number of at least 1")
    if (Number.isNaN(max)) issue("max_days", "Enter a whole number of at least 1, or leave empty")
    if (Number.isNaN(def)) issue("default_days", "Enter a whole number of at least 1, or leave empty")
    const minN = min !== null && !Number.isNaN(min) ? min : null
    if (minN !== null && max !== null && !Number.isNaN(max) && max < minN) {
      issue("max_days", "Must be at least the minimum days")
    }
    if (minN !== null && def !== null && !Number.isNaN(def)) {
      const maxN = max !== null && !Number.isNaN(max) ? max : Infinity
      if (def < minN || def > maxN) issue("default_days", "Must be between the minimum and maximum days")
    }
  }
})

export const DEFAULT_START = "09:00:00"
export const DEFAULT_END = "17:00:00"

export function weekdayRecord(value: DayTime | undefined, fallback: string): Record<Weekday, string> {
  return Object.fromEntries(
    WEEKDAYS.map((day) => [day, isPerWeekday(value) ? value[day] ?? fallback : value || fallback])
  ) as Record<Weekday, string>
}

/** Every type's fields, all optional, for reading a service of any type. */
type AnyServiceFields = Partial<
  Omit<ServiceFixed, "type"> & Omit<ServiceFlexible, "type"> & Omit<ServiceDay, "type">
> & { type?: ServiceType }

export function toValues(service?: Service): Values {
  // Fields that don't apply to the service's type are absent; fall back to defaults.
  const s = service as AnyServiceFields | undefined
  const start = s?.start_time
  const end = s?.end_time
  const perWeekday = isPerWeekday(start) || isPerWeekday(end)
  return {
    name: s?.name ?? "",
    type: s?.type ?? "fixed",
    duration: s?.duration ?? "PT1H",
    bookable_interval: s?.bookable_interval ?? null,
    min_duration: s?.min_duration ?? "PT30M",
    max_duration: s?.type === "flexible" ? s.max_duration ?? null : "PT4H",
    default_duration: s?.default_duration ?? null,
    duration_step: s?.duration_step ?? "PT30M",
    day_times_mode: perWeekday ? "weekday" : "same",
    start_time: isPerWeekday(start) ? start.monday : start ?? DEFAULT_START,
    end_time: isPerWeekday(end) ? end.monday : end ?? DEFAULT_END,
    start_times: weekdayRecord(start, DEFAULT_START),
    end_times: weekdayRecord(end, DEFAULT_END),
    min_days: String(s?.min_days ?? 1),
    max_days: s?.max_days ? String(s.max_days) : "",
    default_days: s?.default_days ? String(s.default_days) : "",
    price: s?.price ?? "",
    buffer_time_before: s?.buffer_time_before ?? "PT0S",
    buffer_time_after: s?.buffer_time_after ?? "PT0S",
    booking_window_start: s?.booking_window_start ?? "PT0S",
    booking_window_end: s?.booking_window_end ?? null,
    cancelation_threshold: s?.cancelation_threshold ?? "PT0S",
    enabled: s?.enabled ?? true,
    metadata: metadataToText(s?.metadata),
    protected_metadata: metadataToText(s?.protected_metadata),
  }
}

const COMMON_DIRECT = [
  "name",
  "buffer_time_before",
  "buffer_time_after",
  "booking_window_start",
  "booking_window_end",
  "cancelation_threshold",
  "enabled",
] as const

/** Builds a request body from the fields `include` accepts, for the selected type only. */
export function toBody(values: Values, include: (key: keyof Values) => boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const key of COMMON_DIRECT) if (include(key)) body[key] = values[key]
  if (include("price")) body.price = textToPrice(values.price)
  if (include("metadata")) body.metadata = textToMetadata(values.metadata)
  if (include("protected_metadata")) body.protected_metadata = textToMetadata(values.protected_metadata)

  switch (values.type) {
    case "fixed":
      if (include("duration")) body.duration = values.duration
      if (include("bookable_interval")) body.bookable_interval = values.bookable_interval
      break
    case "flexible":
      for (const key of TYPE_FIELDS.flexible) if (include(key)) body[key] = values[key]
      break
    case "day": {
      const perWeekday = values.day_times_mode === "weekday"
      const ordered = (times: Record<Weekday, string>) =>
        Object.fromEntries(WEEKDAYS.map((day) => [day, times[day]]))
      const modeChanged = include("day_times_mode")
      if (modeChanged || include(perWeekday ? "start_times" : "start_time")) {
        body.start_time = perWeekday ? ordered(values.start_times) : values.start_time
      }
      if (modeChanged || include(perWeekday ? "end_times" : "end_time")) {
        body.end_time = perWeekday ? ordered(values.end_times) : values.end_time
      }
      if (include("min_days")) body.min_days = parseDays(values.min_days)
      if (include("max_days")) body.max_days = parseDays(values.max_days)
      if (include("default_days")) body.default_days = parseDays(values.default_days)
      break
    }
  }
  return body
}

/** PATCH body for an edit: dirty fields only, plus every field of the new type when the type changes. */
export function patchBody(values: Values, service: Service, dirty: ReadonlySet<string>): Record<string, unknown> {
  const typeChanged = values.type !== service.type
  // Changing the type requires the new type's fields, so send them all.
  const body = toBody(
    values,
    (key) => dirty.has(key) || (typeChanged && TYPE_FIELDS[values.type].includes(key))
  )
  if (typeChanged) body.type = values.type
  return body
}

/** POST body for a new service: every field of the selected type. */
export function createBody(values: Values): Record<string, unknown> {
  const body: Record<string, unknown> = { type: values.type, ...toBody(values, () => true) }
  // Only send protected metadata when given: setting it needs an extra token ability.
  if (!values.protected_metadata.trim()) delete body.protected_metadata
  return body
}

/** API error keys like `start_time.monday` → form field names. */
export function errorFieldMap(mode: DayMode): Record<string, string> {
  const map: Record<string, string> = {}
  if (mode === "weekday") {
    map.start_time = "start_times"
    map.end_time = "end_times"
  }
  for (const day of WEEKDAYS) {
    map[`start_time.${day}`] = mode === "weekday" ? `start_times.${day}` : "start_time"
    map[`end_time.${day}`] = mode === "weekday" ? `end_times.${day}` : "end_time"
  }
  return map
}
