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
}) {
  const options = useMemo(() => timeZones().map((tz) => ({ value: tz, label: tz })), [])
  return (
    <Combobox
      options={options}
      placeholder={props.placeholder ?? "Select time zone…"}
      searchPlaceholder="Search time zones…"
      {...props}
    />
  )
}
