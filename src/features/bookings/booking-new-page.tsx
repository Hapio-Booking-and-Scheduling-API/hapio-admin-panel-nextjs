"use client"

import { useSearchParams } from "next/navigation"

import { PageHeader } from "@/components/entity/page-header"

import { BookingCreateForm } from "./booking-form"
import { bookingDefaultsFromParams } from "./booking-new-params"

/**
 * `/bookings/new` prefill contract (used e.g. by the bookable-slots page):
 * `service`, `location`, `resource`, `starts_at`, `ends_at` (ISO 8601 with
 * offset, URL-encoded), `is_temporary=true`, `booking_group`.
 */
export function BookingNewPage() {
  const params = useSearchParams()
  const { defaults: clean, prefilled } = bookingDefaultsFromParams(params)

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
