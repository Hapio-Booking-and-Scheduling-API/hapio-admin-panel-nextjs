"use client"

import { CodeIcon, SlidersHorizontalIcon } from "lucide-react"
import { useState } from "react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  formatDuration,
  humanizeDuration,
  isValidDuration,
  parseDuration,
  type DurationParts,
} from "@/lib/format/duration"

interface DurationInputProps {
  value: string | null | undefined
  onChange: (value: string | null) => void
  /** Show a "no limit" switch that sets the value to null. */
  nullable?: boolean
  nullLabel?: string
  /** Value used when the "no limit" switch is turned off. */
  fallback?: string
  id?: string
  invalid?: boolean
  disabled?: boolean
  /** Which simple fields to show. */
  units?: Array<"days" | "hours" | "minutes">
}

const UNIT_LABEL = { days: "d", hours: "h", minutes: "min" } as const

function needsRaw(parts: DurationParts | null) {
  return !!parts && (parts.years > 0 || parts.months > 0 || parts.weeks > 0 || parts.seconds > 0)
}

/**
 * ISO 8601 duration editor. Simple mode edits days/hours/minutes; raw mode
 * accepts any Hapio duration (P1Y2M, P2W, PT30S, …).
 */
export function DurationInput({
  value,
  onChange,
  nullable,
  nullLabel = "No limit",
  fallback = "P1D",
  id,
  invalid,
  disabled,
  units = ["days", "hours", "minutes"],
}: DurationInputProps) {
  const parts = parseDuration(value)
  const [raw, setRaw] = useState(() => needsRaw(parts) || (!!value && !parts))
  const [rawText, setRawText] = useState(value ?? "")
  const isNull = value === null

  const setPart = (unit: keyof DurationParts, n: string) => {
    const next = { ...(parts ?? parseDuration("PT0S")!), [unit]: Math.max(0, Number(n) || 0) }
    onChange(formatDuration(next))
  }

  return (
    <div className="space-y-1.5">
      {nullable && (
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={isNull}
            disabled={disabled}
            onCheckedChange={(checked) => {
              if (checked) onChange(null)
              else {
                onChange(fallback)
                setRawText(fallback)
              }
            }}
          />
          {nullLabel}
        </label>
      )}
      {!isNull && (
        <div className="flex items-center gap-2">
          {raw ? (
            <Input
              id={id}
              value={rawText}
              disabled={disabled}
              placeholder="PT1H30M"
              aria-invalid={invalid || (!!rawText && !isValidDuration(rawText)) || undefined}
              className="font-mono"
              onChange={(e) => {
                const text = e.target.value.toUpperCase()
                setRawText(text)
                onChange(text)
              }}
            />
          ) : (
            <div className="flex flex-1 flex-wrap gap-2">
              {units.map((unit, i) => (
                <InputGroup key={unit} className="w-24">
                  <InputGroupInput
                    id={i === 0 ? id : undefined}
                    type="number"
                    min={0}
                    max={9999}
                    inputMode="numeric"
                    disabled={disabled}
                    aria-invalid={invalid || undefined}
                    aria-label={unit}
                    value={parts ? String(parts[unit] + (unit === "days" ? parts.weeks * 7 : 0)) : "0"}
                    onChange={(e) => setPart(unit, e.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{UNIT_LABEL[unit]}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              ))}
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled || (raw && needsRaw(parseDuration(rawText)))}
                aria-label={raw ? "Simple editor" : "Edit ISO 8601"}
                onClick={() => {
                  if (!raw) setRawText(value ?? "")
                  setRaw(!raw)
                }}
              >
                {raw ? <SlidersHorizontalIcon /> : <CodeIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{raw ? "Simple editor" : "Edit as ISO 8601"}</TooltipContent>
          </Tooltip>
        </div>
      )}
      {!isNull && (
        <p className={cn("text-xs text-muted-foreground", value && !isValidDuration(value) && "text-destructive")}>
          {value && !isValidDuration(value) ? "Not a valid ISO 8601 duration" : `${value || "—"} · ${humanizeDuration(value)}`}
        </p>
      )}
    </div>
  )
}
