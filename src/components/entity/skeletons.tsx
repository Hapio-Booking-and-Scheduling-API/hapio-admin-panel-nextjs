import { Skeleton } from "@/components/ui/skeleton"

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-32" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-8 w-80 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
