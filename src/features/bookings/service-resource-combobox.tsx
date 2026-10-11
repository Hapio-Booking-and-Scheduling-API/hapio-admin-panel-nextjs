"use client"


import { useState } from "react"

import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Button } from "@/components/ui/button"
import { hapio } from "@/lib/hapio/client"
import { hapioKey } from "@/lib/hapio/hooks"
import type { Uuid } from "@/lib/hapio/types"
import { useHapioQuery } from "@/lib/hapio/use-hapio-query"

/** IDs of the resources associated with a service. */
export function useServiceResourceIds(serviceId: Uuid | null | undefined) {
  return useHapioQuery({
    queryKey: hapioKey("services", serviceId, "resources"),
    queryFn: ({ signal }) => hapio.services.resources.list(serviceId!, signal),
    enabled: !!serviceId,
    staleTime: 60_000,
    select: (links) => links.map((link) => link.resource_id),
  })
}

/**
 * Resource picker that offers only the resources providing the selected
 * service. Empty means "let Hapio pick" when `clearable`.
 */
export function ServiceResourceCombobox({
  serviceId,
  value,
  onChange,
  id,
  invalid,
  clearable,
  placeholder = "Auto-select",
  compact = false,
  size,
}: {
  serviceId: Uuid | null | undefined
  value: string
  onChange: (value: string) => void
  id?: string
  invalid?: boolean
  clearable?: boolean
  placeholder?: string
  /** Hide the helper text (for dense rows). */
  compact?: boolean
  size?: "sm" | "default"
}) {
  const [showAll, setShowAll] = useState(false)
  const linked = useServiceResourceIds(serviceId)
  const ids = serviceId ? linked.data : undefined
  // Keep the current value selectable even when it isn't linked to the service.
  const only = ids && !showAll ? (value && !ids.includes(value) ? [...ids, value] : ids) : undefined
  const unlinked = !!value && !!ids && !ids.includes(value)

  return (
    <div className="flex flex-col gap-1">
      <EntityCombobox
        kind="resource"
        id={id}
        size={size}
        invalid={invalid}
        clearable={clearable}
        placeholder={ids && ids.length === 0 && !showAll ? "No resources for this service" : placeholder}
        only={only}
        value={value || null}
        onChange={(next) => onChange(next ?? "")}
      />
      {!compact && ids && (
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          {showAll
            ? "Showing every resource."
            : ids.length
              ? `Showing the ${ids.length === 1 ? "resource that provides" : `${ids.length} resources that provide`} this service.`
              : "No resources provide this service yet."}
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0 text-xs"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Only matching" : "Show all"}
          </Button>
        </p>
      )}
      {unlinked && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This resource isn&apos;t associated with the selected service.
        </p>
      )}
    </div>
  )
}
