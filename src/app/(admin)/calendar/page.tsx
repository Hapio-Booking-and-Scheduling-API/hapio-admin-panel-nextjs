import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/entity/skeletons"
import { CalendarPage } from "@/features/calendar/calendar-page"

export const metadata: Metadata = { title: "Calendar" }

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CalendarPage />
    </Suspense>
  )
}
