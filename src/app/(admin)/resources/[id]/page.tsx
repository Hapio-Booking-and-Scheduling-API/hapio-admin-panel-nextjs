import type { Metadata } from "next"
import { Suspense } from "react"

import { DetailSkeleton } from "@/components/entity/skeletons"
import { ResourceDetail } from "@/features/resources/resource-detail"

export const metadata: Metadata = { title: "Resource" }

async function Content({ params }: { params: PageProps<"/resources/[id]">["params"] }) {
  const { id } = await params
  return <ResourceDetail id={id} />
}

export default function Page({ params }: PageProps<"/resources/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Content params={params} />
    </Suspense>
  )
}
