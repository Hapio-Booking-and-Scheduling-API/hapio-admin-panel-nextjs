"use client"

import { ArrowUpDownIcon } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** Sort picker for fields that aren't table columns. Value "" = API default order. */
export function SortSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <Select value={value || "default"} onValueChange={(v) => onChange(v === "default" ? "" : v)}>
      <SelectTrigger size="sm" className="w-auto" aria-label="Sort">
        <ArrowUpDownIcon className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">Default order</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Builds asc/desc options for the given fields. */
export function sortOptions(fields: Array<[key: string, label: string]>) {
  return fields.flatMap(([key, label]) => [
    { value: `${key}.asc`, label: `${label} ↑` },
    { value: `${key}.desc`, label: `${label} ↓` },
  ])
}
