"use client"

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { parseAsString } from "nuqs"
import { useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { RowActions } from "@/components/entity/row-actions"
import { FilterBar } from "@/components/filters/filter-bar"
import { SortSelect, sortOptions } from "@/components/filters/sort-select"
import { DateTimeInput } from "@/components/inputs/date-time-input"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { can } from "@/lib/admin-config"
import { formatDateTime } from "@/lib/format/datetime"
import { hapio } from "@/lib/hapio/client"
import { indexById, useAllLocations, useHapioMutation } from "@/lib/hapio/hooks"
import type { Resource, ScheduleBlock } from "@/lib/hapio/types"

import { useScheduleBlocks } from "./queries"
import { ScheduleBlockFormDialog } from "./schedule-block-form"
import { sameWallDay } from "./schedule-blocks-model"
import { usePrefixedFilters, usePrefixedListState } from "./use-tab-state"
import { formatMinutes, spanMinutes } from "./utils"

const SORT_OPTIONS = sortOptions([
  ["starts_at", "Starts"],
  ["ends_at", "Ends"],
  ["created_at", "Created"],
  ["updated_at", "Updated"],
])

const FILTERS = { location: parseAsString, from: parseAsString, to: parseAsString }

export function ScheduleBlockTypeBadge({ available }: { available: boolean }) {
  return available ? (
    <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
      Available
    </Badge>
  ) : (
    <Badge variant="destructive">Blocked</Badge>
  )
}

export function ScheduleBlocksTab({ resource }: { resource: Resource }) {
  const list = usePrefixedListState("sb")
  const [filters, setFilters, resetFilters] = usePrefixedFilters("sb", FILTERS)
  const locations = useAllLocations()
  const locationsById = indexById(locations.data)
  const filterZone = filters.location ? locationsById.get(filters.location)?.time_zone : undefined

  const [dialog, setDialog] = useState<{ block?: ScheduleBlock } | null>(null)
  const [deleting, setDeleting] = useState<ScheduleBlock | null>(null)

  const query = useScheduleBlocks(resource.id, {
    page: list.page,
    per_page: list.perPage,
    sort: list.sort || undefined,
    location: filters.location ?? undefined,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
  })

  const remove = useHapioMutation((id: string) => hapio.scheduleBlocks(resource.id).delete(id), {
    success: "Schedule block deleted",
  })

  const endLabel = (b: ScheduleBlock) =>
    sameWallDay(b.starts_at, b.ends_at) ? formatDateTime(b.ends_at, { pattern: "HH:mm" }) : formatDateTime(b.ends_at)

  const columns: Column<ScheduleBlock>[] = [
    {
      id: "location",
      header: "Location",
      className: "hidden sm:table-cell",
      cell: (b) =>
        b.location ? (
          <div className="min-w-0">
            <Link href={`/locations/${b.location.id}`} className="font-medium underline-offset-4 hover:underline">
              {b.location.name}
            </Link>
            <div className="hidden text-xs text-muted-foreground md:block">{b.location.time_zone}</div>
          </div>
        ) : (
          "—"
        ),
    },
    {
      id: "starts_at",
      header: "Starts",
      sortKey: "starts_at",
      cell: (b) => (
        <div className="tabular-nums">
          {formatDateTime(b.starts_at)}
          <div className="text-xs text-muted-foreground md:hidden">until {endLabel(b)}</div>
          <div className="text-xs text-muted-foreground sm:hidden">{b.location?.name}</div>
        </div>
      ),
    },
    {
      id: "ends_at",
      header: "Ends",
      sortKey: "ends_at",
      className: "hidden md:table-cell",
      cell: (b) => <span className="tabular-nums">{endLabel(b)}</span>,
    },
    {
      id: "duration",
      header: "Duration",
      className: "hidden lg:table-cell",
      cell: (b) => <span className="tabular-nums">{formatMinutes(spanMinutes(b.starts_at, b.ends_at))}</span>,
    },
    { id: "type", header: "Type", cell: (b) => <ScheduleBlockTypeBadge available={b.is_available} /> },
  ]
  const canUpdate = can("schedules", "update")
  const canDelete = can("schedules", "delete")
  if (canUpdate || canDelete) {
    columns.push({
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-10 text-right",
      cell: (b) => (
        <RowActions
          label={`Actions for block ${formatDateTime(b.starts_at)}`}
          actions={[
            ...(canUpdate ? [{ label: "Edit", icon: <PencilIcon />, onSelect: () => setDialog({ block: b }) }] : []),
            ...(canDelete
              ? [
                  {
                    label: "Delete",
                    icon: <Trash2Icon />,
                    destructive: true,
                    separatorBefore: canUpdate,
                    onSelect: () => setDeleting(b),
                  },
                ]
              : []),
          ]}
        />
      ),
    })
  }

  const filtersActive = !!filters.location || !!filters.from || !!filters.to

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        One-off periods that add open time or block time (holidays, sick days) on top of recurring schedules.
        Times are shown in each location&apos;s time zone.
      </p>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <FilterBar onReset={resetFilters} canReset={filtersActive}>
          <div className="w-full sm:w-52">
            <EntityCombobox
              kind="location"
              size="sm"
              clearable
              placeholder="Any location"
              aria-label="Location filter"
              value={filters.location}
              onChange={(location) => setFilters({ location })}
            />
          </div>
          <label className="flex w-full items-center gap-2 text-sm text-muted-foreground sm:w-auto">
            <span className="w-10 shrink-0 sm:w-auto">From</span>
            <div className="min-w-0 flex-1 sm:w-52 sm:flex-none">
              <DateTimeInput
                size="sm"
                showZone={false}
                timeZone={filterZone}
                value={filters.from}
                onChange={(from) => setFilters({ from: from || null })}
              />
            </div>
          </label>
          <label className="flex w-full items-center gap-2 text-sm text-muted-foreground sm:w-auto">
            <span className="w-10 shrink-0 sm:w-auto">To</span>
            <div className="min-w-0 flex-1 sm:w-52 sm:flex-none">
              <DateTimeInput
                size="sm"
                showZone={false}
                timeZone={filterZone}
                value={filters.to}
                onChange={(to) => setFilters({ to: to || null })}
              />
            </div>
          </label>
          <SortSelect value={list.sort} onChange={list.setSort} options={SORT_OPTIONS} />
        </FilterBar>
        {can("schedules", "create") && (
          <Button size="sm" onClick={() => setDialog({})}>
            <PlusIcon /> New block
          </Button>
        )}
      </div>
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
        pagination={list.pagination}
        emptyTitle="No schedule blocks"
        emptyDescription={
          filtersActive
            ? "No schedule blocks match these filters."
            : "Add a block to open extra time or to block out time like holidays."
        }
        emptyAction={
          filtersActive || !can("schedules", "create") ? undefined : (
            <Button size="sm" variant="outline" onClick={() => setDialog({})}>
              <PlusIcon /> New block
            </Button>
          )
        }
      />
      {dialog && (
        <ScheduleBlockFormDialog
          resourceId={resource.id}
          block={dialog.block}
          defaultLocationId={filters.location}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete schedule block?"
        description={
          deleting
            ? `${deleting.is_available ? "Available" : "Blocked"} time at ${deleting.location?.name ?? "the location"} from ${formatDateTime(deleting.starts_at)} to ${formatDateTime(deleting.ends_at)} will be removed.`
            : undefined
        }
        confirmLabel="Delete block"
        destructive
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}
