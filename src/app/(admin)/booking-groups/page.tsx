import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/entity/skeletons"
import { BookingGroupsPage } from "@/features/booking-groups/booking-groups-page"

export const metadata: Metadata = { title: "Booking groups" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BookingGroupsPage />
    </Suspense>
  )
}
