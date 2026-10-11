"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CalendarCheckIcon, PencilIcon, PowerIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import { useState } from "react"

import { EnabledBadge } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { CopyId } from "@/components/entity/copy-id"
import { DetailList } from "@/components/entity/detail-list"
import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { RawJsonCard } from "@/components/entity/raw-json-card"
import { SectionCard } from "@/components/entity/section-card"
import { DetailSkeleton } from "@/components/entity/skeletons"
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime } from "@/lib/format/datetime"
import { omitKeys } from "@/lib/format/json"
import { hapio } from "@/lib/hapio/client"
import { hapioKey, useHapioMutation, useResource } from "@/lib/hapio/hooks"
import type { Resource, ResourceInput } from "@/lib/hapio/types"

import { AvailabilityTab } from "./availability-tab"
import { DELETE_RESOURCE_WARNING, RESOURCE_TABS, type ResourceTab } from "./constants"
import { RecurringSchedulesTab } from "./recurring-schedules-tab"
import { ResourceFormDialog } from "./resource-form"
import { ResourceServicesTab } from "./resource-services"
import { ScheduleBlocksTab } from "./schedule-blocks-tab"
import { formatMaxSimultaneous } from "./utils"

const READ_ONLY = ["id", "created_at", "updated_at"] as const

const TAB_LABELS: Record<ResourceTab, string> = {
  overview: "Overview",
  services: "Services",
  blocks: "Schedule blocks",
  recurring: "Recurring schedules",
  availability: "Availability",
  json: "JSON",
}

export function ResourceDetail({ id }: { id: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const query = useResource(id)
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(RESOURCE_TABS).withDefault("overview").withOptions({ history: "replace" })
  )
  useBreadcrumbLabel(id, query.data?.name)

  const toggle = useHapioMutation(
    (resource: Resource) => hapio.resources.patch(resource.id, { enabled: !resource.enabled }),
    { success: (r) => (r.enabled ? "Resource enabled" : "Resource disabled") }
  )
  const remove = useHapioMutation(() => hapio.resources.delete(id), {
    success: "Resource deleted",
    onSuccess: () => {
      router.push("/resources")
      // Drop the deleted resource so the refresh after the mutation doesn't refetch it (404).
      queryClient.removeQueries({ queryKey: hapioKey("resources", "detail", id) })
    },
  })
  const replace = useHapioMutation((body: unknown) => hapio.resources.replace(id, body as ResourceInput), {
    success: "Resource replaced",
    // The Replace dialog shows the error inline.
    toastErrors: false,
  })

  // Keep showing the resource while we have it, even if a later refetch failed.
  if (!query.data) {
    return query.error ? <ErrorAlert error={query.error} onRetry={() => query.refetch()} /> : <DetailSkeleton />
  }

  const resource = query.data
  const navigate = (next: ResourceTab) => void setTab(next)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={resource.name}
        badges={<EnabledBadge enabled={resource.enabled} />}
        description={<CopyId id={resource.id} />}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/bookings?resource=${resource.id}`}>
                <CalendarCheckIcon /> Bookings
              </Link>
            </Button>
            <Button variant="outline" onClick={() => toggle.mutate(resource)} disabled={toggle.isPending}>
              <PowerIcon /> {resource.enabled ? "Disable" : "Enable"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </Button>
            <ConfirmDialog
              title={`Delete ${resource.name}?`}
              description={DELETE_RESOURCE_WARNING}
              confirmLabel="Delete resource"
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
      <Tabs value={tab} onValueChange={(value) => navigate(value as ResourceTab)}>
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          <TabsList>
            {RESOURCE_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {TAB_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview" className="flex flex-col gap-4">
          <SectionCard title="Details">
            <DetailList
              items={[
                {
                  label: "Max simultaneous bookings",
                  value: (
                    <>
                      <span className="font-medium">{formatMaxSimultaneous(resource.max_simultaneous_bookings)}</span>
                      <span className="block text-muted-foreground">
                        {resource.max_simultaneous_bookings === null
                          ? "Any number of bookings can overlap."
                          : resource.max_simultaneous_bookings === 1
                            ? "One booking at a time."
                            : `Up to ${resource.max_simultaneous_bookings} overlapping bookings.`}
                      </span>
                    </>
                  ),
                },
                { label: "Created", value: formatDateTime(resource.created_at, { withOffset: true }) },
                { label: "Updated", value: formatDateTime(resource.updated_at, { withOffset: true }) },
              ]}
            />
          </SectionCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Metadata">
              <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {JSON.stringify(resource.metadata, null, 2)}
              </pre>
            </SectionCard>
            <SectionCard
              title="Protected metadata"
              description={
                resource.protected_metadata === undefined
                  ? "Not returned: the token lacks resource:protected_metadata."
                  : undefined
              }
            >
              <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {JSON.stringify(resource.protected_metadata ?? null, null, 2)}
              </pre>
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="services">
          <ResourceServicesTab resource={resource} />
        </TabsContent>
        <TabsContent value="blocks">
          <ScheduleBlocksTab resource={resource} />
        </TabsContent>
        <TabsContent value="recurring">
          <RecurringSchedulesTab resource={resource} />
        </TabsContent>
        <TabsContent value="availability">
          <AvailabilityTab resource={resource} onNavigate={navigate} />
        </TabsContent>
        <TabsContent value="json">
          <RawJsonCard
            value={resource}
            toPutBody={(r) => omitKeys(r, READ_ONLY)}
            onReplace={(body) => replace.mutateAsync(body)}
          />
        </TabsContent>
      </Tabs>
      <ResourceFormDialog open={editing} onOpenChange={setEditing} resource={resource} />
    </div>
  )
}
