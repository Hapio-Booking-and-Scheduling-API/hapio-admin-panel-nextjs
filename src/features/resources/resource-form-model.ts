import { z } from "zod"

import { metadataToText } from "@/lib/format/json"
import { metadataText, pickDirty, textToMetadata } from "@/lib/forms"
import type { Resource, ResourceInput } from "@/lib/hapio/types"

export const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100, "At most 100 characters"),
  /** null = unlimited; otherwise the number as typed. */
  max_simultaneous_bookings: z
    .string()
    .nullable()
    .refine((v) => v === null || /^\d+$/.test(v.trim()), "Enter a whole number")
    .refine((v) => v === null || !/^\d+$/.test(v.trim()) || Number(v) >= 1, "Must be at least 1"),
  enabled: z.boolean(),
  metadata: metadataText(),
  protected_metadata: metadataText(),
})
export type Values = z.infer<typeof schema>
export const FIELDS = Object.keys(schema.shape)

export function toValues(resource?: Resource): Values {
  const max = resource?.max_simultaneous_bookings
  return {
    name: resource?.name ?? "",
    max_simultaneous_bookings: max === null || max === undefined ? null : String(max),
    enabled: resource?.enabled ?? true,
    metadata: metadataToText(resource?.metadata),
    protected_metadata: metadataToText(resource?.protected_metadata),
  }
}

export function toBody(values: Partial<Values>): Partial<ResourceInput> {
  const body: Partial<ResourceInput> = {}
  if (values.name !== undefined) body.name = values.name
  if (values.max_simultaneous_bookings !== undefined)
    body.max_simultaneous_bookings =
      values.max_simultaneous_bookings === null ? null : Number(values.max_simultaneous_bookings)
  if (values.enabled !== undefined) body.enabled = values.enabled
  if (values.metadata !== undefined) body.metadata = textToMetadata(values.metadata)
  if (values.protected_metadata !== undefined)
    body.protected_metadata = textToMetadata(values.protected_metadata)
  return body
}

/**
 * POST body: every field, but no protected_metadata when it was left empty (or only
 * whitespace): sending it at all needs the resource:protected_metadata ability.
 */
export function toCreateBody(values: Values): ResourceInput {
  const body = toBody(values) as ResourceInput
  if (values.protected_metadata.trim() === "") delete body.protected_metadata
  return body
}

/** PATCH body: only the fields react-hook-form marked dirty. */
export function toPatchBody(
  values: Values,
  dirtyFields: Partial<Record<keyof Values, unknown>>
): Partial<ResourceInput> {
  return toBody(pickDirty(values, dirtyFields))
}
