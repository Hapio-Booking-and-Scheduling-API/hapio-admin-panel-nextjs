import type { Metadata } from "next"
import { Suspense } from "react"

import { DetailSkeleton } from "@/components/entity/skeletons"
import { BookingGroupDetail } from "@/features/booking-groups/booking-group-detail"

export const metadata: Metadata = { title: "Booking group" }

async function Content({ params }: { params: PageProps<"/booking-groups/[id]">["params"] }) {
  const { id } = await params
  return <BookingGroupDetail id={id} />
}

export default function Page({ params }: PageProps<"/booking-groups/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
