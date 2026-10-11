/**
 * Facts about the mock's demo data when "now" is E2E_NOW (Wed 21 Oct 2026 08:00,
 * Europe/Stockholm) and MOCK_SEED=1. Ids are not listed: look them up by name.
 */
export const SEED = {
  project: "Demo project",
  locations: {
    stockholm: { name: "Stockholm Studio", timeZone: "Europe/Stockholm", strategy: "prioritize" },
    newYork: { name: "New York Loft", timeZone: "America/New_York", strategy: "randomize" },
  },
  resources: {
    anna: { name: "Anna", max: 1 },
    ben: { name: "Ben", max: 1 },
    roomA: { name: "Room A", max: 2 },
  },
  services: {
    haircut: { name: "Haircut", type: "fixed", duration: "PT45M", price: "450.000", bufferAfter: "PT15M" },
    studio: { name: "Studio rental", type: "flexible", min: "PT1H", max: "PT4H", step: "PT30M", price: "300.000" },
    equipment: { name: "Equipment rental", type: "day", start: "09:00:00", end: "17:00:00", minDays: 1, maxDays: 7, price: "150.000" },
  },
  /** Priority order at Stockholm Studio. */
  priority: ["Anna", "Ben", "Room A"],
  /** All 13 bookings, by customer name, in start order. */
  bookings: [
    { customer: "Maja Holm", startsAt: "2026-10-14T10:00:00+02:00", service: "Haircut", resource: "Anna" },
    { customer: "Oskar Berg", startsAt: "2026-10-15T14:00:00+02:00", service: "Haircut", resource: "Ben" },
    { customer: "Lumen Collective", startsAt: "2026-10-16T10:00:00+02:00", service: "Studio rental", resource: "Room A" },
    { customer: "Sara Ek", startsAt: "2026-10-20T15:00:00+02:00", service: "Haircut", resource: "Anna", canceled: true },
    { customer: "Erik Lund", startsAt: "2026-10-22T09:00:00+02:00", service: "Haircut", resource: "Anna" },
    { customer: "Nora Falk", startsAt: "2026-10-22T14:00:00+02:00", service: "Haircut", resource: "Ben" },
    { customer: "Pixel & Co", startsAt: "2026-10-23T09:30:00+02:00", service: "Studio rental", resource: "Room A" },
    { customer: "Fotostudion AB", startsAt: "2026-10-26T09:00:00+01:00", service: "Equipment rental", resource: "Room A" },
    { customer: "Ida Strand", startsAt: "2026-10-27T10:00:00+01:00", service: "Haircut", resource: "Anna", temporary: true },
    { customer: "Jamie Carter", startsAt: "2026-10-29T10:00:00-04:00", service: "Haircut", resource: "Anna", location: "New York Loft" },
    { customer: "Leo Wik", startsAt: "2026-11-02T15:00:00+01:00", service: "Haircut", resource: "Ben", temporary: true },
    { customer: "Alva Lindqvist", startsAt: "2026-11-03T10:00:00+01:00", service: "Haircut", resource: "Anna", group: true },
    { customer: "Elias Lindqvist", startsAt: "2026-11-03T10:00:00+01:00", service: "Haircut", resource: "Ben", group: true },
  ],
  /** The seed booking group. */
  group: { metadata: { party: "Lindqvist", note: "Siblings, book together" }, bookings: 2 },
  /** Dashboard at E2E_NOW. */
  dashboard: { upcoming7Days: 5, locations: 2, resources: 3, services: 3, awaiting: ["Ida Strand", "Leo Wik"] },
  /** Blocked (unavailable) schedule blocks next week, at Stockholm Studio. */
  blocked: [
    { resource: "Ben", startsAt: "2026-10-27T09:00:00+01:00", endsAt: "2026-10-27T12:00:00+01:00" },
    { resource: "Anna", startsAt: "2026-10-28T12:00:00+01:00", endsAt: "2026-10-28T14:00:00+01:00" },
    { resource: "Room A", startsAt: "2026-10-29T13:00:00+01:00", endsAt: "2026-10-29T17:00:00+01:00" },
  ],
  /** Recurring schedules: Mon–Fri 09:00–17:00 from this date, no end. */
  recurringFrom: "2026-09-21",
} as const
