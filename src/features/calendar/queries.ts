"use client"

import type { QueryKey } from "@tanstack/react-query"

import { hapio } from "@/lib/hapio/client"
import { CONCURRENCY, fetchAll, fetchPages, inBatches } from "@/lib/hapio/fetch-all"
import { hapioKey } from "@/lib/hapio/hooks"
import type { Booking, TimeSpan, Uuid } from "@/lib/hapio/types"
import { useHapioQuery } from "@/lib/hapio/use-hapio-query"

import { sameScope } from "./calendar-model"

export interface CalendarBookingsParams {
  location: Uuid
  from: string
  to: string
  resource?: Uuid
}

export interface OpenTimeParams {
  location: Uuid
  from: string
  to: string
  resources: Uuid[]
}

/** The params part of a `hapioKey(a, b, params)` key. */
const paramsOf = <T>(key: QueryKey | undefined) => key?.[3] as T | null | undefined

/**
 * Every booking at a location in the visible range, in start order (so if the range holds more
 * than fetchPages loads, the latest are the ones missing, and `truncated` says so). Canceled
 * bookings are always loaded and hidden by the page, so "Show canceled" doesn't refetch.
 */
export function useCalendarBookings(params: CalendarBookingsParams | null) {
  return useHapioQuery({
    queryKey: hapioKey("bookings", "calendar", params),
    queryFn: ({ signal }) =>
      fetchPages<Booking>(
        (page, s) =>
          hapio.bookings.list(
            {
              ...params!,
              temporary: "include",
              canceled: "include",
              sort: "starts_at.asc",
              page,
              per_page: 100,
            },
            s
          ),
        { signal }
      ),
    enabled: !!params,
    // While the next range loads, keep this one's bookings, but never another location's or resource's.
    placeholderData: (previous, previousQuery) =>
      sameScope(paramsOf<CalendarBookingsParams>(previousQuery?.queryKey), params) ? previous : undefined,
  })
}

/**
 * Each resource's open time at a location. Hapio has no cross-resource schedule endpoint, so
 * this loads one schedule per resource, a few at a time. Schedules rarely change (and every edit
 * in the panel refreshes all queries), so the result stays fresh for five minutes.
 */
export function useCalendarOpenTime(params: OpenTimeParams | null) {
  return useHapioQuery({
    queryKey: hapioKey("calendar", "open-time", params),
    queryFn: async ({ signal }) => {
      const { resources, ...range } = params!
      const spans = await inBatches(resources, CONCURRENCY, (id) =>
        fetchAll<TimeSpan>(
          (page, s) => hapio.resources.schedule(id, { ...range, fully_booked: "exclude", page, per_page: 100 }, s),
          signal
        )
      )
      return Object.fromEntries(resources.map((id, i) => [id, spans[i]])) as Record<Uuid, TimeSpan[]>
    },
    enabled: !!params?.resources.length,
    staleTime: 5 * 60_000,
    placeholderData: (previous, previousQuery) =>
      sameScope(paramsOf<OpenTimeParams>(previousQuery?.queryKey), params) ? previous : undefined,
  })
}
