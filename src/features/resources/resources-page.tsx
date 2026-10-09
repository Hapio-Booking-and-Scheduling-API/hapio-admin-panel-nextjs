"use client"

import { PencilIcon, PlusIcon, PowerIcon, Trash2Icon } from "lucide-react"
import { parseAsStringLiteral } from "nuqs"
import { useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { useListFilters, useListState } from "@/components/data-table/use-list-state"
import { EnabledBadge, MetadataPreview } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { PageHeader } from "@/components/entity/page-header"
import { RowActions } from "@/components/entity/row-actions"
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
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format/datetime"
import { hapio, type ResourceListParams } from "@/lib/hapio/client"
import { useHapioMutation, useResources } from "@/lib/hapio/hooks"
import type { Resource } from "@/lib/hapio/types"

import { DELETE_RESOURCE_WARNING } from "./constants"
import { ResourceFormDialog } from "./resource-form"

const FILTER_FIELDS: FilterFieldDef[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "max_simultaneous_bookings", label: "Max simultaneous", type: "number" },
  ...TIMESTAMP_FILTER_FIELDS,
  ...METADATA_FILTER_FIELDS,
]

export function ResourcesPage() {
  const list = useListState()
  const [filters, setFilters, resetFilters] = useListFilters({
    disabled: parseAsStringLiteral(["exclude", "include", "only"] as const).withDefault("include"),
    f: parseAsFilterRows,
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Resource | null>(null)
  const [deleting, setDeleting] = useState<Resource | null>(null)

  const query = useResources({
    page: list.page,
    per_page: list.perPage,
    sort: list.sort || undefined,
    disabled: filters.disabled,
    ...(rowsToParams(filters.f, FILTER_FIELDS) as Partial<ResourceListParams>),
  })

  const toggle = useHapioMutation(
    (resource: Resource) => hapio.resources.patch(resource.id, { enabled: !resource.enabled }),
    { success: (r) => (r.enabled ? "Resource enabled" : "Resource disabled") }
  )
  const remove = useHapioMutation((id: string) => hapio.resources.delete(id), {
    success: "Resource deleted",
  })

  const columns: Column<Resource>[] = [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      id: "max",
      header: "Max simultaneous",
      className: "hidden sm:table-cell",
      cell: (r) =>
        r.max_simultaneous_bookings === null ? (
          <span className="text-muted-foreground">Unlimited</span>
        ) : (
          <span className="tabular-nums">{r.max_simultaneous_bookings}</span>
        ),
    },
    { id: "enabled", header: "Status", cell: (r) => <EnabledBadge enabled={r.enabled} /> },
    {
      id: "metadata",
      header: "Metadata",
      className: "hidden lg:table-cell",
      cell: (r) => <MetadataPreview value={r.metadata} />,
    },
    {
      id: "created_at",
      header: "Created",
      sortKey: "created_at",
      className: "hidden md:table-cell",
      cell: (r) => formatDateTime(r.created_at),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-10 text-right",
      cell: (r) => (
        <RowActions
          actions={[
            { label: "Edit", icon: <PencilIcon />, onSelect: () => setEditing(r) },
            {
              label: r.enabled ? "Disable" : "Enable",
              icon: <PowerIcon />,
              onSelect: () => toggle.mutate(r),
            },
            {
              label: "Delete",
              icon: <Trash2Icon />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setDeleting(r),
            },
          ]}
        />
      ),
    },
  ]

  const filtersActive = filters.disabled !== "include" || !!filters.f?.length

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Resources"
        description="People, rooms or equipment that can be booked, with their schedules."
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> New resource
          </Button>
        }
      />
      <FilterBar onReset={resetFilters} canReset={filtersActive}>
        <TriStateFilter noun="disabled" value={filters.disabled} onChange={(disabled) => setFilters({ disabled })} />
        <AdvancedFilters fields={FILTER_FIELDS} value={filters.f} onChange={(f) => setFilters({ f })} />
      </FilterBar>
      <DataTable
        columns={columns}
        data={query.data?.data}
        meta={query.data?.meta}
        getRowId={(r) => r.id}
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
        rowHref={(r) => `/resources/${r.id}`}
        emptyTitle="No resources"
        emptyDescription={
          filtersActive ? "No resources match these filters." : "Create your first resource to start scheduling."
        }
        emptyAction={
          filtersActive ? undefined : (
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon /> New resource
            </Button>
          )
        }
      />
      <ResourceFormDialog open={creating} onOpenChange={setCreating} />
      {editing && (
        <ResourceFormDialog open onOpenChange={(open) => !open && setEditing(null)} resource={editing} />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "resource"}?`}
        description={DELETE_RESOURCE_WARNING}
        confirmLabel="Delete resource"
        destructive
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}
