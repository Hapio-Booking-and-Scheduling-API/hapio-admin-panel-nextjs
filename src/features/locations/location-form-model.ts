import { z } from "zod"

import { browserTimeZone } from "@/lib/format/datetime"
import { metadataToText } from "@/lib/format/json"
import { metadataText, pickDirty, textToMetadata } from "@/lib/forms"
import { RESOURCE_SELECTION_STRATEGIES, type Location, type LocationInput } from "@/lib/hapio/types"

export const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100, "At most 100 characters"),
  time_zone: z.string().min(1, "Required"),
  resource_selection_strategy: z.enum(RESOURCE_SELECTION_STRATEGIES),
  resource_selection_priority: z.array(z.string()),
  enabled: z.boolean(),
  metadata: metadataText(),
  protected_metadata: metadataText(),
})
export type Values = z.infer<typeof schema>
export const FIELDS = Object.keys(schema.shape)

export function toValues(location?: Location): Values {
  return {
    name: location?.name ?? "",
    time_zone: location?.time_zone ?? browserTimeZone(),
    resource_selection_strategy: location?.resource_selection_strategy ?? "randomize",
    resource_selection_priority: location?.resource_selection_priority ?? [],
    enabled: location?.enabled ?? true,
    metadata: metadataToText(location?.metadata),
    protected_metadata: metadataToText(location?.protected_metadata),
  }
}

export function toBody(values: Partial<Values>): Partial<LocationInput> {
  const body: Partial<LocationInput> = {}
  if (values.name !== undefined) body.name = values.name
  if (values.time_zone !== undefined) body.time_zone = values.time_zone
  if (values.resource_selection_strategy !== undefined)
    body.resource_selection_strategy = values.resource_selection_strategy
  if (values.resource_selection_priority !== undefined)
    body.resource_selection_priority = values.resource_selection_priority
  if (values.enabled !== undefined) body.enabled = values.enabled
  if (values.metadata !== undefined) body.metadata = textToMetadata(values.metadata)
  if (values.protected_metadata !== undefined)
    body.protected_metadata = textToMetadata(values.protected_metadata)
  return body
}

/**
 * POST body: every field, but no protected_metadata when it was left empty (or only
 * whitespace): sending it at all needs the location:protected_metadata ability.
 */
export function toCreateBody(values: Values): LocationInput {
  const body = toBody(values) as LocationInput
  if (values.protected_metadata.trim() === "") delete body.protected_metadata
  return body
}

/** PATCH body: only the fields react-hook-form marked dirty. */
export function toPatchBody(
  values: Values,
  dirtyFields: Partial<Record<keyof Values, unknown>>
): Partial<LocationInput> {
  return toBody(pickDirty(values, dirtyFields))
}
