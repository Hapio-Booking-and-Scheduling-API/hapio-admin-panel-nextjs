"use client"

import { cn } from "cn"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { normalizeTime } from "@/lib/format/datetime"

/** `hh:mm:ss` editor. With `allowEndOfDay`, offers 24:00:00. */
export function TimeInput({
  value,
  onChange,
  allowEndOfDay,
  id,
  invalid,
  disabled,
  className,
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  allowEndOfDay?: boolean
  id?: string
  invalid?: boolean
  disabled?: boolean
  /** Classes for the time input itself. */
  className?: string
}) {
  const endOfDay = value === "24:00:00"
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        id={id}
        type="time"
        step={60}
        className={cn("w-32", className)}
        value={endOfDay ? "" : (value ?? "").slice(0, 5)}
        disabled={disabled || endOfDay}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value ? normalizeTime(e.target.value) : "")}
      />
      {allowEndOfDay && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={endOfDay}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked ? "24:00:00" : "17:00:00")}
          />
          End of day (24:00)
        </label>
      )}
    </div>
  )
}
