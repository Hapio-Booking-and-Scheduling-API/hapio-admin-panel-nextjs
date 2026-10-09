"use client"

import { cn } from "cn"

import { Textarea } from "@/components/ui/textarea"
import { METADATA_MAX_LENGTH, parseMetadataText } from "@/lib/format/json"

/** Textarea for JSON metadata with validity and length feedback. Value is the raw text. */
export function JsonEditor({
  value,
  onChange,
  id,
  placeholder = '{ "key": "value" }',
  rows = 5,
  invalid,
  maxLength = METADATA_MAX_LENGTH,
  className,
  ...props
}: {
  value: string
  onChange: (text: string) => void
  id?: string
  placeholder?: string
  rows?: number
  invalid?: boolean
  maxLength?: number | null
  className?: string
} & Omit<React.ComponentProps<"textarea">, "value" | "onChange">) {
  const parsed = parseMetadataText(value)
  const length = parsed.ok && parsed.value ? JSON.stringify(parsed.value).length : 0
  return (
    <div className="space-y-1">
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        aria-invalid={invalid || !parsed.ok || undefined}
        className={cn("font-mono text-xs", className)}
        {...props}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className={cn(!parsed.ok && "text-destructive")}>
          {parsed.ok ? (parsed.value ? "Valid JSON object" : "Empty (null)") : parsed.error}
        </span>
        {maxLength !== null && (
          <span className={cn("tabular-nums", length > maxLength && "text-destructive")}>
            {length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  )
}
