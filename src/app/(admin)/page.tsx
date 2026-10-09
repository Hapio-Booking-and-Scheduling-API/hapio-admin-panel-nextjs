import { Suspense } from "react"

import { PageSkeleton } from "@/components/entity/skeletons"
import { DashboardPage } from "@/features/dashboard/dashboard-page"

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardPage />
    </Suspense>
  )
}
