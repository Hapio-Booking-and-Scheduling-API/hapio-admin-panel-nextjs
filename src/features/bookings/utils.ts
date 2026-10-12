// Helpers shared by the bookings and booking-groups features.

import { TZDate } from "@date-fns/tz"
import { add, format, isSameDay, isValid } from "date-fns"

import {
  METADATA_FILTER_FIELDS,
  TIMESTAMP_FILTER_FIELDS,
  type FilterFieldDef,
} from "@/components/filters/advanced-filters-model"
import {
  browserTimeZone,
  formatDateTime,
  HAPIO_TIMESTAMP_FORMAT,
  toHapioDateTime,
  toHapioTimestamp,
  toWallTime,
  wallDate,
} from "@/lib/format/datetime"
import { parseDuration } from "@/lib/format/duration"
import type {
  Booking,
  BookingEmbedded,
  BookingGroup,
  BookingGroupPut,
  BookingPut,
  BookingPutEmbedded,
  Service,
  Uuid,
} from "@/lib/hapio/types"

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const shortId = (id: string) => id.slice(0, 8)

// ---------------------------------------------------------------------------
// Status

export type BookingStatus = "confirmed" | "temporary" | "canceled"

export function bookingStatus(booking: Pick<BookingEmbedded, "is_canceled" | "is_temporary">): BookingStatus {
  if (booking.is_canceled) return "canceled"
  if (booking.is_temporary) return "temporary"
  return "confirmed"
}

/** "2 confirmed · 1 canceled" */
export function statusSummary(bookings: BookingEmbedded[]): string {
  if (!bookings.length) return "No bookings"
  const counts: Record<BookingStatus, number> = { confirmed: 0, temporary: 0, canceled: 0 }
  for (const b of bookings) counts[bookingStatus(b)]++
  return (["confirmed", "temporary", "canceled"] as const)
    .filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ")
}

// ---------------------------------------------------------------------------
// Time

/** The UTC offset a timestamp carries, e.g. "UTC+02:00" (or "UTC"). */
export function offsetLabel(iso: string): string {
  const m = /([+-]\d{2}:\d{2}|Z)$/.exec(iso)
  if (!m) return ""
  return m[1] === "Z" || m[1] === "+00:00" ? "UTC" : `UTC${m[1]}`
}

/** Milliseconds since epoch for a Hapio timestamp (NaN when invalid). */
export const instant = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN)

export function minutesBetween(from: string, to: string): number {
  const diff = instant(to) - instant(from)
  return Number.isFinite(diff) ? Math.round(diff / 60_000) : 0
}

/** 90 → "1 h 30 min", 1440 → "1 day", 0 → "0 min". */
export function formatMinutes(total: number): string {
  if (!Number.isFinite(total)) return "—"
  const sign = total < 0 ? "−" : ""
  let rest = Math.abs(Math.round(total))
  const days = Math.floor(rest / 1440)
  rest -= days * 1440
  const hours = Math.floor(rest / 60)
  const minutes = rest - hours * 60
  const parts: string[] = []
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`)
  if (hours) parts.push(`${hours} h`)
  if (minutes) parts.push(`${minutes} min`)
  return parts.length ? sign + parts.join(" ") : "0 min"
}

/**
 * The ends of a span carry different UTC offsets: a group spanning time zones, or a
 * booking across a DST change. Each end is then shown in its own wall time with its offset.
 */
const mixedOffsets = (span: { starts_at: string; ends_at: string }) =>
  offsetLabel(span.starts_at) !== offsetLabel(span.ends_at)

const withOffset = (text: string, iso: string) => (offsetLabel(iso) ? `${text} (${offsetLabel(iso)})` : text)

/** Date and time span of a booking in its own (location) wall time. */
export function bookingWhen(booking: { starts_at: string; ends_at: string }) {
  const start = wallDate(booking.starts_at)
  const end = wallDate(booking.ends_at)
  if (!isValid(start) || !isValid(end)) return { date: booking.starts_at, time: "" }
  const sameDay = isSameDay(start, end)
  if (mixedOffsets(booking)) {
    return {
      date: format(start, "EEE d MMM yyyy"),
      time: `${withOffset(format(start, "HH:mm"), booking.starts_at)} → ${withOffset(
        format(end, sameDay ? "HH:mm" : "d MMM, HH:mm"),
        booking.ends_at
      )}`,
    }
  }
  return {
    date: format(start, "EEE d MMM yyyy"),
    time: sameDay
      ? `${format(start, "HH:mm")}–${format(end, "HH:mm")}`
      : `${format(start, "HH:mm")} → ${format(end, "d MMM, HH:mm")}`,
  }
}

/**
 * "Mon 12 Oct 2026, 10:00–11:30" or "12 Oct 2026, 10:00 → 14 Oct 2026, 11:00"; with
 * offsets when the ends have different ones, e.g. "Tue 3 Nov 2026, 10:00 (UTC+01:00) →
 * 08:45 (UTC-05:00)".
 */
export function bookingTimeRange(booking: { starts_at: string; ends_at: string }): string {
  const start = wallDate(booking.starts_at)
  const end = wallDate(booking.ends_at)
  if (!isValid(start) || !isValid(end)) return `${booking.starts_at} → ${booking.ends_at}`
  const sameDay = isSameDay(start, end)
  if (mixedOffsets(booking)) {
    const from = sameDay ? format(start, "EEE d MMM yyyy, HH:mm") : formatDateTime(booking.starts_at)
    const to = sameDay ? format(end, "HH:mm") : formatDateTime(booking.ends_at)
    return `${withOffset(from, booking.starts_at)} → ${withOffset(to, booking.ends_at)}`
  }
  if (sameDay) return `${format(start, "EEE d MMM yyyy, HH:mm")}–${format(end, "HH:mm")}`
  return `${formatDateTime(booking.starts_at)} → ${formatDateTime(booking.ends_at)}`
}

export function bookingTitle(booking: Pick<BookingEmbedded, "service">): string {
  return booking.service?.name ?? "Booking"
}

/**
 * Earliest start and latest end across bookings (by instant). Each end keeps its own
 * booking's timestamp (and so its wall time and offset); `bookingTimeRange` and
 * `bookingWhen` label the offsets when they differ.
 */
export function groupSpan(bookings: BookingEmbedded[]): { starts_at: string; ends_at: string } | null {
  if (!bookings.length) return null
  let first = bookings[0]
  let last = bookings[0]
  for (const b of bookings) {
    if (instant(b.starts_at) < instant(first.starts_at)) first = b
    if (instant(b.ends_at) > instant(last.ends_at)) last = b
  }
  return { starts_at: first.starts_at, ends_at: last.ends_at }
}

export function sortByStart<T extends { starts_at: string }>(bookings: readonly T[]): T[] {
  return [...bookings].sort((a, b) => instant(a.starts_at) - instant(b.starts_at))
}

/** Unique names of a nested entity across bookings, in first-seen order. */
export function uniqueNames(bookings: BookingEmbedded[], key: "service" | "location" | "resource"): string[] {
  const names = new Set<string>()
  for (const b of bookings) {
    const entity = b[key]
    if (entity) names.add(entity.name)
  }
  return [...names]
}

/** Typical length for a new booking of this service, as an ISO duration. */
export function defaultDurationOf(service: Service | undefined): string | null {
  if (!service) return null
  if (service.type === "fixed") return service.duration
  if (service.type === "flexible") return service.default_duration ?? service.min_duration
  return null
}

/** Adds an ISO 8601 duration to a timestamp, calendar-aware in `timeZone`. */
export function addIsoDuration(iso: string, duration: string, timeZone?: string | null): string | null {
  const parts = parseDuration(duration)
  if (!parts) return null
  const date = new TZDate(iso, timeZone || browserTimeZone())
  if (!isValid(date)) return null
  return format(add(date, parts), HAPIO_TIMESTAMP_FORMAT)
}

/** Shifts a timestamp by `ms`, expressed in `timeZone`. */
export function shiftTimestamp(iso: string, ms: number, timeZone?: string | null): string | null {
  const t = instant(iso)
  if (!Number.isFinite(t) || !Number.isFinite(ms)) return null
  return toHapioTimestamp(t + ms, timeZone)
}

/** Keeps the wall time of a timestamp but moves it to another zone (e.g. when the location changes). */
export function rezoneWallTime(iso: string, fromZone?: string | null, toZone?: string | null): string {
  if (!iso) return iso
  return toHapioDateTime(toWallTime(iso, fromZone), toZone)
}

/**
 * New end time after the start changed: keeps the booking's length when an
 * end is set, otherwise fills in the service's default duration.
 */
export function endAfterStartChange(options: {
  previousStart: string
  nextStart: string
  end: string
  service: Service | undefined
  timeZone?: string | null
}): string | null {
  const { previousStart, nextStart, end, service, timeZone } = options
  if (!nextStart) return null
  if (end && previousStart) {
    const delta = instant(nextStart) - instant(previousStart)
    return delta ? shiftTimestamp(end, delta, timeZone) : null
  }
  if (!end) {
    const duration = defaultDurationOf(service)
    return duration ? addIsoDuration(nextStart, duration, timeZone) : null
  }
  return null
}

// ---------------------------------------------------------------------------
// PUT bodies (JSON tab)

/** Full replacement body for a booking, built from the API response. */
export function toBookingPutBody(booking: Booking): BookingPut {
  const body: BookingPut = {
    resource_id: booking.resource?.id ?? null,
    service_id: booking.service?.id ?? null,
    location_id: booking.location?.id ?? null,
    booking_group_id: booking.booking_group?.id ?? null,
    price: booking.price,
    metadata: booking.metadata,
    is_temporary: booking.is_temporary,
    is_canceled: booking.is_canceled,
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    buffer_starts_at: booking.buffer_starts_at,
    buffer_ends_at: booking.buffer_ends_at,
  }
  // Only present when the token has booking:protected_metadata; leave it out otherwise.
  if (booking.protected_metadata !== undefined) body.protected_metadata = booking.protected_metadata
  return body
}

/** A booking inside a booking group PUT body. */
export function toGroupBookingPutItem(booking: BookingEmbedded): { id: Uuid } & BookingPutEmbedded {
  const item: { id: Uuid } & BookingPutEmbedded = {
    id: booking.id,
    resource_id: booking.resource?.id ?? null,
    service_id: booking.service?.id ?? null,
    location_id: booking.location?.id ?? null,
    price: booking.price,
    metadata: booking.metadata,
    is_temporary: booking.is_temporary,
    is_canceled: booking.is_canceled,
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    buffer_starts_at: booking.buffer_starts_at,
    buffer_ends_at: booking.buffer_ends_at,
  }
  if (booking.protected_metadata !== undefined) item.protected_metadata = booking.protected_metadata
  return item
}

export function toGroupPutBody(group: BookingGroup): BookingGroupPut {
  const body: BookingGroupPut = {
    metadata: group.metadata,
    bookings: sortByStart(group.bookings).map(toGroupBookingPutItem),
  }
  if (group.protected_metadata !== undefined) body.protected_metadata = group.protected_metadata
  return body
}

// ---------------------------------------------------------------------------
// List filters & sorting

export const BOOKING_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "starts_at", label: "Starts", type: "datetime" },
  { key: "ends_at", label: "Ends", type: "datetime" },
  { key: "price", label: "Price", type: "price" },
  { key: "buffer_starts_at", label: "Buffer starts", type: "datetime" },
  { key: "buffer_ends_at", label: "Buffer ends", type: "datetime" },
  { key: "finalized_at", label: "Finalized", type: "datetime" },
  { key: "canceled_at", label: "Canceled", type: "datetime" },
  ...TIMESTAMP_FILTER_FIELDS,
  ...METADATA_FILTER_FIELDS,
]

/** Booking-level fields match a group when any of its bookings match. */
export const BOOKING_GROUP_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "group_created_at", label: "Group created", type: "datetime" },
  { key: "group_updated_at", label: "Group updated", type: "datetime" },
  { key: "group_metadata", label: "Group metadata", type: "metadata" },
  { key: "group_protected_metadata", label: "Group protected metadata", type: "metadata" },
  ...BOOKING_FILTER_FIELDS.map((f) => ({ ...f, label: `Booking ${f.label.toLowerCase()}` })),
]

export const BOOKING_SORT_FIELDS: Array<[key: string, label: string]> = [
  ["starts_at", "Start"],
  ["ends_at", "End"],
  ["buffer_starts_at", "Buffer start"],
  ["buffer_ends_at", "Buffer end"],
  ["created_at", "Created"],
  ["updated_at", "Updated"],
]
