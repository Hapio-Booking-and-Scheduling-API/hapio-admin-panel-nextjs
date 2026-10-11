import type { FieldValues, Path, UseFormSetError } from "react-hook-form"

export class HapioApiError extends Error {
  readonly status: number
  readonly code?: string
  /** Field errors from a 422 response, keyed like `starts_at` or `bookings.0.starts_at`. */
  readonly errors?: Record<string, string[]>
  /** Per-booking messages from a booking group 422, keyed like `bookings.0`. */
  readonly messages?: Record<string, string>
  /** Seconds to wait before retrying, from a 429 response. */
  readonly retryAfter?: number

  constructor(init: {
    status: number
    message: string
    code?: string
    errors?: Record<string, string[]>
    messages?: Record<string, string>
    retryAfter?: number
  }) {
    super(init.message)
    this.name = "HapioApiError"
    this.status = init.status
    this.code = init.code
    this.errors = init.errors
    this.messages = init.messages
    this.retryAfter = init.retryAfter
  }

  get isValidation() {
    return this.status === 422
  }

  get isNotConfigured() {
    return this.code === "HAPIO_NOT_CONFIGURED"
  }
}

export function isHapioError(error: unknown): error is HapioApiError {
  return error instanceof HapioApiError
}

const STATUS_HINTS: Record<number, string> = {
  401: "The Hapio API token is missing or invalid.",
  403: "The API token isn't allowed to do this. Check its abilities in the Hapio portal.",
  404: "Not found. It may have been deleted.",
  429: "Rate limit reached. Retrying shortly.",
  500: "Hapio had an internal error.",
  503: "Hapio is temporarily unavailable.",
}

/** Laravel's stock messages, which say less than the hints above. */
const GENERIC_MESSAGES = new Set(["unauthenticated.", "not found.", "not found"])

/** A human-readable one-liner for toasts and alerts. */
export function describeError(error: unknown): string {
  if (isHapioError(error)) {
    if (error.isNotConfigured) return error.message
    if (error.status === 422) return error.message || "Validation failed."
    const hint = STATUS_HINTS[error.status]
    const message = error.message.trim()
    if (!hint) return message || `Request failed (${error.status}).`
    if (!message || message === hint || GENERIC_MESSAGES.has(message.toLowerCase())) return hint
    // Hapio's 403 messages ("This action is unauthorized.") never say what to fix.
    if (error.status === 403) return `${/[.!?]$/.test(message) ? message : `${message}.`} ${hint}`
    return message
  }
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

/**
 * Copies 422 field errors onto a react-hook-form instance.
 * `fieldMap` translates API keys to form field names where they differ.
 * A nested API key (`resource_selection_priority.0`, `metadata.customer`) whose root is a
 * known field is shown on that field, because the form renders one message per field.
 * Nested targets produced by `fieldMap` (`start_times.monday`) are kept as they are.
 * Returns the messages that couldn't be attached to a known field.
 */
export function applyValidationErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
  fieldMap: Record<string, string> = {}
): string[] {
  if (!isHapioError(error) || !error.errors) return []

  const byField = new Map<string, string[]>()
  const unmatched: string[] = []
  for (const [apiKey, messages] of Object.entries(error.errors)) {
    const mapped = fieldMap[apiKey]
    const field = mapped ?? apiKey
    const root = field.split(".")[0]
    let target: string | undefined
    if (knownFields.includes(field)) target = field
    else if (knownFields.includes(root)) target = mapped !== undefined ? field : root
    if (target === undefined) {
      unmatched.push(messages.join(" "))
    } else {
      byField.set(target, [...(byField.get(target) ?? []), ...messages])
    }
  }
  for (const [field, messages] of byField) {
    setError(field as Path<T>, { type: "server", message: messages.join(" ") })
  }
  return unmatched
}
