import type { Metadata } from "next"
import { Suspense } from "react"

import { DetailSkeleton } from "@/components/entity/skeletons"
import { ProjectPage } from "@/features/project/project-page"

export const metadata: Metadata = { title: "Project" }

export default function Page() {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <ProjectPage />
    </Suspense>
  )
}
