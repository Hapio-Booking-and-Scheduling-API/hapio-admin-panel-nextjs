import type { BookingFormDefaults } from "./booking-form-model"

/**
 * A `+` in an unencoded offset (`…T10:00:00+02:00`) arrives as a space;
 * restore it so the timestamp stays valid.
 */
export function timestampParam(value: string | null): string | undefined {
  if (!value) return undefined
  return value.trim().replace(/ (\d{2}:?\d{2})$/, "+$1")
}

/**
 * `/bookings/new` prefill contract (used e.g. by the bookable-slots page):
 * `service`, `location`, `resource`, `starts_at`, `ends_at` (ISO 8601 with
 * offset, URL-encoded), `is_temporary=true`, `booking_group`.
 *
 * Returns the form defaults without undefined keys (so they don't override the
 * form's empty defaults), and whether anything was prefilled.
 */
export function bookingDefaultsFromParams(params: { get(name: string): string | null }): {
  defaults: BookingFormDefaults
  prefilled: boolean
} {
  const defaults: BookingFormDefaults = {
    service_id: params.get("service") ?? undefined,
    location_id: params.get("location") ?? undefined,
    resource_id: params.get("resource") ?? undefined,
    starts_at: timestampParam(params.get("starts_at")),
    ends_at: timestampParam(params.get("ends_at")),
    is_temporary: params.get("is_temporary") === "true" ? true : undefined,
    booking_group_id: params.get("booking_group") ?? undefined,
  }
  const prefilled = Object.values(defaults).some((v) => v !== undefined)
  // Drop undefined keys so they don't override the form's empty defaults.
  const clean = Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== undefined)) as BookingFormDefaults
  return { defaults: clean, prefilled }
}
