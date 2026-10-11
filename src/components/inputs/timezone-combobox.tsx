"use client"

import { useMemo } from "react"

import { Combobox } from "@/components/inputs/combobox"
import { timeZones } from "@/lib/format/datetime"

export function TimezoneCombobox(props: {
  value: string | null | undefined
  onChange: (value: string | null) => void
  id?: string
  invalid?: boolean
  clearable?: boolean
  placeholder?: string
  size?: "sm" | "default"
  className?: string
  "aria-label"?: string
  "aria-labelledby"?: string
}) {
  const { value } = props
  const options = useMemo(() => {
    const zones = timeZones()
    // Keep a saved zone the runtime doesn't list (e.g. "Etc/GMT-3") selectable and readable.
    const all = value && !zones.includes(value) ? [value, ...zones] : zones
    return all.map((tz) => ({ value: tz, label: tz }))
  }, [value])
  return (
    <Combobox
      options={options}
      placeholder={props.placeholder ?? "Select time zone…"}
      searchPlaceholder="Search time zones…"
      {...props}
    />
  )
}
