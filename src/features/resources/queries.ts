"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import {
  hapio,
  type FullyBookedParams,
  type RecurringScheduleListParams,
  type ResourceScheduleParams,
  type ScheduleBlockListParams,
} from "@/lib/hapio/client"
import { hapioKey } from "@/lib/hapio/hooks"
import type { Paginated, Uuid } from "@/lib/hapio/types"

/** Loads every page (up to `maxPages`) of a paginated endpoint. */
async function fetchPages<T>(load: (page: number) => Promise<Paginated<T>>, maxPages = 10): Promise<T[]> {
  const first = await load(1)
  const items = [...first.data]
  const last = Math.min(first.meta.last_page, maxPages)
  for (let page = 2; page <= last; page++) {
    items.push(...(await load(page)).data)
  }
  return items
}

export function useResourceServices(resourceId: Uuid) {
  return useQuery({
    queryKey: hapioKey("resources", resourceId, "services"),
    queryFn: ({ signal }) => hapio.resources.services.list(resourceId, signal),
  })
}

export function useScheduleBlocks(
  resourceId: Uuid,
  params: ScheduleBlockListParams,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: hapioKey("resources", resourceId, "schedule-blocks", params),
    queryFn: ({ signal }) => hapio.scheduleBlocks(resourceId).list(params, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled,
  })
}

export function useRecurringSchedules(
  resourceId: Uuid,
  params: RecurringScheduleListParams,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: hapioKey("resources", resourceId, "recurring-schedules", params),
    queryFn: ({ signal }) => hapio.recurringSchedules(resourceId).list(params, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled,
  })
}

export function useRecurringScheduleBlocks(resourceId: Uuid, scheduleId: Uuid) {
  return useQuery({
    queryKey: hapioKey("resources", resourceId, "recurring-schedules", scheduleId, "blocks"),
    queryFn: ({ signal }) =>
      fetchPages((page) =>
        hapio.recurringScheduleBlocks(resourceId, scheduleId).list({ page, per_page: 100 }, signal)
      ),
  })
}

/** The computed open time of a resource at a location (all pages). */
export function useResourceSchedule(resourceId: Uuid, params: Omit<ResourceScheduleParams, "page" | "per_page"> | null) {
  return useQuery({
    queryKey: hapioKey("resources", resourceId, "schedule", params),
    queryFn: ({ signal }) =>
      fetchPages((page) => hapio.resources.schedule(resourceId, { ...params!, page, per_page: 100 }, signal), 5),
    enabled: !!params,
    placeholderData: keepPreviousData,
  })
}

/** Fully booked spans of a resource (all pages). */
export function useResourceFullyBooked(resourceId: Uuid, params: Omit<FullyBookedParams, "page" | "per_page"> | null) {
  return useQuery({
    queryKey: hapioKey("resources", resourceId, "fully-booked", params),
    queryFn: ({ signal }) =>
      fetchPages((page) => hapio.resources.fullyBooked(resourceId, { ...params!, page, per_page: 100 }, signal), 5),
    enabled: !!params,
    placeholderData: keepPreviousData,
  })
}
