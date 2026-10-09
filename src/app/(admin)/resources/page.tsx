import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/entity/skeletons"
import { ResourcesPage } from "@/features/resources/resources-page"

export const metadata: Metadata = { title: "Resources" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ResourcesPage />
    </Suspense>
  )
}
