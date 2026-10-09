import { addDays, format, isValid, startOfWeek } from "date-fns"

import { todayIn, toWallTime, wallDate } from "@/lib/format/datetime"
import { WEEKDAYS, type RecurringSchedule, type RecurringScheduleBlock, type ServiceType } from "@/lib/hapio/types"

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  fixed: "Fixed",
  flexible: "Flexible",
  day: "Day",
}

export function formatMaxSimultaneous(value: number | null): string {
  return value === null ? "Unlimited" : String(value)
}

export function intervalLabel(interval: number): string {
  return interval === 1 ? "Every week" : `Every ${interval} weeks`
}

/** Length of a span between two timestamps, in minutes (absolute time, so DST-safe). */
export function spanMinutes(startsAt: string, endsAt: string): number {
  const ms = Date.parse(endsAt) - Date.parse(startsAt)
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : 0
}

/** 90 → "1 h 30 min", 2940 → "2 d 1 h". */
export function formatMinutes(total: number): string {
  if (total <= 0) return "0 min"
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = Math.round(total % 60)
  const parts: string[] = []
  if (days) parts.push(`${days} d`)
  if (hours) parts.push(`${hours} h`)
  if (minutes && days < 7) parts.push(`${minutes} min`)
  return parts.join(" ") || "0 min"
}

/** 90 → "1.5 h", 2670 → "44.5 h": compact totals for summaries. */
export function formatHours(total: number): string {
  if (total <= 0) return "0 h"
  if (total < 60) return `${Math.round(total)} min`
  const hours = Math.round((total / 60) * 10) / 10
  return `${hours} h`
}

/** `YYYY-MM-DD` → wall-clock midnight. */
export function parseDateString(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(NaN)
}

export function isDateString(value: string | null | undefined): value is string {
  return !!value && isValid(parseDateString(value))
}

export function toDateString(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

export function addDaysTo(value: string, days: number): string {
  return toDateString(addDays(parseDateString(value), days))
}

/** The Monday (`YYYY-MM-DD`) of the week containing `value`. */
export function mondayOf(value: string): string {
  return toDateString(startOfWeek(parseDateString(value), { weekStartsOn: 1 }))
}

/** A Hapio timestamp as a wall-clock Date in `timeZone` (or in its own offset when omitted). */
export function zonedWallDate(iso: string, timeZone?: string | null): Date {
  return timeZone ? wallDate(toWallTime(iso, timeZone)) : wallDate(iso)
}

/** The current wall-clock time in a zone. */
export function nowWallDate(timeZone?: string | null): Date {
  return zonedWallDate(new Date().toISOString(), timeZone)
}

export type ScheduleStatus = "active" | "upcoming" | "ended"

export function recurringScheduleStatus(schedule: RecurringSchedule): ScheduleStatus {
  const today = todayIn(schedule.location?.time_zone)
  if (schedule.start_date > today) return "upcoming"
  if (schedule.end_date && schedule.end_date < today) return "ended"
  return "active"
}

/** Weekday order, then start time, then end time. */
export function compareWeeklyBlocks(a: RecurringScheduleBlock, b: RecurringScheduleBlock): number {
  return (
    WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) ||
    a.start_time.localeCompare(b.start_time) ||
    a.end_time.localeCompare(b.end_time)
  )
}
