"use client"

import { format } from "date-fns"
import { CalendarClockIcon, CalendarSyncIcon, ChevronLeftIcon, ChevronRightIcon, InfoIcon, MapPinIcon } from "lucide-react"
import Link from "next/link"
import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs"
import { cn } from "cn"

import { ErrorAlert } from "@/components/entity/error-alert"
import { SectionCard } from "@/components/entity/section-card"
import {
  TimelineLegend,
  WeekTimeline,
  describeSpan,
  wallMinutes,
  type TimelineSpan,
} from "@/components/entity/week-timeline"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { dayRange, toHapioDateTime, todayIn } from "@/lib/format/datetime"
import { indexById, useAllLocations } from "@/lib/hapio/hooks"
import type { Resource, TimeSpan } from "@/lib/hapio/types"

import type { ResourceTab } from "./constants"
import {
  useRecurringSchedules,
  useResourceFullyBooked,
  useResourceSchedule,
  useScheduleBlocks,
} from "./queries"
import {
  addDaysTo,
  formatHours,
  isDateString,
  mondayOf,
  nowWallDate,
  parseDateString,
  spanMinutes,
  zonedWallDate,
} from "./utils"

const STATE = {
  location: parseAsString,
  week: parseAsString,
  booked: parseAsBoolean.withDefault(false),
}
const URL_KEYS = { location: "av_location", week: "av_week", booked: "av_booked" }

interface DaySpan {
  key: string
  start: Date
  end: Date
  minutes: number
}

/** "09:00–17:00", "22:00–24:00", "22:00–Tue 02:00". */
function chipTimes(start: Date, end: Date) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const minutesFromStartDay = wallMinutes(end) - wallMinutes(startDay)
  if (minutesFromStartDay <= 1440) {
    return `${format(start, "HH:mm")}–${minutesFromStartDay === 1440 ? "24:00" : format(end, "HH:mm")}`
  }
  return `${format(start, "HH:mm")}–${format(end, "EEE HH:mm")}`
}

/** Picks the location to show first: one the resource has schedules at, else the first location. */
function useDefaultLocation(resourceId: string, enabled: boolean) {
  const locations = useAllLocations()
  // Start of today: stable for the day, so the query keys don't change on every render.
  const { from } = dayRange(0, 1)
  const recurring = useRecurringSchedules(resourceId, { per_page: 1, from: from.slice(0, 10) }, { enabled })
  const blocks = useScheduleBlocks(resourceId, { per_page: 1, from }, { enabled })
  const hinted = recurring.data?.data[0]?.location?.id ?? blocks.data?.data[0]?.location?.id
  const fallback = locations.data?.find((l) => l.enabled)?.id ?? locations.data?.[0]?.id
  return {
    locationId: hinted ?? fallback ?? null,
    loading: enabled && (recurring.isLoading || blocks.isLoading),
  }
}

export function AvailabilityTab({
  resource,
  onNavigate,
}: {
  resource: Resource
  onNavigate: (tab: ResourceTab) => void
}) {
  const [state, setState] = useQueryStates(STATE, { history: "replace", urlKeys: URL_KEYS })
  const locations = useAllLocations()
  const locationsById = indexById(locations.data)
  const fallback = useDefaultLocation(resource.id, !state.location)

  const locationId = state.location ?? fallback.locationId
  const location = locationId ? locationsById.get(locationId) : undefined
  const timeZone = location?.time_zone

  const today = todayIn(timeZone)
  const currentMonday = mondayOf(today)
  const monday = isDateString(state.week) ? mondayOf(state.week) : currentMonday
  const isCurrentWeek = monday === currentMonday
  const days = Array.from({ length: 7 }, (_, i) => parseDateString(addDaysTo(monday, i)))
  const range = location
    ? {
        from: toHapioDateTime(`${monday}T00:00`, timeZone),
        to: toHapioDateTime(`${addDaysTo(monday, 7)}T00:00`, timeZone),
      }
    : null

  const schedule = useResourceSchedule(
    resource.id,
    range && location
      ? { ...range, location: location.id, fully_booked: state.booked ? "include" : "exclude" }
      : null
  )
  const fullyBooked = useResourceFullyBooked(resource.id, range)

  const setWeek = (value: string) => setState({ week: value === currentMonday ? null : value })

  const toDaySpans = (spans: TimeSpan[] | undefined, prefix: string): DaySpan[] =>
    (spans ?? []).map((s, i) => ({
      key: `${prefix}-${i}-${s.starts_at}`,
      start: zonedWallDate(s.starts_at, timeZone),
      end: zonedWallDate(s.ends_at, timeZone),
      minutes: spanMinutes(s.starts_at, s.ends_at),
    }))
  const open = toDaySpans(schedule.data, "open")
  const booked = toDaySpans(fullyBooked.data, "booked")

  const timeline: TimelineSpan[] = [
    ...open.map((s) => ({ ...s, tone: "available" as const, label: `Open · ${describeSpan(s.start, s.end, true)}` })),
    ...booked.map((s) => ({
      ...s,
      tone: "booked" as const,
      label: `Fully booked · ${describeSpan(s.start, s.end, true)}`,
    })),
  ]

  const weekStart = wallMinutes(days[0])
  const dayIndex = (span: DaySpan) => Math.min(6, Math.max(0, Math.floor((wallMinutes(span.start) - weekStart) / 1440)))
  const openMinutes = open.reduce((sum, s) => sum + s.minutes, 0)
  const bookedMinutes = booked.reduce((sum, s) => sum + s.minutes, 0)
  const openDays = new Set(open.map(dayIndex)).size

  const loading = fallback.loading || locations.isLoading
  const fetching = schedule.isFetching || fullyBooked.isFetching
  const hasData = schedule.data !== undefined && fullyBooked.data !== undefined
  const error = schedule.error ?? fullyBooked.error

  if (!loading && !locations.data?.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MapPinIcon />
          </EmptyMedia>
          <EmptyTitle>No locations yet</EmptyTitle>
          <EmptyDescription>Resources are scheduled at locations. Create a location first.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" asChild>
            <Link href="/locations">Go to locations</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {!resource.enabled && (
        <Alert>
          <InfoIcon />
          <AlertTitle>This resource is disabled</AlertTitle>
          <AlertDescription>Its schedule is shown below, but it can&apos;t take new bookings until it&apos;s enabled.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-60">
          <EntityCombobox
            kind="location"
            size="sm"
            value={locationId}
            placeholder={loading ? "Loading…" : "Select location…"}
            onChange={(id) => id && setState({ location: id })}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous week" onClick={() => setWeek(addDaysTo(monday, -7))}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="sm" disabled={isCurrentWeek} onClick={() => setWeek(currentMonday)}>
            This week
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next week" onClick={() => setWeek(addDaysTo(monday, 7))}>
            <ChevronRightIcon />
          </Button>
        </div>
        <span className="text-sm font-medium tabular-nums">
          {format(days[0], "d MMM")} – {format(days[6], "d MMM yyyy")}
        </span>
        <label className="flex items-center gap-2 text-sm sm:ml-auto">
          <Switch
            size="sm"
            checked={state.booked}
            onCheckedChange={(checked) => setState({ booked: checked || null })}
          />
          Include fully booked
        </label>
      </div>

      {error ? <ErrorAlert error={error} onRetry={() => (schedule.error ? schedule.refetch() : fullyBooked.refetch())} /> : null}

      <SectionCard
        title="Week overview"
        description={
          location
            ? `Open time at ${location.name}, in ${location.time_zone}. Fully booked time applies across all locations.`
            : "Pick a location to see this resource's open time there."
        }
      >
        <div className="flex flex-col gap-3">
          <TimelineLegend
            items={[
              { tone: "available", label: state.booked ? "Scheduled" : "Open" },
              { tone: "booked", label: "Fully booked" },
            ]}
          />
          {loading || (!hasData && location && !error) ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <WeekTimeline
              days={days}
              spans={timeline}
              today={parseDateString(today)}
              now={isCurrentWeek ? nowWallDate(timeZone) : undefined}
              datedTooltips
              className={cn("transition-opacity", fetching && "opacity-60")}
              aria-label="Open and fully booked time this week"
            />
          )}
        </div>
      </SectionCard>

      {hasData && location && (
        <SectionCard title="Details">
          {open.length === 0 && booked.length === 0 ? (
            <Empty className="p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClockIcon />
                </EmptyMedia>
                <EmptyTitle>No open time this week</EmptyTitle>
                <EmptyDescription>
                  Add a recurring schedule or schedule block at {location.name} to open up time for bookings.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex-row flex-wrap justify-center">
                <Button size="sm" variant="outline" onClick={() => onNavigate("recurring")}>
                  <CalendarSyncIcon /> Recurring schedules
                </Button>
                <Button size="sm" variant="outline" onClick={() => onNavigate("blocks")}>
                  <CalendarClockIcon /> Schedule blocks
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-3 gap-2">
                {[
                  { label: state.booked ? "Scheduled" : "Open", value: formatHours(openMinutes) },
                  { label: "Fully booked", value: bookedMinutes ? formatHours(bookedMinutes) : "None" },
                  { label: "Days open", value: `${openDays} of 7` },
                ].map((stat) => (
                  <div key={stat.label} className="min-w-0 rounded-lg bg-muted/50 px-2.5 py-2 sm:px-3">
                    <dt className="text-xs leading-tight text-muted-foreground">{stat.label}</dt>
                    <dd className="mt-0.5 text-sm font-medium tabular-nums">{stat.value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="divide-y">
                {days.map((day, index) => {
                  const dayOpen = open.filter((s) => dayIndex(s) === index)
                  const dayBooked = booked.filter((s) => dayIndex(s) === index)
                  return (
                    <li key={day.getTime()} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                      <span className="w-20 shrink-0 pt-0.5 text-sm font-medium sm:w-28">{format(day, "EEE d MMM")}</span>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        {dayOpen.map((s) => (
                          <span
                            key={s.key}
                            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-800 tabular-nums dark:bg-emerald-500/15 dark:text-emerald-300"
                          >
                            {chipTimes(s.start, s.end)}
                          </span>
                        ))}
                        {dayBooked.map((s) => (
                          <span
                            key={s.key}
                            className="rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive tabular-nums"
                          >
                            Fully booked {chipTimes(s.start, s.end)}
                          </span>
                        ))}
                        {!dayOpen.length && !dayBooked.length && (
                          <span className="pt-0.5 text-sm text-muted-foreground">No open time</span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}
