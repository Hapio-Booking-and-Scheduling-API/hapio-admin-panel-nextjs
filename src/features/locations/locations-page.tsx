"use client"

import { PencilIcon, PlusIcon, PowerIcon, Trash2Icon } from "lucide-react"
import { parseAsString, parseAsStringLiteral } from "nuqs"
import { useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { useListFilters, useListState } from "@/components/data-table/use-list-state"
import {
  AdvancedFilters,
  METADATA_FILTER_FIELDS,
  TIMESTAMP_FILTER_FIELDS,
  parseAsFilterRows,
  rowsToParams,
  type FilterFieldDef,
} from "@/components/filters/advanced-filters"
import { FilterBar } from "@/components/filters/filter-bar"
import { TriStateFilter } from "@/components/filters/tri-state-filter"
import { EnabledBadge, MetadataPreview } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { PageHeader } from "@/components/entity/page-header"
import { RowActions } from "@/components/entity/row-actions"
import { TimezoneCombobox } from "@/components/inputs/timezone-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDateTime } from "@/lib/format/datetime"
import { hapio } from "@/lib/hapio/client"
import { useHapioMutation, useLocations } from "@/lib/hapio/hooks"
import { RESOURCE_SELECTION_STRATEGIES, type Location } from "@/lib/hapio/types"

import { STRATEGY_LABELS } from "./constants"
import { LocationFormDialog } from "./location-form"

const FILTER_FIELDS: FilterFieldDef[] = [
  { key: "name", label: "Name", type: "text" },
  ...TIMESTAMP_FILTER_FIELDS,
  ...METADATA_FILTER_FIELDS,
]

export function LocationsPage() {
  const list = useListState()
  const [filters, setFilters, resetFilters] = useListFilters({
    disabled: parseAsStringLiteral(["exclude", "include", "only"] as const).withDefault("include"),
    timezone: parseAsString,
    strategy: parseAsStringLiteral(RESOURCE_SELECTION_STRATEGIES),
    f: parseAsFilterRows,
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Location | null>(null)
  const [deleting, setDeleting] = useState<Location | null>(null)

  const query = useLocations({
    page: list.page,
    per_page: list.perPage,
    sort: list.sort || undefined,
    disabled: filters.disabled,
    timezone: filters.timezone ?? undefined,
    resource_selection_strategy: filters.strategy ?? undefined,
    ...rowsToParams(filters.f, FILTER_FIELDS),
  })

  const toggle = useHapioMutation(
    (location: Location) => hapio.locations.patch(location.id, { enabled: !location.enabled }),
    { success: (l) => (l.enabled ? "Location enabled" : "Location disabled") }
  )
  const remove = useHapioMutation((id: string) => hapio.locations.delete(id), {
    success: "Location deleted",
  })

  const columns: Column<Location>[] = [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      cell: (l) => <span className="font-medium">{l.name}</span>,
    },
    { id: "time_zone", header: "Time zone", cell: (l) => l.time_zone },
    {
      id: "strategy",
      header: "Selection",
      className: "hidden md:table-cell",
      cell: (l) => <Badge variant="outline">{STRATEGY_LABELS[l.resource_selection_strategy].label}</Badge>,
    },
    { id: "enabled", header: "Status", cell: (l) => <EnabledBadge enabled={l.enabled} /> },
    {
      id: "metadata",
      header: "Metadata",
      className: "hidden lg:table-cell",
      cell: (l) => <MetadataPreview value={l.metadata} />,
    },
    {
      id: "created_at",
      header: "Created",
      sortKey: "created_at",
      className: "hidden lg:table-cell",
      cell: (l) => formatDateTime(l.created_at),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-10 text-right",
      cell: (l) => (
        <RowActions
          actions={[
            { label: "Edit", icon: <PencilIcon />, onSelect: () => setEditing(l) },
            {
              label: l.enabled ? "Disable" : "Enable",
              icon: <PowerIcon />,
              onSelect: () => toggle.mutate(l),
            },
            {
              label: "Delete",
              icon: <Trash2Icon />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setDeleting(l),
            },
          ]}
        />
      ),
    },
  ]

  const filtersActive =
    filters.disabled !== "include" || !!filters.timezone || !!filters.strategy || !!filters.f?.length

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Locations"
        description="Places where resources are scheduled and bookings happen."
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> New location
          </Button>
        }
      />
      <FilterBar onReset={resetFilters} canReset={filtersActive}>
        <TriStateFilter noun="disabled" value={filters.disabled} onChange={(disabled) => setFilters({ disabled })} />
        <div className="w-56">
          <TimezoneCombobox
            size="sm"
            clearable
            placeholder="Any time zone"
            value={filters.timezone}
            onChange={(timezone) => setFilters({ timezone })}
          />
        </div>
        <Select
          value={filters.strategy ?? "any"}
          onValueChange={(v) => setFilters({ strategy: v === "any" ? null : (v as Location["resource_selection_strategy"]) })}
        >
          <SelectTrigger size="sm" className="w-auto" aria-label="Selection strategy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any strategy</SelectItem>
            {RESOURCE_SELECTION_STRATEGIES.map((s) => (
              <SelectItem key={s} value={s}>
                {STRATEGY_LABELS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AdvancedFilters fields={FILTER_FIELDS} value={filters.f} onChange={(f) => setFilters({ f })} />
      </FilterBar>
      <DataTable
        columns={columns}
        data={query.data?.data}
        meta={query.data?.meta}
        getRowId={(l) => l.id}
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
        rowHref={(l) => `/locations/${l.id}`}
        emptyTitle="No locations"
        emptyDescription={filtersActive ? "No locations match these filters." : "Create your first location to get started."}
      />
      <LocationFormDialog open={creating} onOpenChange={setCreating} />
      {editing && (
        <LocationFormDialog open onOpenChange={(open) => !open && setEditing(null)} location={editing} />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "location"}?`}
        description="This permanently deletes the location. Its bookings are kept but lose their location. To keep history intact, consider disabling it instead."
        confirmLabel="Delete location"
        destructive
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}
