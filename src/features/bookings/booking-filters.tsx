"use client"

import { parseAsString, parseAsStringLiteral } from "nuqs"

import { useListFilters } from "@/components/data-table/use-list-state"
import {
  AdvancedFilters,
  parseAsFilterRows,
  rowsToParams,
  type FilterFieldDef,
} from "@/components/filters/advanced-filters"
import { FilterBar } from "@/components/filters/filter-bar"
import { SortSelect, sortOptions } from "@/components/filters/sort-select"
import { TriStateFilter } from "@/components/filters/tri-state-filter"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import type { BookingListParams } from "@/lib/hapio/client"
import { indexById, useAllLocations } from "@/lib/hapio/hooks"

import { DateRangeFilter } from "./date-range-filter"
import { BOOKING_SORT_FIELDS } from "./utils"

const INCLUSION = ["exclude", "include", "only"] as const

/**
 * URL state shared by the bookings and booking-groups lists. The `location`,
 * `resource` and `service` keys are a public contract: other pages link to
 * e.g. `/bookings?location=<id>`.
 */
const BOOKING_FILTER_PARSERS = {
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

export function useBookingFilters() {
  return useListFilters(BOOKING_FILTER_PARSERS)
}

type BookingFilterState = ReturnType<typeof useBookingFilters>
export type BookingFilters = BookingFilterState[0]
type SetBookingFilters = BookingFilterState[1]

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

const SORT_OPTIONS = sortOptions(BOOKING_SORT_FIELDS)

export function BookingFilterBar({
  filters,
  setFilters,
  onReset,
  fields,
  sort,
  onSortChange,
}: {
  filters: BookingFilters
  setFilters: SetBookingFilters
  onReset: () => void
  fields: FilterFieldDef[]
  sort: string
  onSortChange: (sort: string) => void
}) {
  const locations = useAllLocations()
  const zone = filters.location ? indexById(locations.data).get(filters.location)?.time_zone : undefined

  return (
    <FilterBar onReset={onReset} canReset={bookingFiltersActive(filters)}>
      <DateRangeFilter
        value={{ from: filters.from, to: filters.to }}
        timeZone={zone}
        onChange={({ from, to }) => setFilters({ from, to })}
      />
      <div className="w-full sm:w-44">
        <EntityCombobox
          kind="location"
          size="sm"
          clearable
          placeholder="Any location"
          value={filters.location}
          onChange={(location) => setFilters({ location })}
        />
      </div>
      <div className="w-full sm:w-44">
        <EntityCombobox
          kind="resource"
          size="sm"
          clearable
          placeholder="Any resource"
          value={filters.resource}
          onChange={(resource) => setFilters({ resource })}
        />
      </div>
      <div className="w-full sm:w-44">
        <EntityCombobox
          kind="service"
          size="sm"
          clearable
          placeholder="Any service"
          value={filters.service}
          onChange={(service) => setFilters({ service })}
        />
      </div>
      <TriStateFilter noun="temporary" value={filters.temporary} onChange={(temporary) => setFilters({ temporary })} />
      <TriStateFilter noun="canceled" value={filters.canceled} onChange={(canceled) => setFilters({ canceled })} />
      <AdvancedFilters fields={fields} value={filters.f} onChange={(f) => setFilters({ f })} />
      <SortSelect value={sort} onChange={onSortChange} options={SORT_OPTIONS} />
    </FilterBar>
  )
}
