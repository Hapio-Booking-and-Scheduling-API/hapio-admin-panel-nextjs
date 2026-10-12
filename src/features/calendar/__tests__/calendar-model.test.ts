import { describe, expect, it } from "vitest"

import type { Booking, Resource } from "@/lib/hapio/types"

import {
  CALENDAR_COLORS,
  NO_RESOURCE_ID,
  bookingEvent,
  calendarResources,
  hapioRange,
  isCalendarView,
  isResourceView,
  openTimeEvents,
  openTimeRange,
  resolveView,
  sameScope,
  schedulerLicenseKey,
  showsOpenTime,
} from "../calendar-model"

const resource = (id: string, name: string, enabled = true) =>
  ({ id, name, enabled, max_simultaneous_bookings: null, metadata: null }) as unknown as Resource

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    starts_at: "2026-10-22T09:00:00+02:00",
    ends_at: "2026-10-22T09:45:00+02:00",
    is_temporary: false,
    is_canceled: false,
    resource: resource("r1", "Anna"),
    service: { id: "s1", name: "Haircut" },
    location: null,
    ...overrides,
  } as Booking
}

describe("hapioRange", () => {
  it("turns the visible instants into Hapio timestamps in the location's zone", () => {
    // Mon 19 – Mon 26 Oct 2026 in Stockholm; the clocks go back on Sun 25 Oct.
    const start = new Date("2026-10-18T22:00:00Z")
    const end = new Date("2026-10-25T23:00:00Z")
    expect(hapioRange(start, end, "Europe/Stockholm")).toEqual({
      from: "2026-10-19T00:00:00+02:00",
      to: "2026-10-26T00:00:00+01:00",
    })
    // The same instants, written in New York's offset.
    expect(hapioRange(start, end, "America/New_York")).toEqual({
      from: "2026-10-18T18:00:00-04:00",
      to: "2026-10-25T19:00:00-04:00",
    })
  })
})

describe("openTimeRange", () => {
  const WEEK = { from: "2026-10-19T00:00:00+02:00", to: "2026-10-26T00:00:00+01:00" }

  it("widens a day to its whole week (Monday to Monday), so the other days reuse the request", () => {
    // Thu 22 Oct in Stockholm.
    expect(openTimeRange(new Date("2026-10-21T22:00:00Z"), new Date("2026-10-22T22:00:00Z"), "Europe/Stockholm")).toEqual(WEEK)
    // Sun 25 Oct, the 25-hour day.
    expect(openTimeRange(new Date("2026-10-24T22:00:00Z"), new Date("2026-10-25T23:00:00Z"), "Europe/Stockholm")).toEqual(WEEK)
  })

  it("keeps a week as it is", () => {
    expect(openTimeRange(new Date("2026-10-18T22:00:00Z"), new Date("2026-10-25T23:00:00Z"), "Europe/Stockholm")).toEqual(WEEK)
  })

  it("works in the location's zone, across its own clock change", () => {
    // Sun 1 Nov in New York, when US daylight saving time ends.
    expect(openTimeRange(new Date("2026-11-01T04:00:00Z"), new Date("2026-11-02T05:00:00Z"), "America/New_York")).toEqual({
      from: "2026-10-26T00:00:00-04:00",
      to: "2026-11-02T00:00:00-05:00",
    })
  })
})

describe("views", () => {
  it("knows the calendar's views and which need a licence", () => {
    expect(isCalendarView("dayGridMonth")).toBe(true)
    expect(isCalendarView("multiMonthYear")).toBe(false)
    expect(isResourceView("resourceTimelineWeek")).toBe(true)
    expect(isResourceView("timeGridWeek")).toBe(false)
  })

  it("shows the requested view, or the week view when it needs a licence the build lacks", () => {
    expect(resolveView(null, false)).toBe("timeGridWeek")
    expect(resolveView("dayGridMonth", false)).toBe("dayGridMonth")
    expect(resolveView("resourceTimelineWeek", true)).toBe("resourceTimelineWeek")
    expect(resolveView("resourceTimelineWeek", false)).toBe("timeGridWeek")
  })

  it("draws open time only where there is a time axis", () => {
    expect(showsOpenTime("timeGridWeek")).toBe(true)
    expect(showsOpenTime("timeGridDay")).toBe(true)
    expect(showsOpenTime("resourceTimelineDay")).toBe(true)
    expect(showsOpenTime("dayGridMonth")).toBe(false)
    expect(showsOpenTime("listWeek")).toBe(false)
  })

  it("treats a blank licence key as no key", () => {
    expect(schedulerLicenseKey(undefined)).toBeNull()
    expect(schedulerLicenseKey("  ")).toBeNull()
    expect(schedulerLicenseKey(" abc ")).toBe("abc")
  })
})

describe("sameScope", () => {
  const base = { location: "l1", from: "a", to: "b" }

  it("ignores the dates", () => {
    const nextWeek = { ...base, from: "c", to: "d" }
    expect(sameScope(base, nextWeek)).toBe(true)
  })

  it("compares the location and the resource filter", () => {
    expect(sameScope(base, { ...base, location: "l2" })).toBe(false)
    expect(sameScope({ ...base, resource: "r1" }, base)).toBe(false)
    expect(sameScope({ ...base, resource: undefined }, base)).toBe(true)
    expect(sameScope({ ...base, resources: ["r1", "r2"] }, { ...base, resources: ["r1", "r2"] })).toBe(true)
    expect(sameScope({ ...base, resources: ["r1", "r2"] }, { ...base, resources: ["r1"] })).toBe(false)
  })

  it("is false without both", () => {
    expect(sameScope(null, base)).toBe(false)
    expect(sameScope(base, undefined)).toBe(false)
  })
})

describe("bookingEvent", () => {
  it("links to the booking and names the service and resource in the plain calendar", () => {
    const event = bookingEvent(booking(), { resourceView: false })
    expect(event).toMatchObject({
      id: "b1",
      title: "Haircut · Anna",
      start: "2026-10-22T09:00:00+02:00",
      end: "2026-10-22T09:45:00+02:00",
      url: "/bookings/b1",
      extendedProps: { kind: "booking", status: "confirmed", label: "Haircut · Anna" },
    })
    expect(event.resourceId).toBeUndefined()
    expect(event.color).toBeUndefined()
    expect(event.className).toBeUndefined()
  })

  it("places the event in its resource's row in resource views", () => {
    const event = bookingEvent(booking(), { resourceView: true })
    expect(event.title).toBe("Haircut")
    expect(event.resourceId).toBe("r1")
  })

  it("puts a booking without a resource in the No resource row", () => {
    const event = bookingEvent(booking({ service: null, resource: null }), { resourceView: true })
    expect(event.title).toBe("Booking")
    expect(event.resourceId).toBe(NO_RESOURCE_ID)
  })

  it("marks temporary bookings by colour, italics and label", () => {
    expect(bookingEvent(booking({ is_temporary: true }), { resourceView: false })).toMatchObject({
      color: CALENDAR_COLORS.temporary,
      contrastColor: "black",
      className: "italic",
      extendedProps: { status: "temporary", label: "Haircut · Anna (temporary)" },
    })
  })

  it("marks canceled bookings by colour, strike-through and label, without fading their text", () => {
    const event = bookingEvent(booking({ is_temporary: true, is_canceled: true }), { resourceView: false })
    expect(event).toMatchObject({
      color: CALENDAR_COLORS.canceled,
      contrastColor: "var(--background)",
      className: "line-through",
      extendedProps: { status: "canceled", label: "Haircut · Anna (canceled)" },
    })
  })
})

describe("openTimeEvents", () => {
  const spans = [
    { starts_at: "2026-10-19T09:00:00+02:00", ends_at: "2026-10-19T17:00:00+02:00" },
    { starts_at: "2026-10-26T09:00:00+01:00", ends_at: "2026-10-26T17:00:00+01:00" },
  ]

  it("shades open time as background events named for screen readers", () => {
    const events = openTimeEvents(spans, { timeZone: "Europe/Stockholm" })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      start: spans[0].starts_at,
      end: spans[0].ends_at,
      display: "background",
      color: CALENDAR_COLORS.open,
      extendedProps: { kind: "open", label: "Open · Mon 19 Oct 09:00–17:00" },
    })
    // After the clocks went back.
    expect(events[1].extendedProps).toMatchObject({ label: "Open · Mon 26 Oct 09:00–17:00" })
    expect(events[0]).not.toHaveProperty("resourceId")
    expect(new Set(events.map((e) => e.id)).size).toBe(2)
  })

  it("labels spans in the location's zone, including overnight ones", () => {
    const [event] = openTimeEvents(
      [{ starts_at: "2026-10-29T22:00:00-04:00", ends_at: "2026-10-30T02:00:00-04:00" }],
      { timeZone: "America/New_York" }
    )
    expect(event.extendedProps).toMatchObject({ label: "Open · Thu 29 Oct 22:00 – Fri 30 Oct 02:00" })
  })

  it("assigns the resource in resource views, with ids unique across resources", () => {
    const a = openTimeEvents(spans, { resourceId: "r1" })
    const b = openTimeEvents(spans, { resourceId: "r2" })
    expect(a[0].resourceId).toBe("r1")
    expect(a[0].id).not.toBe(b[0].id)
  })

  it("is empty while loading", () => {
    expect(openTimeEvents(undefined, { resourceId: "r1" })).toEqual([])
  })
})

describe("calendarResources", () => {
  const all = [resource("r2", "Room A"), resource("r1", "Anna"), resource("r3", "Old room", false)]

  it("lists the enabled resources by name", () => {
    expect(calendarResources(all)).toEqual([
      { id: "r1", title: "Anna", order: 0 },
      { id: "r2", title: "Room A", order: 1 },
    ])
  })

  it("shows only the filtered resource, even when disabled", () => {
    expect(calendarResources(all, { only: "r3" })).toEqual([{ id: "r3", title: "Old room (disabled)", order: 0 }])
  })

  it("adds a row for every booking in view, so none is hidden", () => {
    const rows = calendarResources(all, {
      bookings: [
        booking({ resource: all[2] }), // disabled
        booking({ resource: resource("r9", "Gone") }), // no longer in the resource list
        booking({ resource: null }),
        booking(), // Anna, already a row
      ],
    })
    expect(rows).toEqual([
      { id: "r1", title: "Anna", order: 0 },
      { id: "r9", title: "Gone", order: 1 },
      { id: "r3", title: "Old room (disabled)", order: 2 },
      { id: "r2", title: "Room A", order: 3 },
      { id: NO_RESOURCE_ID, title: "No resource", order: 4 },
    ])
  })
})
