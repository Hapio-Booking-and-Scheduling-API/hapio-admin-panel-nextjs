import { Badge } from "@/components/ui/badge"
import type { Booking, BookingEmbedded } from "@/lib/hapio/types"

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
      Enabled
    </Badge>
  ) : (
    <Badge variant="secondary">Disabled</Badge>
  )
}

export function BookingStatusBadge({ booking }: { booking: Booking | BookingEmbedded }) {
  if (booking.is_canceled) return <Badge variant="destructive">Canceled</Badge>
  if (booking.is_temporary)
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
        Temporary
      </Badge>
    )
  return (
    <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
      Confirmed
    </Badge>
  )
}

export function MetadataPreview({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  const keys = typeof value === "object" ? Object.keys(value as object) : []
  if (!keys.length) return <span className="text-muted-foreground">{"{}"}</span>
  return (
    <span className="font-mono text-xs text-muted-foreground" title={JSON.stringify(value)}>
      {keys.slice(0, 3).join(", ")}
      {keys.length > 3 ? ` +${keys.length - 3}` : ""}
    </span>
  )
}
