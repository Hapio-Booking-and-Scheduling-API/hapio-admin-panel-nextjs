"use client"

import { CalendarCheckIcon, PencilIcon, PowerIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs"
import { EnabledBadge } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { CopyId } from "@/components/entity/copy-id"
import { DetailList } from "@/components/entity/detail-list"
import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { RawJsonCard } from "@/components/entity/raw-json-card"
import { SectionCard } from "@/components/entity/section-card"
import { DetailSkeleton } from "@/components/entity/skeletons"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime } from "@/lib/format/datetime"
import { omitKeys } from "@/lib/format/json"
import { hapio } from "@/lib/hapio/client"
import { indexById, useAllResources, useHapioMutation, useLocation } from "@/lib/hapio/hooks"
import type { Location, LocationInput } from "@/lib/hapio/types"

import { STRATEGY_LABELS } from "./constants"
import { LocationFormDialog } from "./location-form"

const READ_ONLY = ["id", "created_at", "updated_at"] as const

export function LocationDetail({ id }: { id: string }) {
  const router = useRouter()
  const query = useLocation(id)
  const resources = useAllResources()
  const [editing, setEditing] = useState(false)
  useBreadcrumbLabel(id, query.data?.name)

  const toggle = useHapioMutation(
    (location: Location) => hapio.locations.patch(location.id, { enabled: !location.enabled }),
    { success: (l) => (l.enabled ? "Location enabled" : "Location disabled") }
  )
  const remove = useHapioMutation(() => hapio.locations.delete(id), {
    success: "Location deleted",
    onSuccess: () => router.push("/locations"),
  })
  const replace = useHapioMutation((body: unknown) => hapio.locations.replace(id, body as LocationInput), {
    success: "Location replaced",
  })

  if (query.isLoading) return <DetailSkeleton />
  if (query.error || !query.data) return <ErrorAlert error={query.error} onRetry={() => query.refetch()} />

  const location = query.data
  const byId = indexById(resources.data)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={location.name}
        badges={<EnabledBadge enabled={location.enabled} />}
        description={<CopyId id={location.id} />}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/bookings?location=${location.id}`}>
                <CalendarCheckIcon /> Bookings
              </Link>
            </Button>
            <Button variant="outline" onClick={() => toggle.mutate(location)} disabled={toggle.isPending}>
              <PowerIcon /> {location.enabled ? "Disable" : "Enable"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
            <ConfirmDialog
              title={`Delete ${location.name}?`}
              description="This permanently deletes the location. Its bookings are kept but lose their location. Consider disabling it instead."
              confirmLabel="Delete location"
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
          <SectionCard title="Details">
            <DetailList
              items={[
                { label: "Time zone", value: location.time_zone },
                {
                  label: "Resource selection",
                  value: (
                    <>
                      <span className="font-medium">{STRATEGY_LABELS[location.resource_selection_strategy].label}</span>
                      <span className="block text-muted-foreground">
                        {STRATEGY_LABELS[location.resource_selection_strategy].description}
                      </span>
                    </>
                  ),
                },
                { label: "Created", value: formatDateTime(location.created_at, { withOffset: true }) },
                { label: "Updated", value: formatDateTime(location.updated_at, { withOffset: true }) },
                {
                  label: "Priority order",
                  wide: true,
                  hidden: location.resource_selection_strategy !== "prioritize",
                  value: location.resource_selection_priority?.length ? (
                    <ol className="list-decimal space-y-0.5 pl-5">
                      {location.resource_selection_priority.map((rid) => (
                        <li key={rid}>
                          <Link className="underline-offset-4 hover:underline" href={`/resources/${rid}`}>
                            {byId.get(rid)?.name ?? rid}
                          </Link>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    "No priority set; resources are ordered by ID."
                  ),
                },
              ]}
            />
          </SectionCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Metadata">
              <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {JSON.stringify(location.metadata, null, 2)}
              </pre>
            </SectionCard>
            <SectionCard
              title="Protected metadata"
              description={location.protected_metadata === undefined ? "Not returned: the token lacks location:protected_metadata." : undefined}
            >
              <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {JSON.stringify(location.protected_metadata ?? null, null, 2)}
              </pre>
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="json">
          <RawJsonCard
            value={location}
            toPutBody={(l) => omitKeys(l, READ_ONLY)}
            onReplace={(body) => replace.mutateAsync(body)}
          />
        </TabsContent>
      </Tabs>
      <LocationFormDialog open={editing} onOpenChange={setEditing} location={location} />
    </div>
  )
}
