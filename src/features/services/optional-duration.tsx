"use client"

import { useId } from "react"

import { DurationInput } from "@/components/inputs/duration-input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { Duration } from "@/lib/hapio/types"

/**
 * A duration that can be null. The switch labels what null means
 * ("No limit", "Same as step", …); turning it off starts from `fallback`.
 */
export function OptionalDuration({
  value,
  onChange,
  nullLabel,
  fallback,
  id,
  invalid,
  disabled,
  units,
}: {
  value: Duration | null
  onChange: (value: Duration | null) => void
  nullLabel: string
  fallback: Duration
  id?: string
  invalid?: boolean
  disabled?: boolean
  units?: Array<"days" | "hours" | "minutes">
}) {
  const switchId = useId()
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={value === null}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked ? null : fallback)}
        />
        <Label htmlFor={switchId} className="font-normal">
          {nullLabel}
        </Label>
      </div>
      {value !== null && (
        <DurationInput
          id={id}
          value={value}
          onChange={(v) => onChange(v ?? "")}
          invalid={invalid}
          disabled={disabled}
          units={units}
        />
      )}
    </div>
  )
}
