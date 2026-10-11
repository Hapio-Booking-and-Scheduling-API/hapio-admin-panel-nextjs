"use client"

import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { toHapioDateTime, toWallTime } from "@/lib/format/datetime"

/**
 * Edits a Hapio timestamp as wall time in `timeZone` (the location's zone, or
 * the browser's when omitted). Emits `YYYY-MM-DDThh:mm:ss±hh:mm` or "".
 */
export function DateTimeInput({
  value,
  onChange,
  timeZone,
  id,
  invalid,
  disabled,
  showZone = true,
  size,
  "aria-label": ariaLabel,
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  timeZone?: string | null
  id?: string
  invalid?: boolean
  disabled?: boolean
  showZone?: boolean
  size?: "sm"
  "aria-label"?: string
}) {
  return (
    <InputGroup className={size === "sm" ? "h-7" : undefined}>
      <InputGroupInput
        id={id}
        type="datetime-local"
        aria-label={ariaLabel}
        value={toWallTime(value, timeZone)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value ? toHapioDateTime(e.target.value, timeZone) : "")}
      />
      {showZone && timeZone && (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="max-w-32 truncate text-xs">{timeZone}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
