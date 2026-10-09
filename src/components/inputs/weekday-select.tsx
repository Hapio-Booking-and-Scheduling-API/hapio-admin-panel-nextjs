"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { WEEKDAYS, type Weekday } from "@/lib/hapio/types"

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
}

export function WeekdaySelect({
  value,
  onChange,
  id,
  invalid,
  placeholder = "Select weekday",
  allowAny,
  size,
}: {
  value: Weekday | "" | null | undefined
  onChange: (value: Weekday | null) => void
  id?: string
  invalid?: boolean
  placeholder?: string
  allowAny?: boolean
  size?: "sm" | "default"
}) {
  return (
    <Select
      value={value || (allowAny ? "any" : "")}
      onValueChange={(v) => onChange(v === "any" ? null : (v as Weekday))}
    >
      <SelectTrigger id={id} size={size} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAny && <SelectItem value="any">Any weekday</SelectItem>}
        {WEEKDAYS.map((day) => (
          <SelectItem key={day} value={day}>
            {WEEKDAY_LABELS[day]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
