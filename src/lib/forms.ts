import { z } from "zod"

import { isValidDuration, isZeroDuration } from "@/lib/format/duration"
import { metadataError, parseMetadataText } from "@/lib/format/json"
import { isValidPriceInput, normalizePrice } from "@/lib/format/price"

/** Metadata edited as JSON text; "" means null. */
export const metadataText = () =>
  z.string().superRefine((value, ctx) => {
    const error = metadataError(value)
    if (error) ctx.addIssue({ code: "custom", message: error })
  })

export const priceText = () =>
  z.string().refine(isValidPriceInput, "Use a number with up to 12 digits and 3 decimals, e.g. 149.000")

export const durationValue = (options: { allowZero?: boolean } = {}) =>
  z
    .string()
    .min(1, "Required")
    .refine(isValidDuration, "Not a valid ISO 8601 duration (e.g. PT1H30M)")
    .refine((v) => options.allowZero !== false || !isZeroDuration(v), "Must be longer than zero")

export const nullableDurationValue = (options: { allowZero?: boolean } = {}) =>
  z
    .string()
    .nullable()
    .refine((v) => v === null || isValidDuration(v), "Not a valid ISO 8601 duration (e.g. PT1H30M)")
    .refine((v) => v === null || options.allowZero !== false || !isZeroDuration(v), "Must be longer than zero")

export function textToMetadata(text: string) {
  const parsed = parseMetadataText(text)
  return parsed.ok ? parsed.value : null
}

export function textToPrice(text: string) {
  return normalizePrice(text) ?? null
}

/**
 * Keep only the top-level fields react-hook-form marked dirty, so PATCH
 * requests don't resend (and recalculate) untouched values.
 */
export function pickDirty<T extends Record<string, unknown>>(
  values: T,
  dirtyFields: Partial<Record<keyof T, unknown>>
): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(values) as Array<keyof T>) {
    const dirty = dirtyFields[key]
    const isDirty =
      dirty === true ||
      (Array.isArray(dirty) && dirty.some(Boolean)) ||
      (typeof dirty === "object" && dirty !== null && Object.values(dirty).some(Boolean))
    if (isDirty) out[key] = values[key]
  }
  return out
}
