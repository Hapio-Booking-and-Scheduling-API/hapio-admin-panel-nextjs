import type { Metadata } from "next"
import { Suspense } from "react"

import { DetailSkeleton } from "@/components/entity/skeletons"
import { BookingDetail } from "@/features/bookings/booking-detail"

export const metadata: Metadata = { title: "Booking" }

async function Content({ params }: { params: PageProps<"/bookings/[id]">["params"] }) {
  const { id } = await params
  return <BookingDetail id={id} />
}

export default function Page({ params }: PageProps<"/bookings/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
