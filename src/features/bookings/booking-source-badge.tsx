import { Badge } from "@/components/ui/badge"
import { adminConfig, type AdminConfig } from "@/lib/admin-config"
import type { Booking } from "@/lib/hapio/types"

/** The label for where a booking came from, by the metadata key in NEXT_PUBLIC_BOOKING_SOURCE_KEY. */
export function bookingSourceLabel(booking: Pick<Booking, "metadata">, config: AdminConfig = adminConfig): string | null {
  if (!config.bookingSource) return null
  const value = (booking.metadata as Record<string, unknown> | null | undefined)?.[config.bookingSource.key]
  if (value === undefined || value === null || value === "") return null
  return config.bookingSource.labels[String(value)] ?? String(value)
}

/** Shows where a booking came from, like "Booked via AI". */
export function BookingSourceBadge({ booking }: { booking: Pick<Booking, "metadata"> }) {
  const label = bookingSourceLabel(booking)
  return label ? <Badge variant="secondary">{label}</Badge> : null
}
