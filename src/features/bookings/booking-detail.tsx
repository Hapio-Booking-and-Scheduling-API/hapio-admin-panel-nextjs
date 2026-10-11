"use client"

import {
  BanIcon,
  CheckCircle2Icon,
  FolderInputIcon,
  FolderMinusIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { BookingStatusBadge, MetadataPreview } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { CopyId } from "@/components/entity/copy-id"
import { DetailList } from "@/components/entity/detail-list"
import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { RawJsonCard } from "@/components/entity/raw-json-card"
import { SectionCard } from "@/components/entity/section-card"
import { DetailSkeleton } from "@/components/entity/skeletons"
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime } from "@/lib/format/datetime"
import { humanizeDuration } from "@/lib/format/duration"
import { formatPrice } from "@/lib/format/price"
import { hapio } from "@/lib/hapio/client"
import { hapioKey, useBooking, useHapioMutation } from "@/lib/hapio/hooks"
import type { Booking, BookingPut } from "@/lib/hapio/types"

import { BookingEditDialog } from "./booking-form"
import { BookingTimeline } from "./booking-timeline"
import { CancelBookingDialog } from "./cancel-booking-dialog"
import { MoveToGroupDialog } from "./move-to-group-dialog"
import { useBookingActions } from "./use-booking-actions"
import { bookingStatus, type BookingStatus, bookingTimeRange, bookingTitle, shortId, toBookingPutBody } from "./utils"

const linkClass = "font-medium underline-offset-4 hover:underline"

const STATUS_TEXT: Record<BookingStatus, string> = {
  temporary: "Holds the time until it's finalized.",
  canceled: "Kept for the record; its time is free for other bookings.",
  confirmed: "Finalized and blocking its time.",
}

function serviceSummary(booking: Booking) {
  const service = booking.service
  if (!service) return null
  if (service.type === "fixed") return `Fixed · ${humanizeDuration(service.duration)}`
  if (service.type === "flexible") return "Flexible length"
  return "Full days"
}

function MetadataBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{JSON.stringify(value ?? null, null, 2)}</pre>
  )
}

export function BookingDetail({ id }: { id: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  // Once deleted, the page keeps showing the booking without fetching it again (a 404)
  // until the navigation to the list is done.
  const [deleted, setDeleted] = useState<Booking>()
  const query = useBooking(deleted ? null : id)
  const actions = useBookingActions()
  const [editing, setEditing] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [moving, setMoving] = useState(false)

  const booking = deleted ?? query.data
  useBreadcrumbLabel(
    id,
    booking ? `${bookingTitle(booking)} · ${formatDateTime(booking.starts_at, { pattern: "d MMM, HH:mm" })}` : undefined
  )

  const remove = useHapioMutation(() => hapio.bookings.delete(id), {
    success: "Booking deleted",
    onSuccess: () => {
      setDeleted(booking)
      router.push("/bookings")
      // Drop the deleted booking before the mutation refreshes every Hapio query.
      queryClient.removeQueries({ queryKey: hapioKey("bookings", "detail", id) })
    },
  })
  const replace = useHapioMutation((body: unknown) => hapio.bookings.replace(id, body as BookingPut), {
    success: "Booking replaced",
    // The Replace dialog shows the error itself.
    toastErrors: false,
  })

  if (!booking && query.isLoading) return <DetailSkeleton />
  // A failed refetch keeps the booking we already have on screen.
  if (!booking) return <ErrorAlert error={query.error} onRetry={() => query.refetch()} />

  const status = bookingStatus(booking)
  const group = booking.booking_group

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={bookingTitle(booking)}
        badges={<BookingStatusBadge booking={booking} />}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{bookingTimeRange(booking)}</span>
            <CopyId id={booking.id} />
          </span>
        }
        actions={
          <>
            {booking.is_temporary && !booking.is_canceled && (
              <Button
                variant="outline"
                onClick={() => actions.finalize.mutate(booking.id)}
                disabled={actions.finalize.isPending}
              >
                <CheckCircle2Icon /> Finalize
              </Button>
            )}
            {booking.is_canceled ? (
              <Button
                variant="outline"
                onClick={() => actions.restore.mutate(booking.id)}
                disabled={actions.restore.isPending}
              >
                <RotateCcwIcon /> Restore
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setCanceling(true)}>
                <BanIcon /> Cancel booking
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
            <ConfirmDialog
              title="Delete this booking permanently?"
              description={
                booking.is_canceled
                  ? "The booking is removed for good and can't be restored."
                  : "The booking is removed for good and can't be restored. To free up its time but keep a record, cancel it instead."
              }
              confirmLabel="Delete booking"
              destructive
              onConfirm={() => remove.mutateAsync()}
              trigger={
                <Button variant="destructive">
                  <Trash2Icon /> Delete
                </Button>
              }
            />
          </>
        }
      />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="flex flex-col gap-4">
          <SectionCard title="Time">
            <BookingTimeline booking={booking} />
          </SectionCard>
          <SectionCard title="Details">
            <DetailList
              items={[
                {
                  label: "Service",
                  value: booking.service ? (
                    <>
                      <Link className={linkClass} href={`/services/${booking.service.id}`}>
                        {booking.service.name}
                      </Link>
                      <span className="block text-muted-foreground">{serviceSummary(booking)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No service</span>
                  ),
                },
                {
                  label: "Resource",
                  value: booking.resource ? (
                    <Link className={linkClass} href={`/resources/${booking.resource.id}`}>
                      {booking.resource.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No resource</span>
                  ),
                },
                {
                  label: "Location",
                  value: booking.location ? (
                    <>
                      <Link className={linkClass} href={`/locations/${booking.location.id}`}>
                        {booking.location.name}
                      </Link>
                      <span className="block text-muted-foreground">{booking.location.time_zone}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No location</span>
                  ),
                },
                {
                  label: "Status",
                  value: (
                    <>
                      <BookingStatusBadge booking={booking} />
                      <span className="mt-1 block text-muted-foreground">{STATUS_TEXT[status]}</span>
                    </>
                  ),
                },
                {
                  label: "Price",
                  value: booking.price === null ? <span className="text-muted-foreground">No price</span> : formatPrice(booking.price),
                },
                {
                  label: "Booking group",
                  value: group ? (
                    <div className="flex flex-col items-start gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link className={`${linkClass} font-mono text-xs`} href={`/booking-groups/${group.id}`}>
                          {shortId(group.id)}…
                        </Link>
                        <MetadataPreview value={group.metadata} />
                      </span>
                      <span className="flex flex-wrap gap-1">
                        <Button variant="outline" size="xs" onClick={() => setMoving(true)}>
                          <FolderInputIcon /> Move
                        </Button>
                        <ConfirmDialog
                          title="Remove from group?"
                          description={`The booking is kept but no longer belongs to group ${shortId(group.id)}.`}
                          confirmLabel="Remove from group"
                          onConfirm={() => actions.setGroup.mutateAsync({ id: booking.id, groupId: null })}
                          trigger={
                            <Button variant="outline" size="xs">
                              <FolderMinusIcon /> Remove
                            </Button>
                          }
                        />
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-1.5">
                      <span className="text-muted-foreground">Not in a group</span>
                      <Button variant="outline" size="xs" onClick={() => setMoving(true)}>
                        <FolderInputIcon /> Add to group
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </SectionCard>
          <SectionCard title="History">
            <DetailList
              items={[
                { label: "Created", value: formatDateTime(booking.created_at, { withOffset: true }) },
                { label: "Updated", value: formatDateTime(booking.updated_at, { withOffset: true }) },
                {
                  label: "Finalized",
                  value: booking.finalized_at
                    ? formatDateTime(booking.finalized_at, { withOffset: true })
                    : <span className="text-muted-foreground">{booking.is_temporary ? "Not yet" : "—"}</span>,
                },
                {
                  label: "Canceled",
                  value: booking.canceled_at
                    ? formatDateTime(booking.canceled_at, { withOffset: true })
                    : <span className="text-muted-foreground">—</span>,
                },
              ]}
            />
          </SectionCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Metadata">
              <MetadataBlock value={booking.metadata} />
            </SectionCard>
            <SectionCard
              title="Protected metadata"
              description={
                booking.protected_metadata === undefined
                  ? "Not returned: the token lacks booking:protected_metadata."
                  : undefined
              }
            >
              <MetadataBlock value={booking.protected_metadata} />
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="json">
          <RawJsonCard
            value={booking}
            toPutBody={toBookingPutBody}
            onReplace={(body) => replace.mutateAsync(body)}
          />
        </TabsContent>
      </Tabs>
      <BookingEditDialog booking={booking} open={editing} onOpenChange={setEditing} />
      <MoveToGroupDialog booking={booking} open={moving} onOpenChange={setMoving} />
      <CancelBookingDialog
        booking={booking}
        open={canceling}
        onOpenChange={setCanceling}
        onConfirm={({ ignoreThreshold }) => actions.cancel.mutateAsync({ id: booking.id, ignoreThreshold })}
      />
    </div>
  )
}
