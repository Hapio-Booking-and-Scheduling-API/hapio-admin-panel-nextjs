import { cn } from "cn"

import { formatDateTime } from "@/lib/format/datetime"
import type { BookingEmbedded } from "@/lib/hapio/types"

import { bookingStatus, formatMinutes, minutesBetween, offsetLabel } from "./utils"

const SEGMENT_TONE = {
  confirmed: "bg-primary text-primary-foreground",
  temporary: "bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/40 ring-inset dark:text-amber-300",
  canceled: "bg-destructive/10 text-destructive line-through",
} as const

const BUFFER_TONE =
  "bg-muted text-muted-foreground bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-border)_6px_7px)]"

function Point({ label, iso, muted }: { label: string; iso: string; muted?: boolean }) {
  return (
    <li className={cn("min-w-0 space-y-0.5", muted && "text-muted-foreground")}>
      <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{formatDateTime(iso, { pattern: "HH:mm" })}</p>
      <p className="text-xs text-muted-foreground">{formatDateTime(iso, { pattern: "EEE d MMM yyyy" })}</p>
    </li>
  )
}

/** Buffer start → start → end → buffer end, with proportional segments. */
export function BookingTimeline({ booking }: { booking: BookingEmbedded }) {
  const before = Math.max(0, minutesBetween(booking.buffer_starts_at, booking.starts_at))
  const length = Math.max(0, minutesBetween(booking.starts_at, booking.ends_at))
  const after = Math.max(0, minutesBetween(booking.ends_at, booking.buffer_ends_at))
  const total = before + length + after

  return (
    <div className="space-y-4">
      <div
        className="flex h-10 w-full gap-0.5 overflow-hidden rounded-lg text-xs font-medium"
        role="img"
        aria-label={`Buffer before ${formatMinutes(before)}, booking ${formatMinutes(length)}, buffer after ${formatMinutes(after)}`}
      >
        {before > 0 && (
          <div
            className={cn("flex min-w-16 items-center justify-center truncate px-2", BUFFER_TONE)}
            style={{ flex: `${before} 1 0%` }}
            title="Buffer before"
          >
            {formatMinutes(before)}
          </div>
        )}
        <div
          className={cn("flex min-w-24 items-center justify-center truncate px-2", SEGMENT_TONE[bookingStatus(booking)])}
          style={{ flex: `${Math.max(length, 1)} 1 0%` }}
          title="Booking"
        >
          {formatMinutes(length)}
        </div>
        {after > 0 && (
          <div
            className={cn("flex min-w-16 items-center justify-center truncate px-2", BUFFER_TONE)}
            style={{ flex: `${after} 1 0%` }}
            title="Buffer after"
          >
            {formatMinutes(after)}
          </div>
        )}
      </div>
      <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Point label="Buffer start" iso={booking.buffer_starts_at} muted={before === 0} />
        <Point label="Start" iso={booking.starts_at} />
        <Point label="End" iso={booking.ends_at} />
        <Point label="Buffer end" iso={booking.buffer_ends_at} muted={after === 0} />
      </ol>
      <p className="text-xs text-muted-foreground">
        {before || after
          ? `The resource is blocked for ${formatMinutes(total)} in total, including ${formatMinutes(before)} before and ${formatMinutes(after)} after.`
          : "No buffers: the resource is blocked only during the booking."}{" "}
        Times are local to the location
        {booking.location ? ` (${booking.location.time_zone}, ${offsetLabel(booking.starts_at)})` : ` (${offsetLabel(booking.starts_at)})`}.
      </p>
    </div>
  )
}
