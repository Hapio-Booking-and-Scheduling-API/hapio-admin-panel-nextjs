import { z } from "zod"

import { humanizeDuration, isZeroDuration } from "@/lib/format/duration"
import { metadataToText } from "@/lib/format/json"
import { metadataText, priceText, textToMetadata, textToPrice } from "@/lib/forms"
import type { Booking, BookingPatch, BookingPost, Service } from "@/lib/hapio/types"

import { IGNORE_FLAG_DEFAULTS, activeIgnoreFlags } from "./override-rules-model"
import { UUID_RE, instant } from "./utils"

const manualPrice = priceText()

export const schema = z
  .object({
    service_id: z.string().min(1, "Select a service"),
    location_id: z.string().min(1, "Select a location"),
    /** "" = let Hapio pick (create only). */
    resource_id: z.string(),
    starts_at: z.string().min(1, "Required"),
    ends_at: z.string().min(1, "Required"),
    /** On: leave the price to Hapio (omit it from the request). */
    auto_price: z.boolean(),
    /** Only used (and validated) while `auto_price` is off. */
    price: z.string(),
    is_temporary: z.boolean(),
    is_canceled: z.boolean(),
    booking_group_id: z
      .string()
      .trim()
      .refine((v) => v === "" || UUID_RE.test(v), "Not a valid booking group ID"),
    metadata: metadataText(),
    protected_metadata: metadataText(),
    ignore_schedule: z.boolean(),
    ignore_fully_booked: z.boolean(),
    ignore_bookable_slots: z.boolean(),
    ignore_booking_window: z.boolean(),
    ignore_cancelation_threshold: z.boolean(),
    custom_buffers: z.boolean(),
    buffer_starts_at: z.string(),
    buffer_ends_at: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.auto_price) {
      const price = manualPrice.safeParse(v.price)
      if (!price.success) ctx.addIssue({ code: "custom", path: ["price"], message: price.error.issues[0].message })
    }
    if (v.starts_at && v.ends_at && instant(v.ends_at) <= instant(v.starts_at)) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "Must be after the start" })
    }
    if (!v.custom_buffers) return
    if (!v.buffer_starts_at) {
      ctx.addIssue({ code: "custom", path: ["buffer_starts_at"], message: "Required" })
    } else if (v.starts_at && instant(v.buffer_starts_at) > instant(v.starts_at)) {
      ctx.addIssue({ code: "custom", path: ["buffer_starts_at"], message: "Must be at or before the start" })
    }
    if (!v.buffer_ends_at) {
      ctx.addIssue({ code: "custom", path: ["buffer_ends_at"], message: "Required" })
    } else if (v.ends_at && instant(v.buffer_ends_at) < instant(v.ends_at)) {
      ctx.addIssue({ code: "custom", path: ["buffer_ends_at"], message: "Must be at or after the end" })
    }
    if (!v.ignore_bookable_slots && !v.ignore_schedule) {
      ctx.addIssue({
        code: "custom",
        path: ["custom_buffers"],
        message: "Custom buffers need “Ignore bookable slots” (under Override rules).",
      })
    }
  })

export type Values = z.infer<typeof schema>
export type Mode = "create" | "edit"
export const FIELDS = Object.keys(schema.shape)

/** Prefill for a new booking (e.g. from URL search params). */
export type BookingFormDefaults = Partial<
  Pick<Values, "service_id" | "location_id" | "resource_id" | "starts_at" | "ends_at" | "is_temporary" | "booking_group_id">
>

export function emptyValues(defaults: BookingFormDefaults = {}): Values {
  return {
    service_id: "",
    location_id: "",
    resource_id: "",
    starts_at: "",
    ends_at: "",
    auto_price: true,
    price: "",
    is_temporary: false,
    is_canceled: false,
    booking_group_id: "",
    metadata: "",
    protected_metadata: "",
    ...IGNORE_FLAG_DEFAULTS,
    custom_buffers: false,
    buffer_starts_at: "",
    buffer_ends_at: "",
    ...defaults,
  }
}

export function bookingToValues(booking: Booking): Values {
  return {
    service_id: booking.service?.id ?? "",
    location_id: booking.location?.id ?? "",
    resource_id: booking.resource?.id ?? "",
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    auto_price: true,
    price: booking.price ?? "",
    is_temporary: booking.is_temporary,
    is_canceled: booking.is_canceled,
    booking_group_id: booking.booking_group?.id ?? "",
    metadata: metadataToText(booking.metadata),
    protected_metadata: metadataToText(booking.protected_metadata),
    ...IGNORE_FLAG_DEFAULTS,
    custom_buffers: false,
    buffer_starts_at: booking.buffer_starts_at,
    buffer_ends_at: booking.buffer_ends_at,
  }
}

/** `fixedMetadata` (NEXT_PUBLIC_BOOKING_CREATE_METADATA) is merged in, and wins over the form's. */
export function toPostBody(v: Values, fixedMetadata: Record<string, unknown> = {}): BookingPost {
  const body: BookingPost = {
    service_id: v.service_id,
    location_id: v.location_id,
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    ...activeIgnoreFlags(v),
  }
  if (v.resource_id) body.resource_id = v.resource_id
  if (v.booking_group_id) body.booking_group_id = v.booking_group_id
  // Sending price (even null) overrides Hapio's calculation.
  if (!v.auto_price) body.price = textToPrice(v.price)
  if (v.is_temporary) body.is_temporary = true
  const metadata = { ...(textToMetadata(v.metadata) ?? {}), ...fixedMetadata }
  if (Object.keys(metadata).length) body.metadata = metadata
  const protectedMetadata = textToMetadata(v.protected_metadata)
  if (protectedMetadata) body.protected_metadata = protectedMetadata
  if (v.custom_buffers) {
    body.buffer_starts_at = v.buffer_starts_at
    body.buffer_ends_at = v.buffer_ends_at
  }
  return body
}

/** PATCH body with only what changed. Returns null when nothing did. */
export function toPatchBody(values: Values, dirty: Partial<Values>): BookingPatch | null {
  const body: BookingPatch = {}
  if (dirty.service_id !== undefined) body.service_id = values.service_id
  if (dirty.location_id !== undefined) body.location_id = values.location_id
  if (dirty.resource_id !== undefined && values.resource_id) body.resource_id = values.resource_id
  if (dirty.starts_at !== undefined) body.starts_at = values.starts_at
  if (dirty.ends_at !== undefined) body.ends_at = values.ends_at
  // A manual price is sent when it changed, or to keep it when Hapio would otherwise
  // recalculate it (new service or times). Just switching automatic off changes nothing.
  const recalculates = dirty.service_id !== undefined || dirty.starts_at !== undefined || dirty.ends_at !== undefined
  if (!values.auto_price && (dirty.price !== undefined || recalculates)) {
    body.price = textToPrice(values.price)
  }
  if (dirty.is_temporary !== undefined) body.is_temporary = values.is_temporary
  if (dirty.is_canceled !== undefined) body.is_canceled = values.is_canceled
  if (dirty.booking_group_id !== undefined) body.booking_group_id = values.booking_group_id || null
  if (dirty.metadata !== undefined) body.metadata = textToMetadata(values.metadata)
  if (dirty.protected_metadata !== undefined) body.protected_metadata = textToMetadata(values.protected_metadata)
  if (values.custom_buffers) {
    body.buffer_starts_at = values.buffer_starts_at
    body.buffer_ends_at = values.buffer_ends_at
  }
  if (!Object.keys(body).length) return null
  // The cancelation threshold only matters when this request cancels the booking.
  const cancels = dirty.is_canceled !== undefined && values.is_canceled
  return { ...body, ...activeIgnoreFlags(values, { cancelation: cancels }) }
}

/** The service's default buffers, e.g. "15 min before, 0 min after" (or "none"). */
export function serviceBuffers(service: Service) {
  const before = service.buffer_time_before
  const after = service.buffer_time_after
  if (isZeroDuration(before) && isZeroDuration(after)) return "none"
  return `${humanizeDuration(before)} before, ${humanizeDuration(after)} after`
}
