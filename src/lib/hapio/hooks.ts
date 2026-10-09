"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import { toast } from "sonner"

import {
  hapio,
  type BookingGroupListParams,
  type BookingListParams,
  type LocationListParams,
  type ResourceListParams,
  type ServiceListParams,
} from "./client"
import { describeError, isHapioError } from "./errors"
import type { Location, Paginated, Resource, Service, Uuid } from "./types"

/** All Hapio query keys start with "hapio", so a mutation can refresh everything at once. */
export const hapioKey = (...parts: unknown[]): QueryKey => ["hapio", ...parts]

// ---------------------------------------------------------------------------
// Mutations

interface HapioMutationOptions<TData, TVars> {
  /** Toast shown on success. */
  success?: string | ((data: TData, vars: TVars) => string)
  /** Show a toast for errors (default true). Set to false when the form shows them inline. */
  toastErrors?: boolean | ((error: unknown) => boolean)
  onSuccess?: (data: TData, vars: TVars) => void | Promise<void>
  onError?: (error: unknown, vars: TVars) => void
}

/**
 * Wraps useMutation with toasts and a refresh of every active Hapio query.
 * Entities embed each other (bookings embed resources, services, locations),
 * so a blanket refresh keeps every visible view consistent.
 */
export function useHapioMutation<TData, TVars = void>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options: HapioMutationOptions<TData, TVars> = {}
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async (data, vars) => {
      if (options.success) {
        toast.success(
          typeof options.success === "function" ? options.success(data, vars) : options.success
        )
      }
      await options.onSuccess?.(data, vars)
      await queryClient.invalidateQueries({ queryKey: ["hapio"] })
    },
    onError: (error, vars) => {
      const shouldToast =
        typeof options.toastErrors === "function"
          ? options.toastErrors(error)
          : options.toastErrors ?? true
      if (shouldToast) toast.error(describeError(error))
      options.onError?.(error, vars)
    },
  })
}

/** Don't toast 422s that carry field errors; the form shows those inline. */
export const toastUnlessFieldErrors = (error: unknown) =>
  !(isHapioError(error) && error.status === 422 && error.errors && Object.keys(error.errors).length)

// ---------------------------------------------------------------------------
// Queries

export function useProject() {
  return useQuery({
    queryKey: hapioKey("project"),
    queryFn: ({ signal }) => hapio.project.get(signal),
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export function useLocations(params: LocationListParams) {
  return useQuery({
    queryKey: hapioKey("locations", "list", params),
    queryFn: ({ signal }) => hapio.locations.list(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useLocation(id: Uuid | null | undefined) {
  return useQuery({
    queryKey: hapioKey("locations", "detail", id),
    queryFn: ({ signal }) => hapio.locations.get(id!, signal),
    enabled: !!id,
  })
}

export function useResources(params: ResourceListParams) {
  return useQuery({
    queryKey: hapioKey("resources", "list", params),
    queryFn: ({ signal }) => hapio.resources.list(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useResource(id: Uuid | null | undefined) {
  return useQuery({
    queryKey: hapioKey("resources", "detail", id),
    queryFn: ({ signal }) => hapio.resources.get(id!, signal),
    enabled: !!id,
  })
}

export function useServices(params: ServiceListParams) {
  return useQuery({
    queryKey: hapioKey("services", "list", params),
    queryFn: ({ signal }) => hapio.services.list(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useService(id: Uuid | null | undefined) {
  return useQuery({
    queryKey: hapioKey("services", "detail", id),
    queryFn: ({ signal }) => hapio.services.get(id!, signal),
    enabled: !!id,
  })
}

export function useBookings(params: BookingListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: hapioKey("bookings", "list", params),
    queryFn: ({ signal }) => hapio.bookings.list(params, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled,
  })
}

export function useBooking(id: Uuid | null | undefined) {
  return useQuery({
    queryKey: hapioKey("bookings", "detail", id),
    queryFn: ({ signal }) => hapio.bookings.get(id!, signal),
    enabled: !!id,
  })
}

export function useBookingGroups(params: BookingGroupListParams) {
  return useQuery({
    queryKey: hapioKey("booking-groups", "list", params),
    queryFn: ({ signal }) => hapio.bookingGroups.list(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useBookingGroup(id: Uuid | null | undefined) {
  return useQuery({
    queryKey: hapioKey("booking-groups", "detail", id),
    queryFn: ({ signal }) => hapio.bookingGroups.get(id!, signal),
    enabled: !!id,
  })
}

// ---------------------------------------------------------------------------
// "All" lists for pickers. The API has no "contains" filter, so pickers load
// every item (including disabled ones) and filter client-side.

const MAX_PAGES = 20

async function fetchAll<T>(
  load: (page: number, signal?: AbortSignal) => Promise<Paginated<T>>,
  signal?: AbortSignal
): Promise<T[]> {
  const first = await load(1, signal)
  const items = [...first.data]
  const last = Math.min(first.meta.last_page, MAX_PAGES)
  for (let page = 2; page <= last; page++) {
    const next = await load(page, signal)
    items.push(...next.data)
  }
  return items
}

export function useAllLocations() {
  return useQuery({
    queryKey: hapioKey("locations", "all"),
    queryFn: ({ signal }) =>
      fetchAll<Location>(
        (page, s) => hapio.locations.list({ page, per_page: 100, disabled: "include" }, s),
        signal
      ),
    staleTime: 60_000,
  })
}

export function useAllResources() {
  return useQuery({
    queryKey: hapioKey("resources", "all"),
    queryFn: ({ signal }) =>
      fetchAll<Resource>(
        (page, s) => hapio.resources.list({ page, per_page: 100, disabled: "include" }, s),
        signal
      ),
    staleTime: 60_000,
  })
}

export function useAllServices() {
  return useQuery({
    queryKey: hapioKey("services", "all"),
    queryFn: ({ signal }) =>
      fetchAll<Service>(
        (page, s) => hapio.services.list({ page, per_page: 100, disabled: "include" }, s),
        signal
      ),
    staleTime: 60_000,
  })
}

/** Lookup map id → entity from an "all" query. */
export function indexById<T extends { id: Uuid }>(items: T[] | undefined): Map<Uuid, T> {
  return new Map((items ?? []).map((item) => [item.id, item]))
}
