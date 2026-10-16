// Pure helpers for the calendar page: Hapio entities → Hapio Calendar inputs.

import { TZDate } from "@date-fns/tz"
import type {
  BackgroundEventInput,
  CalendarEventInput,
  CalendarEventInputBase,
  DefaultViews,
  ViewName,
} from "@hapio/calendar-react"
import { addWeeks, startOfISOWeek } from "date-fns"

import { describeSpan } from "@/components/entity/week-timeline-model"
import { browserTimeZone, toHapioTimestamp } from "@/lib/format/datetime"
import type { Booking, TimeSpan, Uuid } from "@/lib/hapio/types"
import { bookingStatus, bookingTitle, type BookingStatus } from "@/features/bookings/utils"

/** The calendar's views (Hapio Calendar's defaults), in the order of the view switcher; the first is the default. */
export const CALENDAR_VIEWS = ["week", "day", "month", "list"] as const satisfies readonly ViewName<DefaultViews>[]

export type CalendarView = (typeof CALENDAR_VIEWS)[number]

/** Open time is shading on a time axis: the week and day views draw it, the month and list views don't. */
export const showsOpenTime = (view: CalendarView): boolean => view === "week" || view === "day"

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

const STATUS_STYLES: Record<BookingStatus, Pick<CalendarEventInputBase, "color" | "contrastColor" | "className">> = {
  confirmed: {},
  temporary: { color: CALENDAR_COLORS.temporary, contrastColor: "black", className: "italic" },
  canceled: { color: CALENDAR_COLORS.canceled, contrastColor: "var(--background)", className: "line-through" },
}

/** A visible calendar range (instants) → Hapio `from`/`to` timestamps in the location's zone. */
export function hapioRange(start: Date | number, end: Date | number, timeZone?: string | null): { from: string; to: string } {
  return { from: toHapioTimestamp(start, timeZone), to: toHapioTimestamp(end, timeZone) }
}

/**
 * The whole weeks (Monday to Monday in the location's zone) around a visible range. Open time
 * is loaded per week, so moving day by day doesn't cost another request per resource.
 */
export function openTimeRange(start: Date | number, end: Date | number, timeZone?: string | null): { from: string; to: string } {
  const zone = timeZone || browserTimeZone()
  const from = startOfISOWeek(new TZDate(start.valueOf(), zone))
  const to = addWeeks(startOfISOWeek(new TZDate(end.valueOf() - 1, zone)), 1)
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

/** What a booking event carries besides its title: `event.data` in the calendar. */
export interface BookingEventData {
  status: BookingStatus
  /** Hover text: narrow columns cut the title off. */
  label: string
}

/** "Haircut · Anna": the service, then the resource. */
export function bookingEventTitle(booking: Booking): string {
  const title = bookingTitle(booking)
  return booking.resource ? `${title} · ${booking.resource.name}` : title
}

/** A booking as a calendar event that links to the booking. */
export function bookingEvent(booking: Booking): CalendarEventInput<BookingEventData> {
  const status = bookingStatus(booking)
  const title = bookingEventTitle(booking)
  return {
    id: booking.id,
    title,
    start: booking.starts_at,
    end: booking.ends_at,
    href: `/bookings/${booking.id}`,
    data: {
      status,
      label: status === "confirmed" ? title : `${title} (${STATUS_LABELS[status].toLowerCase()})`,
    },
    ...STATUS_STYLES[status],
  }
}

/** A resource's open time as shading (background events), named for screen readers. */
export function openTimeEvents(spans: TimeSpan[] | undefined, options: { timeZone?: string | null } = {}): BackgroundEventInput[] {
  const zone = options.timeZone || browserTimeZone()
  return (spans ?? []).map((span, index) => ({
    id: `open:${index}`,
    start: span.starts_at,
    end: span.ends_at,
    // The accessible name, e.g. "Open · Mon 19 Oct 09:00–17:00".
    label: `Open · ${describeSpan(new TZDate(span.starts_at, zone), new TZDate(span.ends_at, zone), true)}`,
    color: CALENDAR_COLORS.open,
  }))
}
