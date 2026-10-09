import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/entity/skeletons"
import { LocationsPage } from "@/features/locations/locations-page"

export const metadata: Metadata = { title: "Locations" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LocationsPage />
    </Suspense>
  )
}
