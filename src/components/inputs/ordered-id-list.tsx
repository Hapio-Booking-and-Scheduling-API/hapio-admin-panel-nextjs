"use client"

import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react"

import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Button } from "@/components/ui/button"
import { indexById, useAllResources } from "@/lib/hapio/hooks"

/** Ordered list of resource IDs (for a location's resource_selection_priority). */
export function OrderedResourceList({
  value,
  onChange,
}: {
  value: string[]
  onChange: (value: string[]) => void
}) {
  const resources = useAllResources()
  const byId = indexById(resources.data)

  const move = (index: number, delta: number) => {
    const next = [...value]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ol className="divide-y rounded-lg border">
          {value.map((id, index) => (
            <li key={id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <span className="w-5 text-right text-muted-foreground tabular-nums">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate">{byId.get(id)?.name ?? id}</span>
              <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                <ArrowUpIcon />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" disabled={index === value.length - 1} onClick={() => move(index, 1)} aria-label="Move down">
                <ArrowDownIcon />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange(value.filter((v) => v !== id))} aria-label="Remove">
                <XIcon />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <EntityCombobox
        kind="resource"
        value={null}
        exclude={value}
        placeholder="Add resource…"
        onChange={(id) => id && onChange([...value, id])}
      />
    </div>
  )
}
