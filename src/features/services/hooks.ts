"use client"

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"

import { hapio, type BookableSlotParams } from "@/lib/hapio/client"
import { hapioKey } from "@/lib/hapio/hooks"
import type { Uuid } from "@/lib/hapio/types"

/** Resources associated with a service (not paginated). */
export function useServiceResources(serviceId: Uuid) {
  return useQuery({
    queryKey: hapioKey("services", serviceId, "resources"),
    queryFn: ({ signal }) => hapio.services.resources.list(serviceId, signal),
  })
}

export const SLOTS_PER_PAGE = 100

/** Bookable slots, loaded page by page. Disabled until `params` is set. */
export function useBookableSlots(
  serviceId: Uuid,
  params: Omit<BookableSlotParams, "page" | "per_page"> | null
) {
  return useInfiniteQuery({
    queryKey: hapioKey("services", serviceId, "bookable-slots", params),
    queryFn: ({ pageParam, signal }) =>
      hapio.services.bookableSlots(serviceId, { ...params!, page: pageParam, per_page: SLOTS_PER_PAGE }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined,
    enabled: !!params,
    staleTime: 15_000,
  })
}
