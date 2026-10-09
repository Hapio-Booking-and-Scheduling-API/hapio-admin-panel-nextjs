"use client"

import {
  BanIcon,
  CheckCircle2Icon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { useListState } from "@/components/data-table/use-list-state"
import { BookingStatusBadge } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { PageHeader } from "@/components/entity/page-header"
import { RowActions, type RowAction } from "@/components/entity/row-actions"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format/datetime"
import { formatPrice } from "@/lib/format/price"
import { useBookings } from "@/lib/hapio/hooks"
import type { Booking } from "@/lib/hapio/types"

import { BookingFilterBar, bookingFilterParams, bookingFiltersActive, useBookingFilters } from "./booking-filters"
import { BookingEditDialog } from "./booking-form"
import { CancelBookingDialog } from "./cancel-booking-dialog"
import { useBookingActions } from "./use-booking-actions"
import { BOOKING_FILTER_FIELDS, bookingTimeRange, bookingTitle, bookingWhen, shortId } from "./utils"

const linkClass = "underline-offset-4 hover:underline"

export function BookingsPage() {
  const router = useRouter()
  const list = useListState()
  const [filters, setFilters, resetFilters] = useBookingFilters()
  const [editing, setEditing] = useState<Booking | null>(null)
  const [canceling, setCanceling] = useState<Booking | null>(null)
  const [deleting, setDeleting] = useState<Booking | null>(null)
  const actions = useBookingActions()

  const query = useBookings({
    page: list.page,
    per_page: list.perPage,
    sort: list.sort || undefined,
    ...bookingFilterParams(filters, BOOKING_FILTER_FIELDS),
  })

  const rowActions = (b: Booking): RowAction[] => [
    { label: "View", icon: <EyeIcon />, onSelect: () => router.push(`/bookings/${b.id}`) },
    { label: "Edit", icon: <PencilIcon />, onSelect: () => setEditing(b) },
    ...(b.is_temporary && !b.is_canceled
      ? [{ label: "Finalize", icon: <CheckCircle2Icon />, onSelect: () => actions.finalize.mutate(b.id) }]
      : []),
    b.is_canceled
      ? { label: "Restore", icon: <RotateCcwIcon />, onSelect: () => actions.restore.mutate(b.id) }
      : { label: "Cancel booking", icon: <BanIcon />, onSelect: () => setCanceling(b) },
    {
      label: "Delete",
      icon: <Trash2Icon />,
      destructive: true,
      separatorBefore: true,
      onSelect: () => setDeleting(b),
    },
  ]

  const columns: Column<Booking>[] = [
    {
      id: "when",
      header: "When",
      sortKey: "starts_at",
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
      className: "hidden md:table-cell text-right tabular-nums",
      cell: (b) => formatPrice(b.price),
    },
    {
      id: "group",
      header: "Group",
      className: "hidden xl:table-cell",
      cell: (b) =>
        b.booking_group ? (
          <Link className={`font-mono text-xs ${linkClass}`} href={`/booking-groups/${b.booking_group.id}`}>
            {shortId(b.booking_group.id)}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "created_at",
      header: "Created",
      sortKey: "created_at",
      className: "hidden lg:table-cell whitespace-nowrap",
      cell: (b) => formatDateTime(b.created_at),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-10 text-right",
      cell: (b) => <RowActions label={`Actions for booking ${shortId(b.id)}`} actions={rowActions(b)} />,
    },
  ]

  const filtersActive = bookingFiltersActive(filters)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Bookings"
        description="Every booking across your locations, in each location's local time."
        actions={
          <Button asChild>
            <Link href="/bookings/new">
              <PlusIcon /> New booking
            </Link>
          </Button>
        }
      />
      <BookingFilterBar
        filters={filters}
        setFilters={setFilters}
        onReset={resetFilters}
        fields={BOOKING_FILTER_FIELDS}
        sort={list.sort}
        onSortChange={list.setSort}
      />
      <DataTable
        columns={columns}
        data={query.data?.data}
        meta={query.data?.meta}
        getRowId={(b) => b.id}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        pagination={{
          page: list.page,
          perPage: list.perPage,
          onPageChange: list.setPage,
          onPerPageChange: list.setPerPage,
        }}
        rowHref={(b) => `/bookings/${b.id}`}
        rowClassName={(b) => (b.is_canceled ? "text-muted-foreground" : undefined)}
        emptyTitle="No bookings"
        emptyDescription={
          filtersActive ? "No bookings match these filters." : "Create a booking, or book one from a service's bookable slots."
        }
        emptyAction={
          filtersActive ? (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Reset filters
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link href="/bookings/new">
                <PlusIcon /> New booking
              </Link>
            </Button>
          )
        }
      />
      {editing && (
        <BookingEditDialog booking={editing} open onOpenChange={(open) => !open && setEditing(null)} />
      )}
      <CancelBookingDialog
        booking={canceling}
        open={!!canceling}
        onOpenChange={(open) => !open && setCanceling(null)}
        onConfirm={({ ignoreThreshold }) => actions.cancel.mutateAsync({ id: canceling!.id, ignoreThreshold })}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this booking permanently?"
        description={
          deleting
            ? `${bookingTitle(deleting)}, ${bookingTimeRange(deleting)}. This can't be undone. To free up the time but keep a record, cancel the booking instead.`
            : undefined
        }
        confirmLabel="Delete booking"
        destructive
        onConfirm={() => actions.remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}
