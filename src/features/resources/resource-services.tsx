"use client"

import { Link2OffIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { EnabledBadge } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { can } from "@/lib/admin-config"
import { formatDateTime } from "@/lib/format/datetime"
import { hapio } from "@/lib/hapio/client"
import { indexById, useAllServices, useHapioMutation } from "@/lib/hapio/hooks"
import type { Resource, ResourceService } from "@/lib/hapio/types"

import { useResourceServices } from "./queries"
import { SERVICE_TYPE_LABELS } from "./utils"

export function ResourceServicesTab({ resource }: { resource: Resource }) {
  const query = useResourceServices(resource.id)
  const services = useAllServices()
  const byId = indexById(services.data)
  const [removing, setRemoving] = useState<ResourceService | null>(null)

  const nameOf = (serviceId: string) => byId.get(serviceId)?.name ?? "service"

  const associate = useHapioMutation(
    (serviceId: string) => hapio.resources.services.associate(resource.id, serviceId),
    { success: (_, serviceId) => `${nameOf(serviceId)} associated` }
  )
  const dissociate = useHapioMutation(
    (serviceId: string) => hapio.resources.services.dissociate(resource.id, serviceId),
    { success: (_, serviceId) => `${nameOf(serviceId)} removed` }
  )

  const associatedIds = (query.data ?? []).map((a) => a.service_id)

  const canChange = can("services", "update")

  const columns: Column<ResourceService>[] = [
    {
      id: "service",
      header: "Service",
      cell: (a) => {
        const service = byId.get(a.service_id)
        if (!service && services.isLoading) return <Skeleton className="h-4 w-32" />
        return (
          <Link href={`/services/${a.service_id}`} className="font-medium underline-offset-4 hover:underline">
            {service?.name ?? <span className="font-mono text-xs">{a.service_id}</span>}
          </Link>
        )
      },
    },
    {
      id: "type",
      header: "Type",
      className: "hidden sm:table-cell",
      cell: (a) => {
        const service = byId.get(a.service_id)
        return service ? <Badge variant="outline">{SERVICE_TYPE_LABELS[service.type]}</Badge> : "—"
      },
    },
    {
      id: "status",
      header: "Status",
      className: "hidden md:table-cell",
      cell: (a) => {
        const service = byId.get(a.service_id)
        return service ? <EnabledBadge enabled={service.enabled} /> : "—"
      },
    },
    {
      id: "created_at",
      header: "Associated",
      className: "hidden md:table-cell",
      cell: (a) => formatDateTime(a.created_at),
    },
    ...(canChange
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            className: "w-10 text-right",
            cell: (a: ResourceService) => (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${nameOf(a.service_id)}`}
                title="Remove association"
                onClick={() => setRemoving(a)}
              >
                <Link2OffIcon />
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Services this resource can be booked for. A booking needs a service the resource is associated with.
        </p>
        {canChange && (
          <div className="w-full sm:w-64">
            <EntityCombobox
              kind="service"
              size="sm"
              value={null}
              exclude={associatedIds}
              placeholder={associate.isPending ? "Associating…" : "Associate service…"}
              aria-label="Service to associate"
              disabled={associate.isPending || query.isLoading}
              onChange={(serviceId) => serviceId && associate.mutate(serviceId)}
            />
          </div>
        )}
      </div>
      <DataTable
        columns={columns}
        data={query.data}
        getRowId={(a) => a.service_id}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyTitle="No services"
        emptyDescription="Associate a service so this resource can be booked for it."
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? nameOf(removing.service_id) : "service"}?`}
        description="The resource can no longer be booked for this service."
        confirmLabel="Remove"
        destructive
        onConfirm={() => dissociate.mutateAsync(removing!.service_id)}
      />
    </div>
  )
}
