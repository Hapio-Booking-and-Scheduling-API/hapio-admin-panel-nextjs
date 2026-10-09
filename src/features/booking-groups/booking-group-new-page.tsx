"use client"

import { PageHeader } from "@/components/entity/page-header"

import { BookingGroupCreateForm } from "./booking-group-form"

export function BookingGroupNewPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New booking group"
        description="Create several related bookings in one request, e.g. a package or a multi-service appointment."
      />
      <BookingGroupCreateForm />
    </div>
  )
}
