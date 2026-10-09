"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { InclusionFilter } from "@/lib/hapio/types"

/** exclude / include / only — Hapio's filter for disabled, temporary and canceled items. */
export function TriStateFilter({
  noun,
  value,
  onChange,
}: {
  /** e.g. "disabled", "canceled", "temporary" */
  noun: string
  value: InclusionFilter
  onChange: (value: InclusionFilter) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as InclusionFilter)}>
      <SelectTrigger size="sm" className="w-auto min-w-36" aria-label={`Filter ${noun}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="exclude">Hide {noun}</SelectItem>
        <SelectItem value="include">Show {noun}</SelectItem>
        <SelectItem value="only">Only {noun}</SelectItem>
      </SelectContent>
    </Select>
  )
}
