import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/entity/skeletons"
import { BookingsPage } from "@/features/bookings/bookings-page"

export const metadata: Metadata = { title: "Bookings" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BookingsPage />
    </Suspense>
  )
}
