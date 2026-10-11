"use client"

import { CalendarIcon } from "lucide-react"
import { useId, useState } from "react"

import { DateTimeInput } from "@/components/inputs/date-time-input"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { browserTimeZone } from "@/lib/format/datetime"

import { PRESETS, rangeLabel, type DateRange } from "./date-range-model"
import { instant } from "./utils"

export type { DateRange } from "./date-range-model"

/**
 * Picks Hapio's `from` (ending after) / `to` (starting before) list filters,
 * with quick presets. Times are edited in `timeZone`.
 */
export function DateRangeFilter({
  value,
  onChange,
  timeZone,
}: {
  value: DateRange
  onChange: (range: DateRange) => void
  /** Zone for presets and inputs; defaults to the browser's. */
  timeZone?: string | null
}) {
  const zone = timeZone || browserTimeZone()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>(value)
  const invalid = !!draft.from && !!draft.to && instant(draft.from) > instant(draft.to)
  const active = !!value.from || !!value.to

  const apply = (range: DateRange) => {
    onChange({ from: range.from || null, to: range.to || null })
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={active ? undefined : "text-muted-foreground"}
          aria-label={`Date range: ${rangeLabel(value, zone)}`}
        >
          <CalendarIcon />
          {rangeLabel(value, zone)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-3">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PRESETS.map((preset) => (
              <Button key={preset.key} variant="secondary" size="sm" onClick={() => apply(preset.range(zone))}>
                {preset.label}
              </Button>
            ))}
            <Button variant="secondary" size="sm" onClick={() => apply({ from: null, to: null })}>
              All dates
            </Button>
          </div>
          <Separator />
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor={`${id}-from`}>Ending after</FieldLabel>
              <DateTimeInput
                id={`${id}-from`}
                value={draft.from}
                timeZone={zone}
                invalid={invalid}
                onChange={(from) => setDraft((d) => ({ ...d, from: from || null }))}
              />
            </Field>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor={`${id}-to`}>Starting before</FieldLabel>
              <DateTimeInput
                id={`${id}-to`}
                value={draft.to}
                timeZone={zone}
                invalid={invalid}
                onChange={(to) => setDraft((d) => ({ ...d, to: to || null }))}
              />
              {invalid && <FieldError>The start of the range must be before its end.</FieldError>}
            </Field>
          </FieldGroup>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => apply({ from: null, to: null })}>
              Clear
            </Button>
            <Button size="sm" disabled={invalid} onClick={() => apply(draft)}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
