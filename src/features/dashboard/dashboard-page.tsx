"use client"

import {
  ArrowRightIcon,
  CalendarCheckIcon,
  CalendarPlusIcon,
  HourglassIcon,
  MapPinIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"

import { BookingStatusBadge } from "@/components/entity/badges"
import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { dayRange, formatDateTime, formatTime } from "@/lib/format/datetime"
import {
  useBookings,
  useLocations,
  useProject,
  useResources,
  useServices,
} from "@/lib/hapio/hooks"
import type { Booking, Paginated } from "@/lib/hapio/types"

function StatCard({
  title,
  icon: Icon,
  value,
  hint,
  href,
  loading,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  value: number | undefined
  hint: string
  href: string
  loading: boolean
}) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" /> {title}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href={href} aria-label={`Open ${title}`}>
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="text-3xl font-semibold tabular-nums">{value ?? "—"}</p>
        )}
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

function BookingList({
  query,
  emptyText,
}: {
  query: { data?: Paginated<Booking>; isLoading: boolean; error: unknown; refetch: () => unknown }
  emptyText: string
}) {
  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }
  if (query.error) return <ErrorAlert error={query.error} onRetry={() => query.refetch()} />
  const bookings = query.data?.data ?? []
  if (!bookings.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Nothing to show</EmptyTitle>
          <EmptyDescription>{emptyText}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="divide-y rounded-lg border">
      {bookings.map((b) => (
        <li key={b.id}>
          <Link
            href={`/bookings/${b.id}`}
            className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
          >
            <div className="w-28 shrink-0">
              <p className="font-medium tabular-nums">{formatDateTime(b.starts_at, { pattern: "EEE d MMM" })}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{b.service?.name ?? "Deleted service"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[b.resource?.name, b.location?.name].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <BookingStatusBadge booking={b} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function DashboardPage() {
  const project = useProject()
  // Computed once per mount so the query keys stay stable.
  const week = useMemo(() => dayRange(0, 7), [])
  const now = week.from

  const locations = useLocations({ per_page: 1 })
  const resources = useResources({ per_page: 1 })
  const services = useServices({ per_page: 1 })
  const upcoming = useBookings({
    from: week.from,
    to: week.to,
    temporary: "include",
    per_page: 8,
    sort: "starts_at.asc",
  })
  const pending = useBookings({
    from: now,
    temporary: "only",
    per_page: 8,
    sort: "starts_at.asc",
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={project.data ? `Project: ${project.data.name}` : "Overview of your Hapio project."}
        actions={
          <Button asChild>
            <Link href="/bookings/new">
              <CalendarPlusIcon /> New booking
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Bookings"
          icon={CalendarCheckIcon}
          value={upcoming.data?.meta.total}
          hint="In the next 7 days"
          href="/bookings"
          loading={upcoming.isLoading}
        />
        <StatCard
          title="Locations"
          icon={MapPinIcon}
          value={locations.data?.meta.total}
          hint="Enabled"
          href="/locations"
          loading={locations.isLoading}
        />
        <StatCard
          title="Resources"
          icon={UsersIcon}
          value={resources.data?.meta.total}
          hint="Enabled"
          href="/resources"
          loading={resources.isLoading}
        />
        <StatCard
          title="Services"
          icon={SparklesIcon}
          value={services.data?.meta.total}
          hint="Enabled"
          href="/services"
          loading={services.isLoading}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming bookings</CardTitle>
            <CardDescription>Next 7 days, including temporary holds.</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" asChild>
                <Link href="/bookings">View all</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <BookingList query={upcoming} emptyText="No bookings in the next 7 days." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HourglassIcon className="size-4" /> Awaiting finalization
            </CardTitle>
            <CardDescription>Temporary bookings that haven&apos;t been confirmed yet.</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" asChild>
                <Link href="/bookings?temporary=only">View all</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <BookingList query={pending} emptyText="No temporary bookings. All caught up." />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
