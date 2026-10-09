import { cn } from "cn"

export interface DetailItem {
  label: React.ReactNode
  value: React.ReactNode
  hidden?: boolean
  wide?: boolean
}

/** Key/value grid for entity overviews. */
export function DetailList({ items, className }: { items: DetailItem[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items
        .filter((item) => !item.hidden)
        .map((item, i) => (
          <div key={i} className={cn("min-w-0 space-y-1", item.wide && "sm:col-span-2 lg:col-span-3")}>
            <dt className="text-xs font-medium text-muted-foreground uppercase">{item.label}</dt>
            <dd className="text-sm break-words">{item.value ?? "—"}</dd>
          </div>
        ))}
    </dl>
  )
}
