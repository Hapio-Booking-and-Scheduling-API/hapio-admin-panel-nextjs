// Pure helpers for the calendar page: Hapio entities → FullCalendar inputs.

import { TZDate } from "@date-fns/tz"
import type { EventInput } from "@fullcalendar/react"
import { addWeeks, startOfISOWeek } from "date-fns"

import { describeSpan } from "@/components/entity/week-timeline-model"
import { browserTimeZone, toHapioTimestamp } from "@/lib/format/datetime"
import type { Booking, Resource, TimeSpan, Uuid } from "@/lib/hapio/types"
import { bookingStatus, bookingTitle, type BookingStatus } from "@/features/bookings/utils"

/** Views without per-resource rows: free in FullCalendar. */
export const CALENDAR_VIEWS = ["timeGridWeek", "timeGridDay", "dayGridMonth", "listWeek"] as const
/** One row per resource: needs a FullCalendar Scheduler licence key. */
export const RESOURCE_VIEWS = ["resourceTimelineDay", "resourceTimelineWeek"] as const

export type CalendarView = (typeof CALENDAR_VIEWS)[number] | (typeof RESOURCE_VIEWS)[number]
export const ALL_VIEWS: readonly CalendarView[] = [...CALENDAR_VIEWS, ...RESOURCE_VIEWS]

export const isCalendarView = (view: string): view is CalendarView => (ALL_VIEWS as readonly string[]).includes(view)
export const isResourceView = (view: string): boolean => view.startsWith("resource")

/** The view to show: the requested one, or the week view when it needs a licence the build doesn't have. */
export function resolveView(requested: CalendarView | null, licensed: boolean): CalendarView {
  const view = requested ?? CALENDAR_VIEWS[0]
  return isResourceView(view) && !licensed ? CALENDAR_VIEWS[0] : view
}

/**
 * Open time is shading on a time axis. FullCalendar draws timed background events in the time
 * grids and timelines only, not in the month or list views.
 */
export const showsOpenTime = (view: CalendarView): boolean =>
  view.startsWith("timeGrid") || view.startsWith("resourceTimeline")

/** Open time costs one schedule request per resource, so the Resources layout loads it for this many rows at most. */
export const MAX_OPEN_TIME_RESOURCES = 20

/**
 * Event colours: temporary is the amber of the "Temporary" badge, open time the emerald of the
 * resource availability timeline, and canceled bookings are grey. Colour is never the only cue:
 * temporary titles are italic, canceled ones struck through, and both are named for screen readers.
 */
export const CALENDAR_COLORS = {
  confirmed: "var(--primary)",
  temporary: "var(--color-amber-500, oklch(0.769 0.188 70.08))",
  canceled: "var(--muted-foreground)",
  open: "var(--color-emerald-500, oklch(0.696 0.17 162.48))",
} as const

export const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: "Confirmed",
  temporary: "Temporary",
  canceled: "Canceled",
}

const STATUS_STYLES: Record<BookingStatus, Pick<EventInput, "color" | "contrastColor" | "className">> = {
  confirmed: {},
  temporary: { color: CALENDAR_COLORS.temporary, contrastColor: "black", className: "italic" },
  canceled: { color: CALENDAR_COLORS.canceled, contrastColor: "var(--background)", className: "line-through" },
}

/** The FullCalendar Scheduler licence key, or null when resource views are unavailable. */
export function schedulerLicenseKey(
  value: string | undefined = process.env.NEXT_PUBLIC_FULLCALENDAR_LICENSE_KEY
): string | null {
  return value?.trim() || null
}

/** A visible calendar range (instants) → Hapio `from`/`to` timestamps in the location's zone. */
export function hapioRange(start: Date, end: Date, timeZone?: string | null): { from: string; to: string } {
  return { from: toHapioTimestamp(start, timeZone), to: toHapioTimestamp(end, timeZone) }
}

/**
 * The whole weeks (Monday to Monday in the location's zone) around a visible range. Open time
 * is loaded per week, so moving day by day doesn't cost another request per resource.
 */
export function openTimeRange(start: Date, end: Date, timeZone?: string | null): { from: string; to: string } {
  const zone = timeZone || browserTimeZone()
  const from = startOfISOWeek(new TZDate(start.getTime(), zone))
  const to = addWeeks(startOfISOWeek(new TZDate(end.getTime() - 1, zone)), 1)
  return { from: toHapioTimestamp(from, zone), to: toHapioTimestamp(to, zone) }
}

interface Scope {
  location: Uuid
  resource?: Uuid
  resources?: Uuid[]
}

/** Whether two calendar queries cover the same location and resources (their dates may differ). */
export function sameScope(a: Scope | null | undefined, b: Scope | null | undefined): boolean {
  return (
    !!a &&
    !!b &&
    a.location === b.location &&
    (a.resource ?? null) === (b.resource ?? null) &&
    (a.resources ?? []).join() === (b.resources ?? []).join()
  )
}

/** Row id, in the Resources layout, of bookings without a resource. */
export const NO_RESOURCE_ID = "__no_resource__"

export interface BookingEventProps {
  kind: "booking"
  status: BookingStatus
  /** Hover text: narrow columns cut the title off. */
  label: string
}

export interface OpenTimeEventProps {
  kind: "open"
  /** Accessible name, e.g. "Open · Mon 19 Oct 09:00–17:00". */
  label: string
}

export function bookingEventTitle(booking: Booking, withResource: boolean): string {
  const title = bookingTitle(booking)
  return withResource && booking.resource ? `${title} · ${booking.resource.name}` : title
}

/**
 * A booking as a calendar event that links to the booking. In resource views the event sits in
 * its resource's row (or the "No resource" row), so the title leaves out the resource.
 */
export function bookingEvent(booking: Booking, options: { resourceView: boolean }): EventInput {
  const status = bookingStatus(booking)
  const title = bookingEventTitle(booking, !options.resourceView)
  const extendedProps: BookingEventProps = {
    kind: "booking",
    status,
    label: status === "confirmed" ? title : `${title} (${STATUS_LABELS[status].toLowerCase()})`,
  }
  return {
    id: booking.id,
    title,
    start: booking.starts_at,
    end: booking.ends_at,
    url: `/bookings/${booking.id}`,
    extendedProps,
    ...(options.resourceView ? { resourceId: booking.resource?.id ?? NO_RESOURCE_ID } : {}),
    ...STATUS_STYLES[status],
  }
}

/** A resource's open time as shading (background events), named for screen readers. */
export function openTimeEvents(
  spans: TimeSpan[] | undefined,
  options: { resourceId?: Uuid; timeZone?: string | null } = {}
): EventInput[] {
  const zone = options.timeZone || browserTimeZone()
  return (spans ?? []).map((span, index) => {
    const extendedProps: OpenTimeEventProps = {
      kind: "open",
      label: `Open · ${describeSpan(new TZDate(span.starts_at, zone), new TZDate(span.ends_at, zone), true)}`,
    }
    return {
      id: `open:${options.resourceId ?? "all"}:${index}`,
      start: span.starts_at,
      end: span.ends_at,
      display: "background",
      color: CALENDAR_COLORS.open,
      extendedProps,
      ...(options.resourceId ? { resourceId: options.resourceId } : {}),
    }
  })
}

export interface CalendarResource {
  id: Uuid
  title: string
  /** Row position (FullCalendar's `resourceOrder`). */
  order: number
}

/**
 * Rows for the Resources layout: the enabled resources (or only the filtered one), plus any
 * resource with a booking in view, even a disabled or deleted one, and a last "No resource" row
 * for bookings without one. The layout never hides a booking that the calendar would show.
 */
export function calendarResources(
  resources: Resource[] | undefined,
  options: { only?: Uuid | null; bookings?: Booking[] } = {}
): CalendarResource[] {
  const known = new Map((resources ?? []).map((r) => [r.id, r]))
  const titles = new Map<Uuid, string>()
  const add = (r: Pick<Resource, "id" | "name" | "enabled">) =>
    titles.set(r.id, r.enabled ? r.name : `${r.name} (disabled)`)

  for (const r of resources ?? []) {
    if (options.only ? r.id === options.only : r.enabled) add(r)
  }
  let unassigned = false
  for (const b of options.bookings ?? []) {
    if (!b.resource) unassigned = true
    else if (!titles.has(b.resource.id)) add(known.get(b.resource.id) ?? b.resource)
  }

  const rows = [...titles]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title))
  if (unassigned) rows.push({ id: NO_RESOURCE_ID, title: "No resource" })
  return rows.map((row, order) => ({ ...row, order }))
}
