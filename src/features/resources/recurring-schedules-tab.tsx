"use client"

import { CalendarSyncIcon, ChevronRightIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { parseAsString } from "nuqs"
import { useState } from "react"
import { cn } from "cn"

import { DataTablePagination, useClampToLastPage } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { ErrorAlert } from "@/components/entity/error-alert"
import { RowActions } from "@/components/entity/row-actions"
import { FilterBar } from "@/components/filters/filter-bar"
import { SortSelect, sortOptions } from "@/components/filters/sort-select"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { hapio } from "@/lib/hapio/client"
import { useHapioMutation } from "@/lib/hapio/hooks"
import type { RecurringSchedule, Resource } from "@/lib/hapio/types"

import { useRecurringSchedules } from "./queries"
import { RecurringScheduleBlocks } from "./recurring-schedule-blocks"
import { RecurringScheduleFormDialog } from "./recurring-schedule-form"
import { dateRange } from "./recurring-schedules-model"
import { usePrefixedFilters, usePrefixedListState } from "./use-tab-state"
import { intervalLabel, recurringScheduleStatus, type ScheduleStatus } from "./utils"

const SORT_OPTIONS = sortOptions([
  ["start_date", "Start date"],
  ["end_date", "End date"],
  ["created_at", "Created"],
  ["updated_at", "Updated"],
])

const FILTERS = { location: parseAsString, from: parseAsString, to: parseAsString }

const STATUS: Record<ScheduleStatus, { label: string; className?: string; variant: "outline" | "secondary" }> = {
  active: {
    label: "Active",
    variant: "outline",
    className: "border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
  },
  upcoming: { label: "Upcoming", variant: "outline", className: "border-sky-500/30 text-sky-700 dark:text-sky-400" },
  ended: { label: "Ended", variant: "secondary" },
}

export function RecurringSchedulesTab({ resource }: { resource: Resource }) {
  const list = usePrefixedListState("rs")
  const [filters, setFilters, resetFilters] = usePrefixedFilters("rs", FILTERS)
  const [dialog, setDialog] = useState<{ schedule?: RecurringSchedule } | null>(null)
  const [deleting, setDeleting] = useState<RecurringSchedule | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const query = useRecurringSchedules(resource.id, {
    page: list.page,
    per_page: list.perPage,
    sort: list.sort || undefined,
    location: filters.location ?? undefined,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
  })

  const remove = useHapioMutation((id: string) => hapio.recurringSchedules(resource.id).delete(id), {
    success: "Recurring schedule deleted",
  })
  // Deleting the only schedule on the last page leaves it empty: go back a page.
  useClampToLastPage(list.pagination, query.data?.meta)

  const items = query.data?.data
  // An empty page of a non-empty list is past the end and about to move back (see above).
  const awaitingItems = !!query.data && query.data.meta.total > 0 && query.data.data.length === 0
  // A lone schedule starts expanded; otherwise rows open on demand.
  const isOpen = (id: string) => expanded[id] ?? items?.length === 1
  const filtersActive = !!filters.location || !!filters.from || !!filters.to

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Weekly opening hours at a location over a date range. Overlapping schedules all apply; schedule blocks
        can add or remove time on specific dates.
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
          <label
            className="flex w-full items-center gap-2 text-sm text-muted-foreground sm:w-auto"
            title="Schedules that end on or after this date"
          >
            <span className="w-10 shrink-0 sm:w-auto">From</span>
            <Input
              type="date"
              className="h-7 min-w-0 flex-1 sm:w-38 sm:flex-none"
              value={filters.from ?? ""}
              onChange={(e) => setFilters({ from: e.target.value || null })}
            />
          </label>
          <label
            className="flex w-full items-center gap-2 text-sm text-muted-foreground sm:w-auto"
            title="Schedules that start on or before this date"
          >
            <span className="w-10 shrink-0 sm:w-auto">To</span>
            <Input
              type="date"
              className="h-7 min-w-0 flex-1 sm:w-38 sm:flex-none"
              value={filters.to ?? ""}
              onChange={(e) => setFilters({ to: e.target.value || null })}
            />
          </label>
          <SortSelect value={list.sort} onChange={list.setSort} options={SORT_OPTIONS} />
        </FilterBar>
        <Button size="sm" onClick={() => setDialog({})}>
          <PlusIcon /> New schedule
        </Button>
      </div>

      {(query.isLoading && !items) || awaitingItems ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : query.error && !items ? (
        <ErrorAlert error={query.error} onRetry={() => query.refetch()} />
      ) : !items?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarSyncIcon />
            </EmptyMedia>
            <EmptyTitle>No recurring schedules</EmptyTitle>
            <EmptyDescription>
              {filtersActive
                ? "No recurring schedules match these filters."
                : "Create a recurring schedule to set this resource's weekly hours at a location."}
            </EmptyDescription>
          </EmptyHeader>
          {!filtersActive && (
            <EmptyContent>
              <Button size="sm" variant="outline" onClick={() => setDialog({})}>
                <PlusIcon /> New schedule
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className={cn("flex flex-col gap-3 transition-opacity", query.isFetching && "opacity-70")}>
          {items.map((schedule) => {
            const status = STATUS[recurringScheduleStatus(schedule)]
            const open = isOpen(schedule.id)
            return (
              <Collapsible
                key={schedule.id}
                open={open}
                onOpenChange={(next) => setExpanded((prev) => ({ ...prev, [schedule.id]: next }))}
                className="rounded-xl border bg-card"
              >
                <div className="flex items-start gap-1 p-2">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-lg p-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <ChevronRightIcon
                        className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{schedule.location?.name ?? "Unknown location"}</span>
                          <Badge variant={status.variant} className={status.className}>
                            {status.label}
                          </Badge>
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {dateRange(schedule)} · {intervalLabel(schedule.interval)}
                          <span className="hidden sm:inline"> · {schedule.location?.time_zone}</span>
                        </span>
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <RowActions
                    label={`Actions for schedule at ${schedule.location?.name ?? "unknown location"}, ${dateRange(schedule)}`}
                    actions={[
                      { label: "Edit", icon: <PencilIcon />, onSelect: () => setDialog({ schedule }) },
                      {
                        label: "Delete",
                        icon: <Trash2Icon />,
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () => setDeleting(schedule),
                      },
                    ]}
                  />
                </div>
                <CollapsibleContent className="border-t p-3 sm:p-4">
                  <RecurringScheduleBlocks resourceId={resource.id} schedule={schedule} />
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      )}
      {query.data?.meta && items && items.length > 0 && (
        <DataTablePagination meta={query.data.meta} pagination={list.pagination} />
      )}

      {dialog && (
        <RecurringScheduleFormDialog
          resourceId={resource.id}
          schedule={dialog.schedule}
          defaultLocationId={filters.location}
          onClose={() => setDialog(null)}
          onCreated={(created) => setExpanded((prev) => ({ ...prev, [created.id]: true }))}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete recurring schedule?"
        description={
          deleting
            ? `The schedule at ${deleting.location?.name ?? "this location"} (${dateRange(deleting)}) and all of its weekday blocks are permanently deleted.`
            : undefined
        }
        confirmLabel="Delete schedule"
        destructive
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}
