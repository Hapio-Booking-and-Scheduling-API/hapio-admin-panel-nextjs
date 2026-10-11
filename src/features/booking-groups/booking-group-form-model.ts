// Pure logic behind the booking group form: schema, row conversion, PATCH
// planning and 422 error mapping. Kept free of React so it can be unit-tested.

import type { FieldPath } from "react-hook-form"
import { z } from "zod"

import {
  IGNORE_FLAG_DEFAULTS,
  activeIgnoreFlags,
  type IgnoreFlagValues,
} from "@/features/bookings/override-rules-model"
import { instant } from "@/features/bookings/utils"
import { metadataToText } from "@/lib/format/json"
import { normalizePrice } from "@/lib/format/price"
import { metadataText, priceText, textToMetadata, textToPrice } from "@/lib/forms"
import { isHapioError } from "@/lib/hapio/errors"
import type {
  BookingEmbedded,
  BookingGroup,
  BookingGroupPatch,
  BookingPatchEmbedded,
  BookingPostEmbedded,
  Uuid,
} from "@/lib/hapio/types"

// ---------------------------------------------------------------------------
// Schema

export const rowSchema = z
  .object({
    /** "" for a booking that doesn't exist yet. */
    booking_id: z.string(),
    service_id: z.string(),
    location_id: z.string(),
    /** "" = let Hapio pick (new rows) / keep (existing rows). */
    resource_id: z.string(),
    starts_at: z.string().min(1, "Required"),
    ends_at: z.string().min(1, "Required"),
    /** New rows: "" = calculated by Hapio. Existing rows: "" = no price. */
    price: priceText(),
    is_temporary: z.boolean(),
    is_canceled: z.boolean(),
  })
  .superRefine((row, ctx) => {
    // Existing bookings may have lost their service/location (deleted); only new ones need them.
    if (!row.booking_id && !row.service_id) {
      ctx.addIssue({ code: "custom", path: ["service_id"], message: "Select a service" })
    }
    if (!row.booking_id && !row.location_id) {
      ctx.addIssue({ code: "custom", path: ["location_id"], message: "Select a location" })
    }
    if (row.starts_at && row.ends_at && instant(row.ends_at) <= instant(row.starts_at)) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "Must be after the start" })
    }
  })

export const schema = z.object({
  metadata: metadataText(),
  protected_metadata: metadataText(),
  bookings: z.array(rowSchema).min(1, "Add at least one booking."),
  ignore_schedule: z.boolean(),
  ignore_fully_booked: z.boolean(),
  ignore_bookable_slots: z.boolean(),
  ignore_booking_window: z.boolean(),
  ignore_cancelation_threshold: z.boolean(),
})

/**
 * Editing a group that has no bookings left: its metadata can change without adding one,
 * since an untouched (empty) list isn't sent at all.
 */
export const editEmptyGroupSchema = schema.extend({ bookings: z.array(rowSchema) })

export type Values = z.infer<typeof schema>
export type RowValues = Values["bookings"][number]
export type Mode = "create" | "edit"

/** Row fields that have an input, i.e. where a server error can be shown in place. */
export const ROW_INPUTS = [
  "service_id",
  "location_id",
  "resource_id",
  "starts_at",
  "ends_at",
  "price",
  "is_temporary",
  "is_canceled",
]

export function emptyRow(from?: RowValues): RowValues {
  return {
    booking_id: "",
    service_id: from?.service_id ?? "",
    location_id: from?.location_id ?? "",
    resource_id: from?.resource_id ?? "",
    starts_at: "",
    ends_at: "",
    price: "",
    is_temporary: from?.is_temporary ?? false,
    is_canceled: false,
  }
}

export function bookingToRow(booking: BookingEmbedded): RowValues {
  return {
    booking_id: booking.id,
    service_id: booking.service?.id ?? "",
    location_id: booking.location?.id ?? "",
    resource_id: booking.resource?.id ?? "",
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    price: booking.price ?? "",
    is_temporary: booking.is_temporary,
    is_canceled: booking.is_canceled,
  }
}

export function groupToValues(group: BookingGroup | undefined, bookings: BookingEmbedded[]): Values {
  return {
    metadata: metadataToText(group?.metadata),
    protected_metadata: metadataToText(group?.protected_metadata),
    bookings: group ? bookings.map(bookingToRow) : [emptyRow()],
    ...IGNORE_FLAG_DEFAULTS,
  }
}

// ---------------------------------------------------------------------------
// Request bodies

/** A booking to create; valid both in a POST and (without `id`) in a PATCH. */
export type NewBookingItem = Omit<BookingPostEmbedded, "resource_id"> & { resource_id?: Uuid }

export function rowToNew(row: RowValues, flags: Partial<IgnoreFlagValues>): NewBookingItem {
  const item: NewBookingItem = {
    service_id: row.service_id,
    location_id: row.location_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    ...flags,
  }
  if (row.resource_id) item.resource_id = row.resource_id
  if (row.price.trim()) item.price = textToPrice(row.price)
  if (row.is_temporary) item.is_temporary = true
  return item
}

/** Fields of an existing booking that differ from what the server returned. */
export function rowChanges(row: RowValues, before: RowValues): BookingPatchEmbedded {
  const out: BookingPatchEmbedded = {}
  if (row.service_id && row.service_id !== before.service_id) out.service_id = row.service_id
  if (row.location_id && row.location_id !== before.location_id) out.location_id = row.location_id
  if (row.resource_id && row.resource_id !== before.resource_id) out.resource_id = row.resource_id
  if (instant(row.starts_at) !== instant(before.starts_at)) out.starts_at = row.starts_at
  if (instant(row.ends_at) !== instant(before.ends_at)) out.ends_at = row.ends_at
  if ((normalizePrice(row.price) ?? null) !== (normalizePrice(before.price) ?? null)) out.price = textToPrice(row.price)
  if (row.is_temporary !== before.is_temporary) out.is_temporary = row.is_temporary
  if (row.is_canceled !== before.is_canceled) out.is_canceled = row.is_canceled
  return out
}

export interface PatchPlan {
  body: BookingGroupPatch | null
  /** Existing bookings that the PATCH will delete. */
  removed: BookingEmbedded[]
}

/**
 * PATCH semantics: when `bookings` is sent, every existing booking missing
 * from it is deleted. So either omit it (untouched) or send every row that
 * should remain: unchanged ones as `{ id }`, changed ones as `{ id, …changes }`
 * and new ones without an id.
 */
export function planPatch(values: Values, original: BookingEmbedded[], dirty: Partial<Values>): PatchPlan {
  const before = new Map(original.map((b) => [b.id, bookingToRow(b)]))
  const flags = activeIgnoreFlags(values)
  let touched = false

  const items: NonNullable<BookingGroupPatch["bookings"]> = values.bookings.map((row) => {
    if (!row.booking_id) {
      touched = true
      return rowToNew(row, flags)
    }
    const previous = before.get(row.booking_id)
    const changes = previous ? rowChanges(row, previous) : {}
    if (!Object.keys(changes).length) return { id: row.booking_id }
    touched = true
    return {
      id: row.booking_id,
      ...changes,
      ...flags,
      ...(changes.is_canceled && values.ignore_cancelation_threshold ? { ignore_cancelation_threshold: true } : {}),
    }
  })

  const kept = new Set(values.bookings.map((row) => row.booking_id))
  const removed = original.filter((b) => !kept.has(b.id))
  if (removed.length) touched = true

  const body: BookingGroupPatch = {}
  if (touched) body.bookings = items
  if (dirty.metadata !== undefined) body.metadata = textToMetadata(values.metadata)
  if (dirty.protected_metadata !== undefined) body.protected_metadata = textToMetadata(values.protected_metadata)
  return { body: Object.keys(body).length ? body : null, removed }
}

// ---------------------------------------------------------------------------
// Errors

export type RowErrors = Record<number, string[]>

export interface GroupErrors {
  /** Errors to attach to form fields (react-hook-form paths), in response order. */
  fieldErrors: Array<[path: FieldPath<Values>, message: string]>
  /** Messages for the form-level alert that don't refer to a row. */
  formErrors: string[]
  /**
   * "Hapio rejected booking 2, …" for the form-level alert (shown before `formErrors`).
   * It names rows by position, so it goes stale as soon as a row is added or removed.
   */
  rowSummary: string | null
  /** Messages for each row's alert, by row index. */
  rowErrors: RowErrors
}

/**
 * Group 422s come as `errors: {"bookings.0.starts_at": [...]}` and/or
 * `messages: {"bookings.0": "…"}`. Indexes refer to the array we sent, which
 * mirrors the form's rows one to one.
 */
export function mapGroupErrors(error: unknown): GroupErrors {
  const fieldErrors: GroupErrors["fieldErrors"] = []
  const formErrors: string[] = []
  const rowErrors: RowErrors = {}
  if (!isHapioError(error)) return { fieldErrors, formErrors, rowSummary: null, rowErrors }
  const failedRows = new Set<number>()
  /** Messages already shown on a row, inline under a field or in its alert. */
  const shownOnRow = new Map<number, Set<string>>()
  const markShown = (index: number, ...messages: string[]) => {
    failedRows.add(index)
    const shown = shownOnRow.get(index) ?? new Set<string>()
    for (const message of messages) shown.add(message)
    shownOnRow.set(index, shown)
  }
  const pushRow = (index: number, message: string) => {
    // Hapio often repeats a field's message as the row's message; show it once.
    if (shownOnRow.get(index)?.has(message)) return
    markShown(index, message)
    rowErrors[index] = [...(rowErrors[index] ?? []), message]
  }

  for (const [key, messages] of Object.entries(error.errors ?? {})) {
    const message = messages.join(" ")
    const m = /^bookings\.(\d+)(?:\.(.+))?$/.exec(key)
    if (m) {
      const index = Number(m[1])
      const field = m[2]
      if (field && ROW_INPUTS.includes(field)) {
        markShown(index, message, ...messages)
        fieldErrors.push([`bookings.${index}.${field}` as FieldPath<Values>, message])
      } else {
        pushRow(index, field ? `${field}: ${message}` : message)
      }
    } else if (key === "metadata" || key === "protected_metadata") {
      fieldErrors.push([key, message])
    } else {
      formErrors.push(key === "bookings" ? message : `${key}: ${message}`)
    }
  }
  for (const [key, message] of Object.entries(error.messages ?? {})) {
    const m = /^bookings\.(\d+)/.exec(key)
    if (m) pushRow(Number(m[1]), message)
    else formErrors.push(message)
  }
  let rowSummary: string | null = null
  if (failedRows.size) {
    const rows = [...failedRows].sort((a, b) => a - b).map((i) => i + 1)
    rowSummary = `Hapio rejected booking ${rows.join(", ")}. See the details on ${rows.length === 1 ? "that row" : "those rows"}.`
  }
  return { fieldErrors, formErrors, rowSummary, rowErrors }
}

export const toastUnlessShownInline = (error: unknown) =>
  !(
    isHapioError(error) &&
    error.status === 422 &&
    (Object.keys(error.errors ?? {}).length > 0 || Object.keys(error.messages ?? {}).length > 0)
  )
