"use client"

import type { DatesSetInfo, EventClickInfo, EventDisplayInfo } from "@fullcalendar/react"
import { CalendarDaysIcon, MapPinIcon, RowsIcon, TriangleAlertIcon } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs"
import { useMemo, useState, type CSSProperties } from "react"
import { cn } from "cn"

import { EventCalendar, type EventCalendarProps } from "@/components/event-calendar"
import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { dateIn } from "@/lib/format/datetime"
import { indexById, useAllLocations, useAllResources } from "@/lib/hapio/hooks"
import { isDateString } from "@/features/resources/utils"

import {
  ALL_VIEWS,
  CALENDAR_COLORS,
  CALENDAR_VIEWS,
  MAX_OPEN_TIME_RESOURCES,
  RESOURCE_VIEWS,
  STATUS_LABELS,
  bookingEvent,
  calendarResources,
  hapioRange,
  isCalendarView,
  isResourceView,
  openTimeEvents,
  openTimeRange,
  resolveView,
  schedulerLicenseKey,
  showsOpenTime,
  type BookingEventProps,
  type OpenTimeEventProps,
} from "./calendar-model"
import { useCalendarBookings, useCalendarOpenTime } from "./queries"

const LICENSE_KEY = schedulerLicenseKey()

const CALENDAR_HEIGHT = "max(36rem, calc(100svh - 17rem))"

// The resource views come from FullCalendar Scheduler, a separate (paid) package: it's only
// downloaded when a licensed build actually shows them.
const ResourceTimeline = dynamic(
  () => import("@/components/resource-timeline").then((mod) => mod.ResourceTimeline),
  { loading: () => <Skeleton className="w-full" style={{ height: CALENDAR_HEIGHT }} /> }
)

/** `location` and `resource` follow the same contract as the bookings list (`/calendar?location=<id>`). */
const STATE = {
  location: parseAsString,
  resource: parseAsString,
  view: parseAsStringLiteral(ALL_VIEWS),
  // Checked where it's used: a malformed date must never reach FullCalendar.
  date: parseAsString,
  availability: parseAsBoolean.withDefault(false),
  canceled: parseAsBoolean.withDefault(false),
}

const TIME_FORMAT = { hour: "2-digit", minute: "2-digit", hour12: false } as const
const DAY_FORMAT = { weekday: "short", month: "numeric", day: "numeric", omitCommas: true } as const

/** 24-hour slot labels. The week timeline keeps its row of days above the hours. */
const VIEW_OPTIONS = {
  timeGrid: { slotHeaderFormat: TIME_FORMAT },
  resourceTimelineDay: { slotHeaderFormat: TIME_FORMAT },
  resourceTimelineWeek: { slotHeaderFormat: [DAY_FORMAT, TIME_FORMAT] },
} satisfies EventCalendarProps["views"]

/** Open time: a clear tint with an edge in the event colour (FullCalendar's default is a faint 10% tint). */
const OPEN_TIME_CLASS =
  "not-print:bg-[color-mix(in_oklab,var(--fc-event-color)_22%,transparent)] border-s-2 border-(--fc-event-color)"

export function CalendarPage() {
  const router = useRouter()
  const [state, setState] = useQueryStates(STATE, { history: "replace" })
  const [visible, setVisible] = useState<{ start: Date; end: Date; timeZone: string } | null>(null)

  const locations = useAllLocations()
  const resources = useAllResources()
  const locationsById = indexById(locations.data)
  const fallbackLocation = locations.data?.find((l) => l.enabled) ?? locations.data?.[0]
  const location = (state.location ? locationsById.get(state.location) : undefined) ?? fallbackLocation
  const timeZone = location?.time_zone

  const view = resolveView(state.view, !!LICENSE_KEY)
  const resourceMode = isResourceView(view)

  // The URL's view and date only seed FullCalendar. The calendar writes them back as it moves
  // (onDatesSet records what it wrote first); any other change, such as the sidebar link,
  // re-creates the calendar from the URL.
  const urlNav = `${state.view ?? ""}|${state.date ?? ""}`
  const [nav, setNav] = useState({ url: urlNav, written: urlNav, epoch: 0 })
  if (nav.url !== urlNav) {
    setNav({ url: urlNav, written: nav.written, epoch: urlNav === nav.written ? nav.epoch : nav.epoch + 1 })
  }

  // The visible range belongs to the zone it was computed in; after a location switch, wait for the new one.
  const shown = location && visible?.timeZone === timeZone ? visible : null
  const bookings = useCalendarBookings(
    location && shown
      ? { location: location.id, ...hapioRange(shown.start, shown.end, timeZone), resource: state.resource ?? undefined }
      : null
  )
  const shownBookings = useMemo(
    () => (bookings.data?.items ?? []).filter((b) => state.canceled || !b.is_canceled),
    [bookings.data, state.canceled]
  )

  const baseRows = useMemo(
    () => calendarResources(resources.data, { only: state.resource }),
    [resources.data, state.resource]
  )
  const rows = useMemo(
    () => calendarResources(resources.data, { only: state.resource, bookings: shownBookings }),
    [resources.data, state.resource, shownBookings]
  )

  const openTimeIds = useMemo(() => {
    if (!state.availability || !showsOpenTime(view)) return []
    // In the plain calendar, open time from several resources would overlap: show one resource's.
    if (!resourceMode) return state.resource ? [state.resource] : []
    return baseRows.slice(0, MAX_OPEN_TIME_RESOURCES).map((r) => r.id)
  }, [state.availability, state.resource, view, resourceMode, baseRows])
  const openTime = useCalendarOpenTime(
    location && shown && openTimeIds.length
      ? { location: location.id, ...openTimeRange(shown.start, shown.end, timeZone), resources: openTimeIds }
      : null
  )

  const bookingEvents = useMemo(
    () => shownBookings.map((b) => bookingEvent(b, { resourceView: resourceMode })),
    [shownBookings, resourceMode]
  )
  const openTimeData = openTime.data
  const openEvents = useMemo(
    () =>
      openTimeIds.flatMap((id) =>
        openTimeEvents(openTimeData?.[id], { resourceId: resourceMode ? id : undefined, timeZone })
      ),
    [openTimeIds, openTimeData, resourceMode, timeZone]
  )
  const events = useMemo(() => [...openEvents, ...bookingEvents], [openEvents, bookingEvents])

  const onDatesSet = (info: DatesSetInfo) => {
    setVisible((prev) =>
      prev?.timeZone === info.timeZone &&
      prev.start.getTime() === info.start.getTime() &&
      prev.end.getTime() === info.end.getTime()
        ? prev
        : { start: info.start, end: info.end, timeZone: info.timeZone }
    )
    const type = info.view.type
    const now = Date.now()
    const showsToday = info.view.currentStart.getTime() <= now && now < info.view.currentEnd.getTime()
    const next = {
      view: !isCalendarView(type) || type === CALENDAR_VIEWS[0] ? null : type,
      date: showsToday ? null : dateIn(info.view.currentStart, info.timeZone),
    }
    const written = `${next.view ?? ""}|${next.date ?? ""}`
    setNav((n) => (n.written === written ? n : { ...n, written }))
    if (next.view !== state.view || next.date !== state.date) void setState(next)
  }

  const onEventClick = ({ event, jsEvent }: EventClickInfo) => {
    if (!event.url) return
    // Like any link: modified and middle clicks open the booking in a new tab or window.
    if (jsEvent.button !== 0 || jsEvent.metaKey || jsEvent.ctrlKey || jsEvent.shiftKey || jsEvent.altKey) return
    jsEvent.preventDefault()
    router.push(event.url)
  }

  const setMode = (mode: string) => {
    if (!mode) return
    setVisible(null)
    void setState({ view: mode === "resources" ? RESOURCE_VIEWS[0] : null })
  }

  if (locations.isSuccess && !locations.data.length) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Calendar" />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MapPinIcon />
            </EmptyMedia>
            <EmptyTitle>No locations yet</EmptyTitle>
            <EmptyDescription>Bookings and schedules belong to a location. Create a location first.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" asChild>
              <Link href="/locations">Go to locations</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const failed = [locations, resources, bookings, openTime].filter((query) => query.error)
  const retry = () => failed.forEach((query) => void query.refetch())

  // No bookings for this range yet (the previous range's may still be on screen).
  const waiting = !bookings.error && (!bookings.data || bookings.isPlaceholderData)
  const busy = waiting || bookings.isFetching || openTime.isFetching

  const hint = !state.availability
    ? null
    : !showsOpenTime(view)
      ? "Open time shows in the week and day views."
      : !resourceMode && !state.resource
        ? `Pick a resource to see its open time${LICENSE_KEY ? ", or switch to the Resources layout" : ""}.`
        : resourceMode && baseRows.length > MAX_OPEN_TIME_RESOURCES
          ? `Open time is shown for the first ${MAX_OPEN_TIME_RESOURCES} resources. Pick a resource to see another one's.`
          : null

  const common = {
    timeZone,
    initialView: view,
    initialDate: isDateString(state.date) ? state.date : undefined,
    events,
    datesSet: onDatesSet,
    eventClick: onEventClick,
    eventContent: renderEventContent,
    backgroundEventContent: renderOpenTime,
    backgroundEventClass: OPEN_TIME_CLASS,
    noEventsText: waiting ? "Loading bookings…" : "No bookings in this period",
    viewClass: cn("transition-opacity", busy && "opacity-70"),
    editable: false,
    selectable: false,
    nowIndicator: true,
    navLinks: true,
    firstDay: 1,
    eventTimeFormat: TIME_FORMAT,
    views: VIEW_OPTIONS,
    scrollTime: "07:00",
    height: CALENDAR_HEIGHT,
  } satisfies EventCalendarProps
  const calendarKey = `${resourceMode ? "resources" : "calendar"}:${timeZone}:${nav.epoch}`

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Calendar"
        description={
          location
            ? `Bookings at ${location.name}, shown in ${location.time_zone}.`
            : "Bookings and open time across your resources."
        }
        actions={
          LICENSE_KEY ? (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={resourceMode ? "resources" : "calendar"}
              onValueChange={setMode}
              aria-label="Calendar layout"
            >
              <ToggleGroupItem value="calendar" aria-label="Calendar">
                <CalendarDaysIcon /> Calendar
              </ToggleGroupItem>
              <ToggleGroupItem value="resources" aria-label="Resources">
                <RowsIcon /> Resources
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="w-full sm:w-60">
          <EntityCombobox
            kind="location"
            size="sm"
            value={location?.id ?? null}
            placeholder={locations.isLoading ? "Loading…" : "Select location…"}
            aria-label="Location"
            onChange={(id) => id && setState({ location: id })}
          />
        </div>
        <div className="w-full sm:w-60">
          <EntityCombobox
            kind="resource"
            size="sm"
            clearable
            value={state.resource}
            placeholder="All resources"
            aria-label="Resource"
            onChange={(id) => setState({ resource: id })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            size="sm"
            checked={state.availability}
            onCheckedChange={(checked) => setState({ availability: checked || null })}
          />
          Show open time
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            size="sm"
            checked={state.canceled}
            onCheckedChange={(checked) => setState({ canceled: checked || null })}
          />
          Show canceled
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <span role="status" className="text-xs text-muted-foreground">
            {busy && location ? "Loading…" : null}
          </span>
          <Legend showOpen={openEvents.length > 0} showCanceled={state.canceled} />
        </div>
      </div>

      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {resourceMode && resources.isSuccess && !rows.length ? (
        <p className="text-sm text-muted-foreground">There are no enabled resources to show.</p>
      ) : null}

      {failed.length ? <ErrorAlert error={failed[0].error} onRetry={retry} /> : null}

      {bookings.data?.truncated ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Not every booking is shown</AlertTitle>
          <AlertDescription>
            This period has {bookings.data.total.toLocaleString("en")} bookings and the calendar loads the first{" "}
            {bookings.data.items.length.toLocaleString("en")}, so the latest ones are missing. Pick a resource or a
            shorter view to see them all.
          </AlertDescription>
        </Alert>
      ) : null}

      {!location ? (
        locations.error ? null : <Skeleton className="w-full" style={{ height: CALENDAR_HEIGHT }} />
      ) : (
        <div aria-busy={busy}>
          {resourceMode ? (
            <ResourceTimeline
              key={calendarKey}
              {...common}
              availableViews={[...RESOURCE_VIEWS]}
              schedulerLicenseKey={LICENSE_KEY ?? undefined}
              resources={rows}
              resourceOrder="order"
              resourceColumnHeaderContent="Resources"
              resourceColumnsWidth={192}
            />
          ) : (
            <EventCalendar key={calendarKey} {...common} availableViews={[...CALENDAR_VIEWS]} dayMaxEvents />
          )}
        </div>
      )}
    </div>
  )
}

/** FullCalendar's own event content, plus hover text and, for screen readers, the booking's status. */
function renderEventContent(info: EventDisplayInfo) {
  const props = info.event.extendedProps as Partial<BookingEventProps>
  return (
    <>
      {info.timeText && <div className={info.timeClass}>{info.timeText}</div>}
      <div className={info.titleClass} title={props.label}>
        {props.status && props.status !== "confirmed" ? (
          <span className="sr-only">{STATUS_LABELS[props.status]}: </span>
        ) : null}
        {info.event.title || " "}
      </div>
    </>
  )
}

/** Open time is shading; name each span, as the resource availability timeline does. */
function renderOpenTime(info: EventDisplayInfo) {
  const props = info.event.extendedProps as Partial<OpenTimeEventProps>
  return props.kind === "open" ? <div role="img" aria-label={props.label} className="size-full" /> : null
}

const LEGEND = [
  { status: "confirmed", label: "Confirmed", color: CALENDAR_COLORS.confirmed },
  { status: "temporary", label: "Temporary", color: CALENDAR_COLORS.temporary, className: "italic" },
  { status: "canceled", label: "Canceled", color: CALENDAR_COLORS.canceled, className: "line-through" },
] as const

function Legend({ showOpen, showCanceled }: { showOpen: boolean; showCanceled: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Legend">
      {LEGEND.filter((item) => item.status !== "canceled" || showCanceled).map((item) => (
        <li key={item.label} className={cn("flex items-center gap-1.5", "className" in item && item.className)}>
          <span className="size-3 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
      {showOpen ? (
        <li className="flex items-center gap-1.5">
          {/* Drawn like the shading itself. */}
          <span
            className={cn("size-3 rounded-sm", OPEN_TIME_CLASS)}
            style={{ "--fc-event-color": CALENDAR_COLORS.open } as CSSProperties}
          />
          Open
        </li>
      ) : null}
    </ul>
  )
}
