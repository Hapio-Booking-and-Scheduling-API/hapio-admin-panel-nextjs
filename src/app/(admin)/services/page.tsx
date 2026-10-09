import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/entity/skeletons"
import { ServicesPage } from "@/features/services/services-page"

export const metadata: Metadata = { title: "Services" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ServicesPage />
    </Suspense>
  )
}
