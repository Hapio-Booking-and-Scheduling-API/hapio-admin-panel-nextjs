import { parseAsString, parseAsStringLiteral, type Values } from "nuqs"

import { parseAsFilterRows, rowsToParams, type FilterFieldDef } from "@/components/filters/advanced-filters-model"
import type { BookingListParams } from "@/lib/hapio/client"

export const INCLUSION = ["exclude", "include", "only"] as const

/**
 * URL state shared by the bookings and booking-groups lists. The `location`,
 * `resource` and `service` keys are a public contract: other pages link to
 * e.g. `/bookings?location=<id>`.
 */
export const BOOKING_FILTER_PARSERS = {
  from: parseAsString,
  to: parseAsString,
  location: parseAsString,
  resource: parseAsString,
  service: parseAsString,
  // The API hides temporary and canceled bookings by default; an admin wants to see everything.
  temporary: parseAsStringLiteral(INCLUSION).withDefault("include"),
  canceled: parseAsStringLiteral(INCLUSION).withDefault("include"),
  f: parseAsFilterRows,
}

export type BookingFilters = Values<typeof BOOKING_FILTER_PARSERS>

export function bookingFilterParams(filters: BookingFilters, fields: FilterFieldDef[]): BookingListParams {
  return {
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    location: filters.location ?? undefined,
    resource: filters.resource ?? undefined,
    service: filters.service ?? undefined,
    temporary: filters.temporary,
    canceled: filters.canceled,
    ...rowsToParams(filters.f, fields),
  }
}

export function bookingFiltersActive(filters: BookingFilters): boolean {
  return (
    !!filters.from ||
    !!filters.to ||
    !!filters.location ||
    !!filters.resource ||
    !!filters.service ||
    filters.temporary !== "include" ||
    filters.canceled !== "include" ||
    !!filters.f?.length
  )
}
