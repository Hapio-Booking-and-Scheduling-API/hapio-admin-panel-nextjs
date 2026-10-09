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

/** A human-readable one-liner for toasts and alerts. */
export function describeError(error: unknown): string {
  if (isHapioError(error)) {
    if (error.isNotConfigured) return error.message
    const hint = STATUS_HINTS[error.status]
    if (error.status === 422) return error.message || "Validation failed."
    if (hint && (!error.message || error.message === "Unauthenticated.")) return hint
    return error.message || hint || `Request failed (${error.status}).`
  }
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

/**
 * Copies 422 field errors onto a react-hook-form instance.
 * `fieldMap` translates API keys to form field names where they differ.
 * Returns the messages that couldn't be attached to a known field.
 */
export function applyValidationErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
  fieldMap: Record<string, string> = {}
): string[] {
  if (!isHapioError(error) || !error.errors) return []

  const unmatched: string[] = []
  for (const [apiKey, messages] of Object.entries(error.errors)) {
    const field = fieldMap[apiKey] ?? apiKey
    const message = messages.join(" ")
    const root = field.split(".")[0]
    if (knownFields.includes(field) || knownFields.includes(root)) {
      setError(field as Path<T>, { type: "server", message })
    } else {
      unmatched.push(message)
    }
  }
  return unmatched
}
