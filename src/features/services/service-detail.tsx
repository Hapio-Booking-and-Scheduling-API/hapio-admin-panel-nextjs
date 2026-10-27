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
import { DetailList, type DetailItem } from "@/components/entity/detail-list"
import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { RawJsonCard } from "@/components/entity/raw-json-card"
import { SectionCard } from "@/components/entity/section-card"
import { DetailSkeleton } from "@/components/entity/skeletons"
import { WEEKDAY_LABELS } from "@/components/inputs/weekday-select"
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { can } from "@/lib/admin-config"
import { formatDateTime, shortTime } from "@/lib/format/datetime"
import { humanizeDuration, isZeroDuration, parseDuration } from "@/lib/format/duration"
import { omitKeys } from "@/lib/format/json"
import { formatPrice } from "@/lib/format/price"
import { hapio } from "@/lib/hapio/client"
import { hapioKey, useHapioMutation, useService } from "@/lib/hapio/hooks"
import { WEEKDAYS, type DayTime, type Service, type ServiceInput } from "@/lib/hapio/types"

import { BookableSlotsExplorer } from "./bookable-slots"
import { useServiceResources } from "./hooks"
import { ServiceFormDialog } from "./service-form"
import { ServiceResourcesTab } from "./service-resources"
import { ServiceTypeBadge } from "./service-type-badge"
import { SERVICE_TYPE_INFO, dayTimeFor, isPerWeekday, pluralDays, summarizeDayTime } from "./utils"

const READ_ONLY = ["id", "created_at", "updated_at"] as const
const TABS = ["overview", "resources", "slots", "json"] as const
type Tab = (typeof TABS)[number]

export function ServiceDetail({ id }: { id: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const query = useService(id)
  const resources = useServiceResources(id)
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TABS).withDefault("overview").withOptions({ history: "replace" })
  )
  useBreadcrumbLabel(id, query.data?.name)

  const toggle = useHapioMutation(
    (service: Service) => hapio.services.patch(service.id, { enabled: !service.enabled }),
    { success: (s) => (s.enabled ? "Service enabled" : "Service disabled") }
  )
  const remove = useHapioMutation(() => hapio.services.delete(id), {
    success: "Service deleted",
    onSuccess: () => {
      router.push("/services")
      // Drop the deleted service (and its resources and slots) so the refresh after the
      // mutation doesn't refetch it (404).
      queryClient.removeQueries({ queryKey: hapioKey("services", "detail", id) })
      queryClient.removeQueries({ queryKey: hapioKey("services", id) })
    },
  })
  const replace = useHapioMutation((body: unknown) => hapio.services.replace(id, body as ServiceInput), {
    success: "Service replaced",
    // The Replace dialog shows the error inline.
    toastErrors: false,
  })

  // Keep showing the service while we have it, even if a later refetch failed.
  if (!query.data) {
    return query.error ? <ErrorAlert error={query.error} onRetry={() => query.refetch()} /> : <DetailSkeleton />
  }

  const service = query.data

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={service.name}
        badges={
          <>
            <ServiceTypeBadge type={service.type} />
            <EnabledBadge enabled={service.enabled} />
          </>
        }
        description={<CopyId id={service.id} />}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/bookings?service=${service.id}`}>
                <CalendarCheckIcon /> Bookings
              </Link>
            </Button>
            {can("services", "update") && (
              <>
                <Button variant="outline" onClick={() => toggle.mutate(service)} disabled={toggle.isPending}>
                  <PowerIcon /> {service.enabled ? "Disable" : "Enable"}
                </Button>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <PencilIcon /> Edit
                </Button>
              </>
            )}
            {can("services", "delete") && (
              <ConfirmDialog
                title={`Delete ${service.name}?`}
                description="This permanently deletes the service and its resource associations. Its bookings are kept but lose their service. Consider disabling it instead."
                confirmLabel="Delete service"
                destructive
                onConfirm={() => remove.mutateAsync()}
                trigger={
                  <Button variant="destructive">
                    <Trash2Icon /> Delete
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(value) => void setTab(value as Tab)}>
        <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="resources">
              Resources
              {resources.data && (
                <Badge variant="secondary" className="h-4 px-1.5 tabular-nums">
                  {resources.data.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="slots" aria-label="Bookable slots">
              <span className="sm:hidden">Slots</span>
              <span className="hidden sm:inline">Bookable slots</span>
            </TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview" className="flex flex-col gap-4">
          <ServiceOverview service={service} />
        </TabsContent>
        <TabsContent value="resources">
          <ServiceResourcesTab serviceId={service.id} query={resources} />
        </TabsContent>
        <TabsContent value="slots">
          <BookableSlotsExplorer
            service={service}
            resources={resources}
            onShowResources={() => void setTab("resources")}
          />
        </TabsContent>
        <TabsContent value="json">
          <RawJsonCard
            value={service}
            {...(can("services", "update") && {
              toPutBody: (s: Service) => omitKeys(s, READ_ONLY),
              onReplace: (body: unknown) => replace.mutateAsync(body),
            })}
          />
        </TabsContent>
      </Tabs>
      <ServiceFormDialog open={editing} onOpenChange={setEditing} service={service} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="block text-muted-foreground">{children}</span>
}

function durationOrNone(value: string, none: string) {
  return isZeroDuration(value) ? <span className="text-muted-foreground">{none}</span> : humanizeDuration(value)
}

/** booking_window_end: whole days count from the start of today. */
function describeBookingHorizon(value: string | null): React.ReactNode {
  if (value === null) return "No limit"
  const parts = parseDuration(value)
  const dateOnly = !!parts && !parts.hours && !parts.minutes && !parts.seconds
  if (!dateOnly) return `Up to ${humanizeDuration(value)} ahead`
  if (value === "P1D") return "Until the end of today"
  return (
    <>
      {humanizeDuration(value)}
      <Muted>Counted in whole days from the start of today</Muted>
    </>
  )
}

function DayTimesTable({ start, end }: { start: DayTime; end: DayTime }) {
  return (
    <div className="max-w-md overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead>Start</TableHead>
            <TableHead>End</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {WEEKDAYS.map((day) => (
            <TableRow key={day}>
              <TableCell className="font-medium">{WEEKDAY_LABELS[day]}</TableCell>
              <TableCell className="tabular-nums">{shortTime(dayTimeFor(start, day)) || "—"}</TableCell>
              <TableCell className="tabular-nums">{shortTime(dayTimeFor(end, day)) || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function lengthItems(service: Service): DetailItem[] {
  switch (service.type) {
    case "fixed":
      return [
        { label: "Duration", value: humanizeDuration(service.duration) },
        {
          label: "Bookable interval",
          value:
            service.bookable_interval === null ? (
              <>
                Default
                <Muted>Duration + buffers</Muted>
              </>
            ) : (
              `Every ${humanizeDuration(service.bookable_interval)}`
            ),
        },
      ]
    case "flexible":
      return [
        { label: "Minimum length", value: humanizeDuration(service.min_duration) },
        { label: "Maximum length", value: service.max_duration === null ? "No maximum" : humanizeDuration(service.max_duration) },
        { label: "Step", value: humanizeDuration(service.duration_step) },
        {
          label: "Default length",
          value: service.default_duration === null ? <span className="text-muted-foreground">None</span> : humanizeDuration(service.default_duration),
        },
        {
          label: "Bookable interval",
          value:
            service.bookable_interval === null ? (
              <>
                Same as step
                <Muted>Every {humanizeDuration(service.duration_step)}</Muted>
              </>
            ) : (
              `Every ${humanizeDuration(service.bookable_interval)}`
            ),
        },
      ]
    case "day": {
      const perWeekday = isPerWeekday(service.start_time) || isPerWeekday(service.end_time)
      return [
        { label: "Minimum days", value: pluralDays(service.min_days) },
        { label: "Maximum days", value: service.max_days === null ? "No limit" : pluralDays(service.max_days) },
        {
          label: "Default days",
          value: service.default_days === null ? <span className="text-muted-foreground">None</span> : pluralDays(service.default_days),
        },
        { label: "Start time", value: summarizeDayTime(service.start_time), hidden: perWeekday },
        { label: "End time", value: summarizeDayTime(service.end_time), hidden: perWeekday },
        {
          label: "Start & end times",
          wide: true,
          hidden: !perWeekday,
          value: <DayTimesTable start={service.start_time} end={service.end_time} />,
        },
      ]
    }
  }
}

function ServiceOverview({ service }: { service: Service }) {
  const info = SERVICE_TYPE_INFO[service.type]
  return (
    <>
      <SectionCard title="Booking length" description={info.description}>
        <DetailList items={lengthItems(service)} />
      </SectionCard>
      <SectionCard title="Pricing & rules">
        <DetailList
          items={[
            {
              label: info.priceLabel,
              value:
                service.price === null ? (
                  <span className="text-muted-foreground">No price</span>
                ) : (
                  <span className="tabular-nums">
                    {formatPrice(service.price)}
                    {service.type === "flexible" ? " per hour" : service.type === "day" ? " per day" : ""}
                  </span>
                ),
            },
            { label: "Buffer before", value: durationOrNone(service.buffer_time_before, "None") },
            { label: "Buffer after", value: durationOrNone(service.buffer_time_after, "None") },
            {
              label: "Minimum notice",
              value: isZeroDuration(service.booking_window_start) ? (
                <>
                  None
                  <Muted>Bookable right up to the start</Muted>
                </>
              ) : (
                `${humanizeDuration(service.booking_window_start)} before the start`
              ),
            },
            { label: "Booking horizon", value: describeBookingHorizon(service.booking_window_end) },
            {
              label: "Cancelation threshold",
              value: isZeroDuration(service.cancelation_threshold) ? (
                <>
                  None
                  <Muted>Cancelable right up to the start</Muted>
                </>
              ) : (
                `Up to ${humanizeDuration(service.cancelation_threshold)} before the start`
              ),
            },
            { label: "Created", value: formatDateTime(service.created_at, { withOffset: true }) },
            { label: "Updated", value: formatDateTime(service.updated_at, { withOffset: true }) },
          ]}
        />
      </SectionCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Metadata">
          <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
            {JSON.stringify(service.metadata, null, 2)}
          </pre>
        </SectionCard>
        <SectionCard
          title="Protected metadata"
          description={
            service.protected_metadata === undefined ? "Not returned: the token lacks service:protected_metadata." : undefined
          }
        >
          <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
            {JSON.stringify(service.protected_metadata ?? null, null, 2)}
          </pre>
        </SectionCard>
      </div>
    </>
  )
}
