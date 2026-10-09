import type { Metadata } from "next"
import { Suspense } from "react"

import { DetailSkeleton } from "@/components/entity/skeletons"
import { LocationDetail } from "@/features/locations/location-detail"

export const metadata: Metadata = { title: "Location" }

async function Content({ params }: { params: PageProps<"/locations/[id]">["params"] }) {
  const { id } = await params
  return <LocationDetail id={id} />
}

export default function Page({ params }: PageProps<"/locations/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
