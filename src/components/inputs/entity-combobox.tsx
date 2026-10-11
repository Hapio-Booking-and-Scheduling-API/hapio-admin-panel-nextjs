"use client"

import { useMemo } from "react"

import { Combobox } from "@/components/inputs/combobox"
import { useAllLocations, useAllResources, useAllServices } from "@/lib/hapio/hooks"

type EntityKind = "location" | "resource" | "service"

const SERVICE_TYPE_LABELS = { fixed: "Fixed", flexible: "Flexible", day: "Day" } as const

interface EntityComboboxProps {
  kind: EntityKind
  value: string | null | undefined
  onChange: (value: string | null) => void
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  id?: string
  className?: string
  invalid?: boolean
  size?: "sm" | "default"
  /** Restrict to these IDs (e.g. resources associated with a service). */
  only?: string[]
  /** Hide these IDs. */
  exclude?: string[]
  "aria-label"?: string
  "aria-labelledby"?: string
}

function useEntityOptions(kind: EntityKind) {
  const locations = useAllLocations()
  const resources = useAllResources()
  const services = useAllServices()

  const query = kind === "location" ? locations : kind === "resource" ? resources : services
  const options = useMemo(() => {
    if (kind === "location") {
      return (locations.data ?? []).map((l) => ({
        value: l.id,
        label: l.name,
        hint: `${l.time_zone}${l.enabled ? "" : " · disabled"}`,
      }))
    }
    if (kind === "resource") {
      return (resources.data ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        hint: r.enabled ? undefined : "disabled",
      }))
    }
    return (services.data ?? []).map((s) => ({
      value: s.id,
      label: s.name,
      hint: `${SERVICE_TYPE_LABELS[s.type]}${s.enabled ? "" : " · disabled"}`,
    }))
  }, [kind, locations.data, resources.data, services.data])

  return { options, loading: query.isLoading }
}

/** Picker for a location, resource or service, loading every item for client-side search. */
export function EntityCombobox({ kind, only, exclude, placeholder, ...props }: EntityComboboxProps) {
  const { options, loading } = useEntityOptions(kind)
  const filtered = options.filter(
    (o) => (!only || only.includes(o.value)) && (!exclude || !exclude.includes(o.value))
  )
  return (
    <Combobox
      options={filtered}
      loading={loading}
      placeholder={placeholder ?? `Select ${kind}…`}
      searchPlaceholder={`Search ${kind}s…`}
      emptyText={`No ${kind}s found.`}
      {...props}
    />
  )
}
