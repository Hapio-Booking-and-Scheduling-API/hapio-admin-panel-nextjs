"use client"

import { PencilIcon, PlusIcon, PowerIcon, Trash2Icon } from "lucide-react"
import { parseAsStringLiteral } from "nuqs"
import { useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { useListFilters, useListState } from "@/components/data-table/use-list-state"
import { EnabledBadge } from "@/components/entity/badges"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { can } from "@/lib/admin-config"
import { formatDateTime } from "@/lib/format/datetime"
import { hapio } from "@/lib/hapio/client"
import { useHapioMutation, useServices } from "@/lib/hapio/hooks"
import { SERVICE_TYPES, type Service, type ServiceType } from "@/lib/hapio/types"

import { ServiceFormDialog } from "./service-form"
import { ServiceTypeBadge } from "./service-type-badge"
import { serviceTypeLabel, servicePriceLabel, summarizeServiceLength } from "./utils"

const FILTER_FIELDS: FilterFieldDef[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "price", label: "Price", type: "price" },
  ...TIMESTAMP_FILTER_FIELDS,
  ...METADATA_FILTER_FIELDS,
]

export function ServicesPage() {
  const list = useListState()
  const [filters, setFilters, resetFilters] = useListFilters({
    disabled: parseAsStringLiteral(["exclude", "include", "only"] as const).withDefault("include"),
    type: parseAsStringLiteral(SERVICE_TYPES),
    f: parseAsFilterRows,
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [deleting, setDeleting] = useState<Service | null>(null)

  const query = useServices({
    page: list.page,
    per_page: list.perPage,
    sort: list.sort || undefined,
    disabled: filters.disabled,
    type: filters.type ?? undefined,
    ...rowsToParams(filters.f, FILTER_FIELDS),
  })

  const toggle = useHapioMutation(
    (service: Service) => hapio.services.patch(service.id, { enabled: !service.enabled }),
    { success: (s) => (s.enabled ? "Service enabled" : "Service disabled") }
  )
  const remove = useHapioMutation((id: string) => hapio.services.delete(id), {
    success: "Service deleted",
  })

  const columns: Column<Service>[] = [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      cell: (s) => <span className="font-medium">{s.name}</span>,
    },
    { id: "type", header: "Type", cell: (s) => <ServiceTypeBadge type={s.type} /> },
    {
      id: "length",
      header: "Length",
      className: "hidden md:table-cell",
      cell: (s) => <span className="text-muted-foreground">{summarizeServiceLength(s)}</span>,
    },
    {
      id: "price",
      header: "Price",
      className: "hidden sm:table-cell tabular-nums",
      cell: (s) => servicePriceLabel(s),
    },
    { id: "enabled", header: "Status", cell: (s) => <EnabledBadge enabled={s.enabled} /> },
    {
      id: "created_at",
      header: "Created",
      sortKey: "created_at",
      className: "hidden lg:table-cell",
      cell: (s) => formatDateTime(s.created_at),
    },
  ]
  const canUpdate = can("services", "update")
  const canDelete = can("services", "delete")
  if (canUpdate || canDelete) {
    columns.push({
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-10 text-right",
      cell: (s) => (
        <RowActions
          label={`Actions for ${s.name}`}
          actions={[
            ...(canUpdate
              ? [
                  { label: "Edit", icon: <PencilIcon />, onSelect: () => setEditing(s) },
                  {
                    label: s.enabled ? "Disable" : "Enable",
                    icon: <PowerIcon />,
                    onSelect: () => toggle.mutate(s),
                  },
                ]
              : []),
            ...(canDelete
              ? [
                  {
                    label: "Delete",
                    icon: <Trash2Icon />,
                    destructive: true,
                    separatorBefore: canUpdate,
                    onSelect: () => setDeleting(s),
                  },
                ]
              : []),
          ]}
        />
      ),
    })
  }

  const filtersActive = filters.disabled !== "include" || !!filters.type || !!filters.f?.length

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Services"
        description="What customers book: fixed appointments, flexible-length sessions or multi-day rentals."
        actions={
          can("services", "create") && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> New service
            </Button>
          )
        }
      />
      <FilterBar onReset={resetFilters} canReset={filtersActive}>
        <TriStateFilter noun="disabled" value={filters.disabled} onChange={(disabled) => setFilters({ disabled })} />
        <Select
          value={filters.type ?? "any"}
          onValueChange={(v) => setFilters({ type: v === "any" ? null : (v as ServiceType) })}
        >
          <SelectTrigger size="sm" className="w-auto" aria-label="Service type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any type</SelectItem>
            {SERVICE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {serviceTypeLabel(t)}
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
        getRowId={(s) => s.id}
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
        rowHref={(s) => `/services/${s.id}`}
        emptyTitle="No services"
        emptyDescription={
          filtersActive ? "No services match these filters." : "Create your first service to start taking bookings."
        }
        emptyAction={
          filtersActive ? (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Reset filters
            </Button>
          ) : (
            can("services", "create") && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <PlusIcon /> New service
              </Button>
            )
          )
        }
      />
      <ServiceFormDialog open={creating} onOpenChange={setCreating} />
      {editing && <ServiceFormDialog open onOpenChange={(open) => !open && setEditing(null)} service={editing} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "service"}?`}
        description="This permanently deletes the service and its resource associations. Its bookings are kept but lose their service. To keep history intact, consider disabling it instead."
        confirmLabel="Delete service"
        destructive
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}
