"use client"

import {
  isPlainDateString,
  sameTimeZone,
  type EventRenderArgs,
  type NavigateChange,
  type RangeChange,
} from "@hapio/calendar-react"
import { MapPinIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs"
import { useMemo, useState, type CSSProperties } from "react"
import { cn } from "cn"

import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { CalendarEventTime, EVENT_TITLE_CLASS } from "@/components/hapio-calendar/calendar-event"
import { HapioCalendar } from "@/components/hapio-calendar/hapio-calendar"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { indexById, useAllLocations } from "@/lib/hapio/hooks"

import {
  CALENDAR_COLORS,
  CALENDAR_VIEWS,
  STATUS_LABELS,
  bookingEvent,
  hapioRange,
  openTimeEvents,
  openTimeRange,
  showsOpenTime,
  type BookingEventData,
  type CalendarView,
} from "./calendar-model"
import { useCalendarBookings, useCalendarOpenTime } from "./queries"

/** The calendar's height, toolbar included; the views scroll inside it. */
const CALENDAR_CLASS = "h-[max(36rem,calc(100svh-17rem))]"

/** `location` and `resource` follow the same contract as the bookings list (`/calendar?location=<id>`). */
const STATE = {
  location: parseAsString,
  resource: parseAsString,
  view: parseAsStringLiteral(CALENDAR_VIEWS),
  // Checked where it's used: a malformed date shows today instead.
  date: parseAsString,
  availability: parseAsBoolean.withDefault(false),
  canceled: parseAsBoolean.withDefault(false),
}

/** 24-hour clock for event times and the time axis. */
const TIME_FORMAT = { hour: "2-digit", minute: "2-digit", hour12: false } as const
const FORMATS = { eventTime: TIME_FORMAT, slotLabel: TIME_FORMAT }

type VisibleRange = RangeChange<CalendarView>

export function CalendarPage() {
  const [state, setState] = useQueryStates(STATE, { history: "replace" })
  // What the calendar shows, as it reports it (after each navigation, and once on mount).
  const [range, setRange] = useState<VisibleRange | null>(null)

  const locations = useAllLocations()
  const locationsById = indexById(locations.data)
  const fallbackLocation = locations.data?.find((l) => l.enabled) ?? locations.data?.[0]
  const location = (state.location ? locationsById.get(state.location) : undefined) ?? fallbackLocation
  const timeZone = location?.time_zone

  // The URL drives the calendar (controlled view and date); onNavigate writes it back.
  const view: CalendarView = state.view ?? CALENDAR_VIEWS[0]
  // A hand-edited `?date=2026-02-30` is ignored: the calendar shows today.
  const date = state.date !== null && isPlainDateString(state.date) ? state.date : "today"

  // The visible range belongs to the zone it was computed in; after a location switch, wait for the new one.
  const shown = location && range && sameTimeZone(range.timeZone, location.time_zone) ? range : null
  const bookings = useCalendarBookings(
    location && shown
      ? {
          location: location.id,
          ...hapioRange(shown.start.epochMilliseconds, shown.end.epochMilliseconds, timeZone),
          resource: state.resource ?? undefined,
        }
      : null
  )
  const shownBookings = useMemo(
    () => (bookings.data?.items ?? []).filter((b) => state.canceled || !b.is_canceled),
    [bookings.data, state.canceled]
  )

  // Open time from several resources would overlap, so the calendar shows one resource's.
  const openTimeId = state.availability && showsOpenTime(view) ? state.resource : null
  const openTime = useCalendarOpenTime(
    location && shown && openTimeId
      ? {
          location: location.id,
          ...openTimeRange(shown.start.epochMilliseconds, shown.end.epochMilliseconds, timeZone),
          resources: [openTimeId],
        }
      : null
  )

  const bookingEvents = useMemo(() => shownBookings.map(bookingEvent), [shownBookings])
  const openTimeData = openTime.data
  const openEvents = useMemo(
    () => (openTimeId ? openTimeEvents(openTimeData?.[openTimeId], { timeZone }) : []),
    [openTimeId, openTimeData, timeZone]
  )

  const onNavigate = ({ view: next, dateIso, includesToday }: NavigateChange<CalendarView>) => {
    // The default view and a period with today in it keep the URL clean.
    void setState({ view: next === CALENDAR_VIEWS[0] ? null : next, date: includesToday ? null : dateIso })
  }

  const onRangeChange = (next: VisibleRange) => {
    setRange(next)
    // The calendar ignored a malformed date; drop it from the URL too.
    if (state.date !== null && date === "today") void setState({ date: null })
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

  const failed = [locations, bookings, openTime].filter((query) => query.error)
  const retry = () => failed.forEach((query) => void query.refetch())

  // No bookings for this range yet (the previous range's may still be on screen).
  const waiting = !bookings.error && (!bookings.data || bookings.isPlaceholderData)
  const busy = waiting || bookings.isFetching || openTime.isFetching

  const hint = !state.availability
    ? null
    : !showsOpenTime(view)
      ? "Open time shows in the week and day views."
      : !state.resource
        ? "Pick a resource to see its open time."
        : null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Calendar"
        description={
          location
            ? `Bookings at ${location.name}, shown in ${location.time_zone}.`
            : "Bookings and open time across your resources."
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
        locations.error ? null : <Skeleton className={cn("w-full", CALENDAR_CLASS)} />
      ) : (
        <HapioCalendar
          view={view}
          date={date}
          onNavigate={onNavigate}
          onRangeChange={onRangeChange}
          events={bookingEvents}
          backgroundEvents={openEvents}
          timeZone={location.time_zone}
          weekStartsOn={1}
          formats={FORMATS}
          navLinks
          nowIndicator
          scrollTime="07:00"
          loading={busy}
          linkComponent={Link}
          renderEvent={renderEventContent}
          renderEmpty={renderEmpty}
          className={CALENDAR_CLASS}
        />
      )}
    </div>
  )
}

/** The calendar's own time and title, plus hover text and, for screen readers, the booking's status. */
function renderEventContent({ event, timeText, title }: EventRenderArgs<BookingEventData>) {
  const { status, label } = event.data
  return (
    <>
      <CalendarEventTime />
      {timeText ? " " : null}
      <span data-slot="calendar-event-title" dir="auto" className={EVENT_TITLE_CLASS} title={label}>
        {status !== "confirmed" ? <span className="sr-only">{STATUS_LABELS[status]}: </span> : null}
        {title}
      </span>
    </>
  )
}

/** The list view's message for a period without bookings (also while the first ones load). */
function renderEmpty({ loading }: { loading: boolean }) {
  return loading ? "Loading bookings…" : "No bookings in this period"
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
          {/* Drawn like the shading itself (calendar-theme's background fill and start edge). */}
          <span
            className="size-3 rounded-sm calendar-background-fill border-s-2 border-(--event-color)"
            style={{ "--event-color": CALENDAR_COLORS.open } as CSSProperties}
          />
          Open
        </li>
      ) : null}
    </ul>
  )
}
