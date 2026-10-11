// Metadata is any JSON object (or null), at most 1000 characters once encoded.

export const METADATA_MAX_LENGTH = 1000

export function metadataToText(value: unknown): string {
  if (value === null || value === undefined) return ""
  return JSON.stringify(value, null, 2)
}

export type ParsedJson = { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string }

/** "" → null. Must be a JSON object. */
export function parseMetadataText(text: string): ParsedJson {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: null }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" }
  }
  if (value === null) return { ok: true, value: null }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Metadata must be a JSON object." }
  }
  if (JSON.stringify(value).length > METADATA_MAX_LENGTH) {
    return { ok: false, error: `Metadata can be at most ${METADATA_MAX_LENGTH} characters when encoded.` }
  }
  return { ok: true, value: value as Record<string, unknown> }
}

/**
 * Length of the text's JSON object once encoded, also when it is over the limit;
 * 0 for empty text, null, or anything that isn't a JSON object.
 */
export function encodedMetadataLength(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  try {
    const value: unknown = JSON.parse(trimmed)
    return value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value).length : 0
  } catch {
    return 0
  }
}

/** Zod-friendly refinement message, or null when valid. */
export function metadataError(text: string): string | null {
  const parsed = parseMetadataText(text)
  return parsed.ok ? null : parsed.error
}

/** Drop read-only keys and undefined values from an object. */
export function omitKeys<T extends object>(value: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key, v]) => !keys.includes(key) && v !== undefined)
  )
}
