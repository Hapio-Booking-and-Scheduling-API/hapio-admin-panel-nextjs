"use client"

import type { UseQueryResult } from "@tanstack/react-query"
import { Link2Icon, UnlinkIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { DataTable, type Column } from "@/components/data-table/data-table"
import { EnabledBadge } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { SectionCard } from "@/components/entity/section-card"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { formatDateTime } from "@/lib/format/datetime"
import { hapio } from "@/lib/hapio/client"
import { indexById, useAllResources, useHapioMutation } from "@/lib/hapio/hooks"
import type { ResourceService } from "@/lib/hapio/types"

export function ServiceResourcesTab({
  serviceId,
  query,
}: {
  serviceId: string
  query: UseQueryResult<ResourceService[]>
}) {
  const resources = useAllResources()
  const byId = indexById(resources.data)
  const [selected, setSelected] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ResourceService | null>(null)

  const nameOf = (resourceId: string) => byId.get(resourceId)?.name ?? `${resourceId.slice(0, 8)}…`

  const associate = useHapioMutation(
    (resourceId: string) => hapio.services.resources.associate(serviceId, resourceId),
    {
      success: (_, resourceId) => `${nameOf(resourceId)} can now deliver this service`,
      onSuccess: () => setSelected(null),
    }
  )
  const dissociate = useHapioMutation(
    (resourceId: string) => hapio.services.resources.dissociate(serviceId, resourceId),
    { success: (_, resourceId) => `${nameOf(resourceId)} removed from this service` }
  )

  const associated = [...(query.data ?? [])].sort((a, b) => nameOf(a.resource_id).localeCompare(nameOf(b.resource_id)))
  const associatedIds = associated.map((a) => a.resource_id)

  const columns: Column<ResourceService>[] = [
    {
      id: "name",
      header: "Resource",
      cell: (a) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/resources/${a.resource_id}`}>
          {nameOf(a.resource_id)}
        </Link>
      ),
    },
    {
      id: "enabled",
      header: "Status",
      cell: (a) => {
        const resource = byId.get(a.resource_id)
        return resource ? <EnabledBadge enabled={resource.enabled} /> : <span className="text-muted-foreground">—</span>
      },
    },
    {
      id: "created_at",
      header: "Associated",
      className: "hidden sm:table-cell",
      cell: (a) => formatDateTime(a.created_at),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-10 text-right",
      cell: (a) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${nameOf(a.resource_id)} from this service`}
          onClick={() => setRemoving(a)}
        >
          <UnlinkIcon />
        </Button>
      ),
    },
  ]

  return (
    <SectionCard
      title="Resources"
      description="The people, rooms or equipment that can deliver this service. Bookable slots only include associated resources."
    >
      <div className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (selected) associate.mutate(selected)
          }}
        >
          <div className="w-full sm:w-72">
            <EntityCombobox
              kind="resource"
              value={selected}
              onChange={setSelected}
              exclude={associatedIds}
              placeholder="Select a resource to associate…"
              aria-label="Resource to associate"
            />
          </div>
          <Button type="submit" disabled={!selected || associate.isPending} aria-busy={associate.isPending}>
            {associate.isPending ? <Spinner aria-hidden /> : <Link2Icon />} Associate resource
          </Button>
        </form>
        <DataTable
          columns={columns}
          data={query.data ? associated : undefined}
          getRowId={(a) => a.resource_id}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          emptyTitle="No resources yet"
          emptyDescription="Associate at least one resource. Without one, this service has no bookable slots."
        />
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? nameOf(removing.resource_id) : "resource"} from this service?`}
        description="The resource will no longer be offered for new bookings of this service. The resource itself and existing bookings are not deleted."
        confirmLabel="Remove"
        destructive
        onConfirm={() => dissociate.mutateAsync(removing!.resource_id)}
      />
    </SectionCard>
  )
}
