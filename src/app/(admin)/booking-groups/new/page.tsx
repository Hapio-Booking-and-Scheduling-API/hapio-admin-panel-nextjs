import type { Metadata } from "next"
import { Suspense } from "react"

import { DetailSkeleton } from "@/components/entity/skeletons"
import { BookingGroupNewPage } from "@/features/booking-groups/booking-group-new-page"

export const metadata: Metadata = { title: "New booking group" }

export default function Page() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <BookingGroupNewPage />
    </Suspense>
  )
}
