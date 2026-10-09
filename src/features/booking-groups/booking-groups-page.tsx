"use client"

import { EyeIcon, PlusIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { useListState } from "@/components/data-table/use-list-state"
import { MetadataPreview } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { PageHeader } from "@/components/entity/page-header"
import { RowActions } from "@/components/entity/row-actions"
import { Button } from "@/components/ui/button"
import {
  BookingFilterBar,
  bookingFilterParams,
  bookingFiltersActive,
  useBookingFilters,
} from "@/features/bookings/booking-filters"
import {
  BOOKING_GROUP_FILTER_FIELDS,
  bookingWhen,
  groupSpan,
  shortId,
  statusSummary,
  uniqueNames,
} from "@/features/bookings/utils"
import { formatDateTime } from "@/lib/format/datetime"
import { hapio } from "@/lib/hapio/client"
import { useBookingGroups, useHapioMutation } from "@/lib/hapio/hooks"
import type { BookingGroup } from "@/lib/hapio/types"

function Names({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-muted-foreground">—</span>
  const shown = names.slice(0, 2).join(", ")
  return (
    <span title={names.join(", ")}>
      {shown}
      {names.length > 2 && <span className="text-muted-foreground"> +{names.length - 2}</span>}
    </span>
  )
}

export function BookingGroupsPage() {
  const router = useRouter()
  const list = useListState()
  const [filters, setFilters, resetFilters] = useBookingFilters()
  const [deleting, setDeleting] = useState<BookingGroup | null>(null)

  const query = useBookingGroups({
    page: list.page,
    per_page: list.perPage,
    sort: list.sort || undefined,
    ...bookingFilterParams(filters, BOOKING_GROUP_FILTER_FIELDS),
  })

  const remove = useHapioMutation((id: string) => hapio.bookingGroups.delete(id), {
    success: "Booking group deleted",
  })

  const columns: Column<BookingGroup>[] = [
    {
      id: "group",
      header: "Group",
      cell: (g) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs font-medium">{shortId(g.id)}</span>
          <MetadataPreview value={g.metadata} />
        </div>
      ),
    },
    {
      id: "count",
      header: "Bookings",
      className: "text-right tabular-nums",
      cell: (g) => g.bookings.length,
    },
    {
      id: "span",
      header: "Span",
      sortKey: "starts_at",
      cell: (g) => {
        const span = groupSpan(g.bookings)
        if (!span) return <span className="text-muted-foreground">—</span>
        const when = bookingWhen(span)
        return (
          <div className="flex flex-col">
            <span className="font-medium whitespace-nowrap">{when.date}</span>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{when.time}</span>
          </div>
        )
      },
    },
    {
      id: "services",
      header: "Services",
      className: "hidden md:table-cell",
      cell: (g) => <Names names={uniqueNames(g.bookings, "service")} />,
    },
    {
      id: "status",
      header: "Status",
      className: "hidden sm:table-cell",
      cell: (g) => <span className="text-sm whitespace-nowrap">{statusSummary(g.bookings)}</span>,
    },
    {
      id: "created_at",
      header: "Created",
      className: "hidden lg:table-cell whitespace-nowrap",
      cell: (g) => formatDateTime(g.created_at),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-10 text-right",
      cell: (g) => (
        <RowActions
          label={`Actions for group ${shortId(g.id)}`}
          actions={[
            { label: "View", icon: <EyeIcon />, onSelect: () => router.push(`/booking-groups/${g.id}`) },
            {
              label: "Delete",
              icon: <Trash2Icon />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setDeleting(g),
            },
          ]}
        />
      ),
    },
  ]

  const filtersActive = bookingFiltersActive(filters)
  const deletingCount = deleting?.bookings.length ?? 0

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Booking groups"
        description="Bookings created and managed together, e.g. a multi-service appointment."
        actions={
          <Button asChild>
            <Link href="/booking-groups/new">
              <PlusIcon /> New booking group
            </Link>
          </Button>
        }
      />
      <BookingFilterBar
        filters={filters}
        setFilters={setFilters}
        onReset={resetFilters}
        fields={BOOKING_GROUP_FILTER_FIELDS}
        sort={list.sort}
        onSortChange={list.setSort}
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        Booking filters match a group when any of its bookings match; the whole group is shown.
      </p>
      <DataTable
        columns={columns}
        data={query.data?.data}
        meta={query.data?.meta}
        getRowId={(g) => g.id}
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
        rowHref={(g) => `/booking-groups/${g.id}`}
        emptyTitle="No booking groups"
        emptyDescription={
          filtersActive ? "No booking groups match these filters." : "Group bookings that belong together, like a series or a package."
        }
        emptyAction={
          filtersActive ? (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Reset filters
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link href="/booking-groups/new">
                <PlusIcon /> New booking group
              </Link>
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete group ${deleting ? shortId(deleting.id) : ""}?`}
        description={`This permanently deletes the group and ${
          deletingCount === 1 ? "its 1 booking" : `all ${deletingCount} of its bookings`
        }. This can't be undone.`}
        confirmLabel={deletingCount ? "Delete group and bookings" : "Delete group"}
        destructive
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}
