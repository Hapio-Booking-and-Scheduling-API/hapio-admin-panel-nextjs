"use client"

import { useSearchParams } from "next/navigation"

import { PageHeader } from "@/components/entity/page-header"

import { BookingCreateForm, type BookingFormDefaults } from "./booking-form"

/**
 * A `+` in an unencoded offset (`…T10:00:00+02:00`) arrives as a space;
 * restore it so the timestamp stays valid.
 */
function timestampParam(value: string | null): string | undefined {
  if (!value) return undefined
  return value.trim().replace(/ (\d{2}:?\d{2})$/, "+$1")
}

/**
 * `/bookings/new` prefill contract (used e.g. by the bookable-slots page):
 * `service`, `location`, `resource`, `starts_at`, `ends_at` (ISO 8601 with
 * offset, URL-encoded), `is_temporary=true`, `booking_group`.
 */
export function BookingNewPage() {
  const params = useSearchParams()
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New booking"
        description={
          prefilled
            ? "Prefilled from your selection. Review the details and create the booking."
            : "Book a service at a location. Hapio checks availability unless you override its rules."
        }
      />
      <BookingCreateForm key={params.toString()} defaults={clean} />
    </div>
  )
}
