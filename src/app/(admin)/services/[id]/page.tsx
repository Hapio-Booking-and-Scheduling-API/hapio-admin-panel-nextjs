import type { Metadata } from "next"
import { Suspense } from "react"

import { DetailSkeleton } from "@/components/entity/skeletons"
import { ServiceDetail } from "@/features/services/service-detail"

export const metadata: Metadata = { title: "Service" }

async function Content({ params }: { params: PageProps<"/services/[id]">["params"] }) {
  const { id } = await params
  return <ServiceDetail id={id} />
}

export default function Page({ params }: PageProps<"/services/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
