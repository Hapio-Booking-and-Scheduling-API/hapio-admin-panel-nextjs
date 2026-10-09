// Typed client for every Hapio API operation. Requests go through the local
// proxy at /api/hapio, which adds the API token server-side.

import { HapioApiError } from "./errors"
import { buildQuery, type MetadataFilter, type OperatorFilter, type QueryParams } from "./query"
import { recordRateLimit } from "./rate-limit"
import type {
  AnyBookableSlot,
  Booking,
  BookingGroup,
  BookingGroupPatch,
  BookingGroupPost,
  BookingGroupPut,
  BookingPatch,
  BookingPost,
  BookingPut,
  DateString,
  DateTimeString,
  Duration,
  InclusionFilter,
  Location,
  LocationInput,
  LocationPatch,
  Paginated,
  Project,
  RecurringSchedule,
  RecurringScheduleBlock,
  RecurringScheduleBlockInput,
  RecurringScheduleBlockPatch,
  RecurringScheduleInput,
  RecurringSchedulePatch,
  Resource,
  ResourceInput,
  ResourcePatch,
  ResourceSelectionStrategy,
  ResourceService,
  ScheduleBlock,
  ScheduleBlockInput,
  ScheduleBlockPatch,
  Service,
  ServiceInput,
  ServicePatch,
  ServiceType,
  TimeSpan,
  Uuid,
  Weekday,
} from "./types"

export const PROXY_BASE = "/api/hapio"

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export async function hapioFetch<T>(
  method: Method,
  path: string,
  options: { query?: QueryParams; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const url = `${PROXY_BASE}/${path.replace(/^\/+/, "")}${buildQuery(options.query)}`
  const headers: Record<string, string> = {
    Accept: "application/json",
    // Custom header forces a CORS preflight, so other sites can't drive the proxy.
    "X-Hapio-Admin": "1",
  }
  if (options.body !== undefined) headers["Content-Type"] = "application/json"

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause
    throw new HapioApiError({ status: 0, message: "Network error: could not reach the admin server." })
  }

  recordRateLimit(response.headers)

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text.slice(0, 300) }
    }
  }

  if (!response.ok) {
    const body = (data ?? {}) as {
      message?: string
      code?: string
      errors?: Record<string, string[]>
      messages?: Record<string, string>
    }
    const retryAfter = response.headers.get("retry-after")
    throw new HapioApiError({
      status: response.status,
      message: body.message ?? response.statusText,
      code: body.code,
      errors: body.errors,
      messages: body.messages,
      retryAfter: retryAfter ? Number(retryAfter) : undefined,
    })
  }

  return data as T
}

// ---------------------------------------------------------------------------
// List filter parameter types

export interface PageParams {
  page?: number
  per_page?: number
  sort?: string
}

interface MetadataParams {
  metadata?: MetadataFilter[]
  protected_metadata?: MetadataFilter[]
}

interface TimestampParams {
  created_at?: OperatorFilter
  updated_at?: OperatorFilter
}

export interface LocationListParams extends PageParams, MetadataParams, TimestampParams {
  disabled?: InclusionFilter
  name?: OperatorFilter
  timezone?: string
  resource_selection_strategy?: ResourceSelectionStrategy
}

export interface ResourceListParams extends PageParams, MetadataParams, TimestampParams {
  disabled?: InclusionFilter
  name?: OperatorFilter
  max_simultaneous_bookings?: OperatorFilter<number>
}

export interface ServiceListParams extends PageParams, MetadataParams, TimestampParams {
  disabled?: InclusionFilter
  name?: OperatorFilter
  price?: OperatorFilter
  type?: ServiceType
}

export interface BookingListParams extends PageParams, MetadataParams, TimestampParams {
  from?: DateTimeString
  to?: DateTimeString
  resource?: Uuid
  service?: Uuid
  location?: Uuid
  temporary?: InclusionFilter
  canceled?: InclusionFilter
  price?: OperatorFilter
  starts_at?: OperatorFilter
  ends_at?: OperatorFilter
  buffer_starts_at?: OperatorFilter
  buffer_ends_at?: OperatorFilter
  finalized_at?: OperatorFilter
  canceled_at?: OperatorFilter
}

export interface BookingGroupListParams extends BookingListParams {
  group_metadata?: MetadataFilter[]
  group_protected_metadata?: MetadataFilter[]
  group_created_at?: OperatorFilter
  group_updated_at?: OperatorFilter
}

export interface ScheduleBlockListParams extends PageParams, TimestampParams {
  from?: DateTimeString
  to?: DateTimeString
  location?: Uuid
  starts_at?: OperatorFilter
  ends_at?: OperatorFilter
}

export interface RecurringScheduleListParams extends PageParams, TimestampParams {
  from?: DateString
  to?: DateString
  location?: Uuid
  start_date?: OperatorFilter
  end_date?: OperatorFilter
}

export interface RecurringScheduleBlockListParams extends PageParams, TimestampParams {
  weekday?: Weekday
  start_time?: OperatorFilter
  end_time?: OperatorFilter
}

export interface ResourceScheduleParams {
  from: DateTimeString
  to: DateTimeString
  location: Uuid
  fully_booked?: "exclude" | "include"
  page?: number
  per_page?: number
}

export interface FullyBookedParams {
  from: DateTimeString
  to: DateTimeString
  page?: number
  per_page?: number
}

export interface BookableSlotParams {
  from: DateTimeString
  to: DateTimeString
  location: Uuid
  resource?: Uuid
  ignore_booking_window?: "true" | "false"
  duration?: Duration
  num_resources?: number
  page?: number
  per_page?: number
}

// ---------------------------------------------------------------------------
// CRUD factory

function crud<T, Post, Patch, ListParams extends object, Put = Post>(base: string) {
  const q = (params?: ListParams) => params as QueryParams | undefined
  return {
    list: (params?: ListParams, signal?: AbortSignal) =>
      hapioFetch<Paginated<T>>("GET", base, { query: q(params), signal }),
    get: (id: Uuid, signal?: AbortSignal) => hapioFetch<T>("GET", `${base}/${id}`, { signal }),
    create: (body: Post) => hapioFetch<T>("POST", base, { body }),
    replace: (id: Uuid, body: Put) => hapioFetch<T>("PUT", `${base}/${id}`, { body }),
    patch: (id: Uuid, body: Patch) => hapioFetch<T>("PATCH", `${base}/${id}`, { body }),
    delete: (id: Uuid) => hapioFetch<void>("DELETE", `${base}/${id}`),
  }
}

// ---------------------------------------------------------------------------
// The API surface (all 60 operations)

export const hapio = {
  project: {
    /** getYourProject */
    get: (signal?: AbortSignal) => hapioFetch<Project>("GET", "project", { signal }),
  },

  /** getLocations, postLocation, getLocation, putLocation, patchLocation, deleteLocation */
  locations: crud<Location, LocationInput, LocationPatch, LocationListParams>("locations"),

  resources: {
    /** getResources, postResource, getResource, putResource, patchResource, deleteResource */
    ...crud<Resource, ResourceInput, ResourcePatch, ResourceListParams>("resources"),
    /** getResourceSchedule */
    schedule: (id: Uuid, params: ResourceScheduleParams, signal?: AbortSignal) =>
      hapioFetch<Paginated<TimeSpan>>("GET", `resources/${id}/schedule`, {
        query: params as unknown as QueryParams,
        signal,
      }),
    /** getResourceFullyBooked */
    fullyBooked: (id: Uuid, params: FullyBookedParams, signal?: AbortSignal) =>
      hapioFetch<Paginated<TimeSpan>>("GET", `resources/${id}/fully-booked`, {
        query: params as unknown as QueryParams,
        signal,
      }),
    services: {
      /** getResourceServices (not paginated) */
      list: (resourceId: Uuid, signal?: AbortSignal) =>
        hapioFetch<ResourceService[]>("GET", `resources/${resourceId}/services`, { signal }),
      /** getResourceService */
      get: (resourceId: Uuid, serviceId: Uuid) =>
        hapioFetch<ResourceService>("GET", `resources/${resourceId}/services/${serviceId}`),
      /** putResourceService */
      associate: (resourceId: Uuid, serviceId: Uuid) =>
        hapioFetch<ResourceService>("PUT", `resources/${resourceId}/services/${serviceId}`),
      /** deleteResourceService */
      dissociate: (resourceId: Uuid, serviceId: Uuid) =>
        hapioFetch<void>("DELETE", `resources/${resourceId}/services/${serviceId}`),
    },
  },

  /** get/post/put/patch/delete ResourceScheduleBlock(s) */
  scheduleBlocks: (resourceId: Uuid) =>
    crud<ScheduleBlock, ScheduleBlockInput, ScheduleBlockPatch, ScheduleBlockListParams>(
      `resources/${resourceId}/schedule-blocks`
    ),

  /** get/post/put/patch/delete ResourceRecurringSchedule(s) */
  recurringSchedules: (resourceId: Uuid) =>
    crud<RecurringSchedule, RecurringScheduleInput, RecurringSchedulePatch, RecurringScheduleListParams>(
      `resources/${resourceId}/recurring-schedules`
    ),

  /** get/post/put/patch/delete ResourceRecurringScheduleBlock(s) */
  recurringScheduleBlocks: (resourceId: Uuid, recurringScheduleId: Uuid) =>
    crud<
      RecurringScheduleBlock,
      RecurringScheduleBlockInput,
      RecurringScheduleBlockPatch,
      RecurringScheduleBlockListParams
    >(`resources/${resourceId}/recurring-schedules/${recurringScheduleId}/schedule-blocks`),

  services: {
    /** getServices, postService, getService, putService, patchService, deleteService */
    ...crud<Service, ServiceInput, ServicePatch, ServiceListParams>("services"),
    /** getServiceBookableSlots */
    bookableSlots: (id: Uuid, params: BookableSlotParams, signal?: AbortSignal) =>
      hapioFetch<Paginated<AnyBookableSlot>>("GET", `services/${id}/bookable-slots`, {
        query: params as unknown as QueryParams,
        signal,
      }),
    resources: {
      /** getServiceResources (not paginated) */
      list: (serviceId: Uuid, signal?: AbortSignal) =>
        hapioFetch<ResourceService[]>("GET", `services/${serviceId}/resources`, { signal }),
      /** getServiceResource */
      get: (serviceId: Uuid, resourceId: Uuid) =>
        hapioFetch<ResourceService>("GET", `services/${serviceId}/resources/${resourceId}`),
      /** putServiceResource */
      associate: (serviceId: Uuid, resourceId: Uuid) =>
        hapioFetch<ResourceService>("PUT", `services/${serviceId}/resources/${resourceId}`),
      /** deleteServiceResource */
      dissociate: (serviceId: Uuid, resourceId: Uuid) =>
        hapioFetch<void>("DELETE", `services/${serviceId}/resources/${resourceId}`),
    },
  },

  /** getBookings, postBooking, getBooking, putBooking, patchBooking, deleteBooking */
  bookings: crud<Booking, BookingPost, BookingPatch, BookingListParams, BookingPut>("bookings"),

  /** getBookingGroups, postBookingGroup, getBookingGroup, putBookingGroup, patchBookingGroup, deleteBookingGroup */
  bookingGroups: crud<
    BookingGroup,
    BookingGroupPost,
    BookingGroupPatch,
    BookingGroupListParams,
    BookingGroupPut
  >("booking-groups"),
}
