"use client"

import { useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  CheckCircle2Icon,
  EyeIcon,
  FolderMinusIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLayoutEffect, useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { BookingStatusBadge } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { CopyId } from "@/components/entity/copy-id"
import { DetailList } from "@/components/entity/detail-list"
import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { RawJsonCard } from "@/components/entity/raw-json-card"
import { RowActions, type RowAction } from "@/components/entity/row-actions"
import { SectionCard } from "@/components/entity/section-card"
import { DetailSkeleton } from "@/components/entity/skeletons"
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CancelBookingDialog } from "@/features/bookings/cancel-booking-dialog"
import { useBookingActions } from "@/features/bookings/use-booking-actions"
import {
  bookingTimeRange,
  bookingTitle,
  bookingWhen,
  groupSpan,
  shortId,
  sortByStart,
  statusSummary,
  toGroupPutBody,
  uniqueNames,
} from "@/features/bookings/utils"
import { formatDateTime } from "@/lib/format/datetime"
import { formatPrice } from "@/lib/format/price"
import { hapio } from "@/lib/hapio/client"
import { hapioKey, useBookingGroup, useHapioMutation } from "@/lib/hapio/hooks"
import type { BookingEmbedded, BookingGroup, BookingGroupPut } from "@/lib/hapio/types"

import { BookingGroupEditDialog } from "./booking-group-form"

const linkClass = "underline-offset-4 hover:underline"

function MetadataBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{JSON.stringify(value ?? null, null, 2)}</pre>
  )
}

export function BookingGroupDetail({ id }: { id: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  // Set once the group is deleted: stop observing it, so nothing refetches it (that would
  // only 404), and keep showing it until the navigation away has finished.
  const [deleted, setDeleted] = useState<BookingGroup | null>(null)
  // Next keeps this page mounted (hidden) after navigating away; if it's shown again,
  // e.g. on Back, load the group afresh so the 404 shows instead of the deleted group.
  useLayoutEffect(() => () => setDeleted(null), [])
  const query = useBookingGroup(deleted ? null : id)
  const data = deleted ?? query.data
  const actions = useBookingActions()
  const [editing, setEditing] = useState(false)
  const [canceling, setCanceling] = useState<BookingEmbedded | null>(null)
  const [ungrouping, setUngrouping] = useState<BookingEmbedded | null>(null)
  const [deletingBooking, setDeletingBooking] = useState<BookingEmbedded | null>(null)
  useBreadcrumbLabel(id, data ? `Group ${shortId(data.id)}` : undefined)

  const remove = useHapioMutation(() => hapio.bookingGroups.delete(id), {
    success: "Booking group deleted",
    onSuccess: () => {
      router.push("/booking-groups")
      setDeleted(query.data ?? null)
      // Runs before the mutation hook's blanket invalidation, which would refetch it.
      queryClient.removeQueries({ queryKey: hapioKey("booking-groups", "detail", id) })
    },
  })
  const replace = useHapioMutation((body: unknown) => hapio.bookingGroups.replace(id, body as BookingGroupPut), {
    success: "Booking group replaced",
    // RawJsonCard shows the error inside its dialog.
    toastErrors: false,
  })

  if (query.isLoading) return <DetailSkeleton />
  // A failed refetch keeps the data we have; only show the error when there's nothing else to show.
  if (!data) return <ErrorAlert error={query.error} onRetry={() => query.refetch()} />

  const group = data
  const bookings = sortByStart(group.bookings)
  const span = groupSpan(bookings)
  const count = bookings.length

  const rowActions = (b: BookingEmbedded): RowAction[] => [
    { label: "View", icon: <EyeIcon />, onSelect: () => router.push(`/bookings/${b.id}`) },
    ...(b.is_temporary && !b.is_canceled
      ? [{ label: "Finalize", icon: <CheckCircle2Icon />, onSelect: () => actions.finalize.mutate(b.id) }]
      : []),
    b.is_canceled
      ? { label: "Restore", icon: <RotateCcwIcon />, onSelect: () => actions.restore.mutate(b.id) }
      : { label: "Cancel booking", icon: <BanIcon />, onSelect: () => setCanceling(b) },
    { label: "Remove from group", icon: <FolderMinusIcon />, onSelect: () => setUngrouping(b) },
    {
      label: "Delete",
      icon: <Trash2Icon />,
      destructive: true,
      separatorBefore: true,
      onSelect: () => setDeletingBooking(b),
    },
  ]

  const columns: Column<BookingEmbedded>[] = [
    {
      id: "when",
      header: "When",
      cell: (b) => {
        const when = bookingWhen(b)
        return (
          <div className="flex flex-col">
            <span className="font-medium whitespace-nowrap">{when.date}</span>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{when.time}</span>
          </div>
        )
      },
    },
    {
      id: "service",
      header: "Service",
      cell: (b) =>
        b.service ? (
          <Link className={`font-medium ${linkClass}`} href={`/services/${b.service.id}`}>
            {b.service.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "resource",
      header: "Resource",
      className: "hidden md:table-cell",
      cell: (b) =>
        b.resource ? (
          <Link className={linkClass} href={`/resources/${b.resource.id}`}>
            {b.resource.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "location",
      header: "Location",
      className: "hidden lg:table-cell",
      cell: (b) =>
        b.location ? (
          <Link className={linkClass} href={`/locations/${b.location.id}`}>
            {b.location.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: "status", header: "Status", cell: (b) => <BookingStatusBadge booking={b} /> },
    {
      id: "price",
      header: "Price",
      className: "hidden sm:table-cell text-right tabular-nums",
      cell: (b) => formatPrice(b.price),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-10 text-right",
      cell: (b) => <RowActions label={`Actions for booking ${shortId(b.id)}`} actions={rowActions(b)} />,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <>
            Booking group <span className="font-mono">{shortId(group.id)}</span>
          </>
        }
        badges={<Badge variant="secondary">{count === 1 ? "1 booking" : `${count} bookings`}</Badge>}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CopyId id={group.id} />
            <span>{statusSummary(bookings)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/bookings/new?booking_group=${group.id}`}>
                <PlusIcon /> Add booking
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
            <ConfirmDialog
              title={`Delete group ${shortId(group.id)}?`}
              description={
                count
                  ? `This permanently deletes the group and ${
                      count === 1 ? "its 1 booking" : `all ${count} of its bookings`
                    }. This can't be undone. To keep the bookings, remove them from the group first.`
                  : "This permanently deletes the group. It has no bookings. This can't be undone."
              }
              confirmLabel={count ? "Delete group and bookings" : "Delete group"}
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
          <SectionCard title="Summary">
            <DetailList
              items={[
                {
                  label: "Span",
                  value: span ? bookingTimeRange(span) : <span className="text-muted-foreground">No bookings</span>,
                },
                { label: "Status", value: statusSummary(bookings) },
                { label: "Services", value: uniqueNames(bookings, "service").join(", ") || "—" },
                { label: "Locations", value: uniqueNames(bookings, "location").join(", ") || "—" },
                { label: "Created", value: formatDateTime(group.created_at, { withOffset: true }) },
                { label: "Updated", value: formatDateTime(group.updated_at, { withOffset: true }) },
              ]}
            />
          </SectionCard>
          <SectionCard
            title="Bookings"
            description="Times are local to each booking's location."
            action={
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <PencilIcon /> Edit bookings
              </Button>
            }
          >
            <DataTable
              columns={columns}
              data={bookings}
              getRowId={(b) => b.id}
              isFetching={query.isFetching}
              rowHref={(b) => `/bookings/${b.id}`}
              rowClassName={(b) => (b.is_canceled ? "text-muted-foreground" : undefined)}
              emptyTitle="No bookings in this group"
              emptyDescription="Add a booking to this group, or delete the empty group."
              emptyAction={
                <Button size="sm" asChild>
                  <Link href={`/bookings/new?booking_group=${group.id}`}>
                    <PlusIcon /> Add booking
                  </Link>
                </Button>
              }
            />
          </SectionCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Group metadata">
              <MetadataBlock value={group.metadata} />
            </SectionCard>
            <SectionCard
              title="Group protected metadata"
              description={
                group.protected_metadata === undefined
                  ? "Not returned: the token lacks booking:protected_metadata."
                  : undefined
              }
            >
              <MetadataBlock value={group.protected_metadata} />
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="json">
          <RawJsonCard
            value={group}
            toPutBody={toGroupPutBody}
            onReplace={(body) => replace.mutateAsync(body)}
            description="The raw API response. A PUT replaces every booking: ones missing from the body are deleted."
          />
        </TabsContent>
      </Tabs>
      {editing && <BookingGroupEditDialog group={group} onOpenChange={setEditing} />}
      <CancelBookingDialog
        booking={canceling}
        open={!!canceling}
        onOpenChange={(open) => !open && setCanceling(null)}
        onConfirm={({ ignoreThreshold }) => actions.cancel.mutateAsync({ id: canceling!.id, ignoreThreshold })}
      />
      <ConfirmDialog
        open={!!ungrouping}
        onOpenChange={(open) => !open && setUngrouping(null)}
        title="Remove from group?"
        description={
          ungrouping
            ? `${bookingTitle(ungrouping)}, ${bookingTimeRange(ungrouping)}. The booking is kept but no longer belongs to this group.`
            : undefined
        }
        confirmLabel="Remove from group"
        onConfirm={() => actions.setGroup.mutateAsync({ id: ungrouping!.id, groupId: null })}
      />
      <ConfirmDialog
        open={!!deletingBooking}
        onOpenChange={(open) => !open && setDeletingBooking(null)}
        title="Delete this booking permanently?"
        description={
          deletingBooking
            ? `${bookingTitle(deletingBooking)}, ${bookingTimeRange(deletingBooking)}. This can't be undone. To free up the time but keep a record, cancel the booking instead.`
            : undefined
        }
        confirmLabel="Delete booking"
        destructive
        onConfirm={() => actions.remove.mutateAsync(deletingBooking!.id)}
      />
    </div>
  )
}
