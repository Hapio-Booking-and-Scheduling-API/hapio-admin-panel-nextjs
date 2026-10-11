"use client"

import { useListFilters } from "@/components/data-table/use-list-state"
import { AdvancedFilters, type FilterFieldDef } from "@/components/filters/advanced-filters"
import { FilterBar } from "@/components/filters/filter-bar"
import { SortSelect, sortOptions } from "@/components/filters/sort-select"
import { TriStateFilter } from "@/components/filters/tri-state-filter"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { indexById, useAllLocations } from "@/lib/hapio/hooks"

import { BOOKING_FILTER_PARSERS, bookingFiltersActive, type BookingFilters } from "./booking-filters-model"
import { DateRangeFilter } from "./date-range-filter"
import { BOOKING_SORT_FIELDS } from "./utils"

export { bookingFilterParams, bookingFiltersActive, type BookingFilters } from "./booking-filters-model"

export function useBookingFilters() {
  return useListFilters(BOOKING_FILTER_PARSERS)
}

type SetBookingFilters = ReturnType<typeof useBookingFilters>[1]

const SORT_OPTIONS = sortOptions(BOOKING_SORT_FIELDS)

export function BookingFilterBar({
  filters,
  setFilters,
  onReset,
  fields,
  sort,
  onSortChange,
  sortFields,
}: {
  filters: BookingFilters
  setFilters: SetBookingFilters
  onReset: () => void
  fields: FilterFieldDef[]
  sort: string
  onSortChange: (sort: string) => void
  /** The sorts the list's endpoint accepts (default: the bookings sorts). */
  sortFields?: Array<[key: string, label: string]>
}) {
  const locations = useAllLocations()
  const options = sortFields ? sortOptions(sortFields) : SORT_OPTIONS
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
          aria-label="Location filter"
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
          aria-label="Resource filter"
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
          aria-label="Service filter"
          value={filters.service}
          onChange={(service) => setFilters({ service })}
        />
      </div>
      <TriStateFilter noun="temporary" value={filters.temporary} onChange={(temporary) => setFilters({ temporary })} />
      <TriStateFilter noun="canceled" value={filters.canceled} onChange={(canceled) => setFilters({ canceled })} />
      <AdvancedFilters fields={fields} value={filters.f} onChange={(f) => setFilters({ f })} />
      <SortSelect value={sort} onChange={onSortChange} options={options} />
    </FilterBar>
  )
}
