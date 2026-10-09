"use client"

import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { normalizePrice } from "@/lib/format/price"

/** Text input that normalises to Hapio's `0.000` format on blur. Value is the raw text. */
export function PriceInput({
  value,
  onChange,
  id,
  invalid,
  disabled,
  placeholder = "No price",
  suffix,
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
  suffix?: string
}) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const normalized = normalizePrice(value)
          if (normalized !== undefined) onChange(normalized ?? "")
        }}
      />
      {suffix && (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{suffix}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
