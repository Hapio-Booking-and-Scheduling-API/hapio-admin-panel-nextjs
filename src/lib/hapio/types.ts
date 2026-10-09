// Hand-written types for the Hapio API v1 (spec version 1.7).
// https://docs.hapio.io/hapio-api-definition/Hapio-API.v1.yaml

export type Uuid = string
/** `YYYY-MM-DDThh:mm:ss±hh:mm` */
export type DateTimeString = string
/** `YYYY-MM-DD`, in the location's time zone */
export type DateString = string
/** `hh:mm:ss`, in the location's time zone */
export type TimeString = string
/** ISO 8601 duration, e.g. `PT1H30M` */
export type Duration = string
/** Decimal string with three decimals, e.g. `149.000` */
export type Price = string
export type Metadata = Record<string, unknown> | null

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const
export type Weekday = (typeof WEEKDAYS)[number]

export type InclusionFilter = "exclude" | "include" | "only"

export const RESOURCE_SELECTION_STRATEGIES = [
  "randomize",
  "prioritize",
  "equalize",
] as const
export type ResourceSelectionStrategy =
  (typeof RESOURCE_SELECTION_STRATEGIES)[number]

export const SERVICE_TYPES = ["fixed", "flexible", "day"] as const
export type ServiceType = (typeof SERVICE_TYPES)[number]

interface Timestamps {
  readonly created_at: DateTimeString
  readonly updated_at: DateTimeString
}

// ---------------------------------------------------------------------------
// Pagination & errors

export interface PaginationLinks {
  first: string
  last: string
  prev: string | null
  next: string | null
}

export interface PaginationMeta {
  current_page: number
  from: number | null
  last_page: number
  path: string
  per_page: number
  to: number | null
  total: number
}

export interface Paginated<T> {
  data: T[]
  links: PaginationLinks
  meta: PaginationMeta
}

export interface ErrorBody {
  message: string
}

export interface ValidationErrorBody {
  message: string
  errors?: Record<string, string[]>
}

export interface BookingGroupErrorBody {
  message?: string
  messages: Record<string, string>
  errors?: Record<string, string[]>
}

// ---------------------------------------------------------------------------
// Project

export interface Project extends Timestamps {
  readonly id: Uuid
  name: string
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Locations

export interface Location extends Timestamps {
  readonly id: Uuid
  name: string
  time_zone: string
  resource_selection_strategy: ResourceSelectionStrategy
  resource_selection_priority?: Uuid[]
  metadata: Metadata
  protected_metadata?: Metadata
  enabled: boolean
}

export interface LocationInput {
  name: string
  time_zone: string
  resource_selection_strategy: ResourceSelectionStrategy
  resource_selection_priority?: Uuid[]
  metadata?: Metadata
  protected_metadata?: Metadata
  enabled?: boolean
}

export type LocationPatch = Partial<LocationInput>

// ---------------------------------------------------------------------------
// Resources

export interface Resource extends Timestamps {
  readonly id: Uuid
  name: string
  max_simultaneous_bookings: number | null
  metadata: Metadata
  protected_metadata?: Metadata
  enabled: boolean
}

export interface ResourceInput {
  name: string
  max_simultaneous_bookings?: number | null
  metadata?: Metadata
  protected_metadata?: Metadata
  enabled?: boolean
}

export type ResourcePatch = Partial<ResourceInput>

export interface ResourceService {
  resource_id: Uuid
  service_id: Uuid
  readonly created_at: DateTimeString
}

export interface TimeSpan {
  starts_at: DateTimeString
  ends_at: DateTimeString
}

// ---------------------------------------------------------------------------
// Schedule blocks

export interface ScheduleBlock extends Timestamps {
  readonly id: Uuid
  readonly location: Location
  starts_at: DateTimeString
  ends_at: DateTimeString
  is_available: boolean
}

export interface ScheduleBlockInput {
  location_id: Uuid
  starts_at: DateTimeString
  ends_at: DateTimeString
  is_available?: boolean
}

export type ScheduleBlockPatch = Partial<ScheduleBlockInput>

// ---------------------------------------------------------------------------
// Recurring schedules

export interface RecurringSchedule extends Timestamps {
  readonly id: Uuid
  readonly location: Location
  start_date: DateString
  end_date: DateString | null
  interval: number
}

export interface RecurringScheduleInput {
  location_id: Uuid
  start_date: DateString
  end_date?: DateString | null
  interval?: number
}

export type RecurringSchedulePatch = Partial<RecurringScheduleInput>

export interface RecurringScheduleBlock extends Timestamps {
  readonly id: Uuid
  weekday: Weekday
  start_time: TimeString
  end_time: TimeString
}

export interface RecurringScheduleBlockInput {
  weekday: Weekday
  start_time: TimeString
  end_time: TimeString
}

export type RecurringScheduleBlockPatch = Partial<RecurringScheduleBlockInput>

// ---------------------------------------------------------------------------
// Services

/** Either one time for every day, or one per weekday (all seven keys). */
export type DayTime = TimeString | Record<Weekday, TimeString>

interface ServiceCommon extends Timestamps {
  readonly id: Uuid
  name: string
  price: Price | null
  buffer_time_before: Duration
  buffer_time_after: Duration
  booking_window_start: Duration
  booking_window_end: Duration | null
  cancelation_threshold: Duration
  metadata: Metadata
  protected_metadata?: Metadata
  enabled: boolean
}

export interface ServiceFixed extends ServiceCommon {
  type: "fixed"
  duration: Duration
  bookable_interval: Duration | null
}

export interface ServiceFlexible extends ServiceCommon {
  type: "flexible"
  min_duration: Duration
  max_duration: Duration | null
  default_duration: Duration | null
  duration_step: Duration
  bookable_interval: Duration | null
}

export interface ServiceDay extends ServiceCommon {
  type: "day"
  start_time: DayTime
  end_time: DayTime
  min_days: number
  max_days: number | null
  default_days: number | null
}

export type Service = ServiceFixed | ServiceFlexible | ServiceDay

interface ServiceInputCommon {
  name: string
  price?: Price | null
  buffer_time_before?: Duration
  buffer_time_after?: Duration
  booking_window_start?: Duration
  booking_window_end?: Duration | null
  cancelation_threshold?: Duration
  metadata?: Metadata
  protected_metadata?: Metadata
  enabled?: boolean
}

export interface ServiceFixedInput extends ServiceInputCommon {
  type: "fixed"
  duration: Duration
  bookable_interval?: Duration | null
}

export interface ServiceFlexibleInput extends ServiceInputCommon {
  type: "flexible"
  min_duration: Duration
  max_duration: Duration | null
  default_duration?: Duration | null
  duration_step: Duration
  bookable_interval?: Duration | null
}

export interface ServiceDayInput extends ServiceInputCommon {
  type: "day"
  start_time: DayTime
  end_time: DayTime
  min_days: number
  max_days: number | null
  default_days?: number | null
}

export type ServiceInput = ServiceFixedInput | ServiceFlexibleInput | ServiceDayInput

/** Patch bodies: every field optional. Changing `type` requires that type's required fields. */
export type ServicePatch =
  | Partial<ServiceFixedInput>
  | Partial<ServiceFlexibleInput>
  | Partial<ServiceDayInput>

// ---------------------------------------------------------------------------
// Bookable slots

export interface BookableSlot {
  readonly buffer_starts_at: DateTimeString
  readonly starts_at: DateTimeString
  readonly ends_at: DateTimeString
  readonly buffer_ends_at: DateTimeString
  readonly resources: Resource[]
}

export type BookableSlotFixed = BookableSlot

export interface BookableSlotFlexible extends BookableSlot {
  readonly min_ends_at: DateTimeString
  readonly min_buffer_ends_at: DateTimeString
}

export type BookableSlotDay = BookableSlotFlexible

export type AnyBookableSlot = BookableSlotFixed | BookableSlotFlexible

// ---------------------------------------------------------------------------
// Bookings

export interface BookingGroupEmbedded extends Timestamps {
  readonly id: Uuid
  metadata: Metadata
  protected_metadata?: Metadata
}

export interface BookingEmbedded extends Timestamps {
  readonly id: Uuid
  readonly resource: Resource | null
  readonly service: Service | null
  readonly location: Location | null
  price: Price | null
  metadata: Metadata
  protected_metadata?: Metadata
  is_temporary: boolean
  is_canceled: boolean
  starts_at: DateTimeString
  ends_at: DateTimeString
  buffer_starts_at: DateTimeString
  buffer_ends_at: DateTimeString
  readonly finalized_at: DateTimeString | null
  readonly canceled_at: DateTimeString | null
}

export interface Booking extends BookingEmbedded {
  readonly booking_group: BookingGroupEmbedded | null
}

export interface BookingIgnoreFlags {
  ignore_schedule?: boolean
  ignore_fully_booked?: boolean
  ignore_bookable_slots?: boolean
  ignore_booking_window?: boolean
}

export interface BookingPostEmbedded extends BookingIgnoreFlags {
  resource_id?: Uuid | null
  service_id: Uuid
  location_id: Uuid
  price?: Price | null
  metadata?: Metadata
  protected_metadata?: Metadata
  is_temporary?: boolean
  starts_at: DateTimeString
  ends_at: DateTimeString
  buffer_starts_at?: DateTimeString
  buffer_ends_at?: DateTimeString
}

export interface BookingPost extends BookingPostEmbedded {
  booking_group_id?: Uuid | null
}

export interface BookingPutEmbedded extends BookingIgnoreFlags {
  resource_id: Uuid | null
  service_id: Uuid | null
  location_id: Uuid | null
  price?: Price | null
  metadata?: Metadata
  protected_metadata?: Metadata
  is_temporary?: boolean
  is_canceled?: boolean
  starts_at: DateTimeString
  ends_at: DateTimeString
  buffer_starts_at?: DateTimeString
  buffer_ends_at?: DateTimeString
  ignore_cancelation_threshold?: boolean
}

export interface BookingPut extends BookingPutEmbedded {
  booking_group_id?: Uuid | null
}

export interface BookingPatchEmbedded extends BookingIgnoreFlags {
  resource_id?: Uuid
  service_id?: Uuid
  location_id?: Uuid
  price?: Price | null
  metadata?: Metadata
  protected_metadata?: Metadata
  is_temporary?: boolean
  is_canceled?: boolean
  starts_at?: DateTimeString
  ends_at?: DateTimeString
  buffer_starts_at?: DateTimeString
  buffer_ends_at?: DateTimeString
  ignore_cancelation_threshold?: boolean
}

export interface BookingPatch extends BookingPatchEmbedded {
  /** `null` removes the booking from its group. */
  booking_group_id?: Uuid | null
}

// ---------------------------------------------------------------------------
// Booking groups

export interface BookingGroup extends Timestamps {
  readonly id: Uuid
  readonly bookings: BookingEmbedded[]
  metadata: Metadata
  protected_metadata?: Metadata
}

export interface BookingGroupPost {
  bookings: BookingPostEmbedded[]
  metadata?: Metadata
  protected_metadata?: Metadata
}

export interface BookingGroupPut {
  /** Items without `id` are created; existing bookings missing from the array are deleted. */
  bookings: Array<{ id?: Uuid } & BookingPutEmbedded>
  metadata?: Metadata
  protected_metadata?: Metadata
}

export interface BookingGroupPatch {
  /** Omit to keep bookings. When sent, existing bookings missing from the array are deleted. */
  bookings?: Array<{ id?: Uuid } & BookingPatchEmbedded>
  metadata?: Metadata
  protected_metadata?: Metadata
}
