// Test data shaped like Hapio API responses, for the bookings unit tests.

import type { Booking, BookingEmbedded, Location, Resource, ServiceDay, ServiceFixed, ServiceFlexible } from "@/lib/hapio/types"

const TS = { created_at: "2026-09-30T10:00:00+02:00", updated_at: "2026-09-30T10:00:00+02:00" }

export const STOCKHOLM: Location = {
  ...TS,
  id: "11111111-1111-4111-8111-111111111111",
  name: "Stockholm Studio",
  time_zone: "Europe/Stockholm",
  resource_selection_strategy: "prioritize",
  metadata: null,
  enabled: true,
}

export const NEW_YORK: Location = {
  ...STOCKHOLM,
  id: "22222222-2222-4222-8222-222222222222",
  name: "New York Loft",
  time_zone: "America/New_York",
  resource_selection_strategy: "randomize",
}

export const ANNA: Resource = {
  ...TS,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Anna",
  max_simultaneous_bookings: 1,
  metadata: null,
  enabled: true,
}

export const BEN: Resource = { ...ANNA, id: "44444444-4444-4444-8444-444444444444", name: "Ben" }

const SERVICE_COMMON = {
  ...TS,
  price: "450.000",
  buffer_time_before: "PT0S",
  buffer_time_after: "PT15M",
  booking_window_start: "PT0S",
  booking_window_end: null,
  cancelation_threshold: "PT0S",
  metadata: null,
  enabled: true,
}

export const HAIRCUT: ServiceFixed = {
  ...SERVICE_COMMON,
  id: "55555555-5555-4555-8555-555555555555",
  name: "Haircut",
  type: "fixed",
  duration: "PT45M",
  bookable_interval: null,
}

export const STUDIO: ServiceFlexible = {
  ...SERVICE_COMMON,
  id: "66666666-6666-4666-8666-666666666666",
  name: "Studio rental",
  type: "flexible",
  price: "300.000",
  buffer_time_after: "PT0S",
  min_duration: "PT1H",
  max_duration: "PT4H",
  default_duration: null,
  duration_step: "PT30M",
  bookable_interval: null,
}

export const EQUIPMENT: ServiceDay = {
  ...SERVICE_COMMON,
  id: "77777777-7777-4777-8777-777777777777",
  name: "Equipment rental",
  type: "day",
  price: "150.000",
  buffer_time_after: "PT0S",
  start_time: "09:00:00",
  end_time: "17:00:00",
  min_days: 1,
  max_days: 7,
  default_days: null,
}

export const GROUP_ID = "88888888-8888-4888-8888-888888888888"

export function embeddedBooking(overrides: Partial<BookingEmbedded> = {}): BookingEmbedded {
  return {
    ...TS,
    id: "99999999-9999-4999-8999-999999999999",
    resource: ANNA,
    service: HAIRCUT,
    location: STOCKHOLM,
    price: "450.000",
    metadata: { customer: { name: "Erik Lund" } },
    protected_metadata: null,
    is_temporary: false,
    is_canceled: false,
    starts_at: "2026-10-22T09:00:00+02:00",
    ends_at: "2026-10-22T09:45:00+02:00",
    buffer_starts_at: "2026-10-22T09:00:00+02:00",
    buffer_ends_at: "2026-10-22T10:00:00+02:00",
    finalized_at: "2026-09-30T10:00:00+02:00",
    canceled_at: null,
    ...overrides,
  }
}

export function booking(overrides: Partial<Booking> = {}): Booking {
  return { ...embeddedBooking(overrides), booking_group: null, ...overrides }
}
