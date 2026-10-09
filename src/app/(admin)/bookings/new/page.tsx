import type { Metadata } from "next"
import { Suspense } from "react"

import { DetailSkeleton } from "@/components/entity/skeletons"
import { BookingNewPage } from "@/features/bookings/booking-new-page"

export const metadata: Metadata = { title: "New booking" }

export default function Page() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <BookingNewPage />
    </Suspense>
  )
}
