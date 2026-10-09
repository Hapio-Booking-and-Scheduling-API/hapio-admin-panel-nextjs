"use client"

import { TZDate } from "@date-fns/tz"
import { addMonths, format, startOfMonth } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useId, useState } from "react"

import { DateTimeInput } from "@/components/inputs/date-time-input"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { browserTimeZone, dayRange, formatDateTime } from "@/lib/format/datetime"

import { instant } from "./utils"

export interface DateRange {
  from: string | null
  to: string | null
}

function monthRange(timeZone: string): { from: string; to: string } {
  const start = startOfMonth(new TZDate(Date.now(), timeZone))
  return {
    from: format(start, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    to: format(addMonths(start, 1), "yyyy-MM-dd'T'HH:mm:ssxxx"),
  }
}

const PRESETS: Array<{ key: string; label: string; range: (tz: string) => { from: string; to: string } }> = [
  { key: "today", label: "Today", range: (tz) => dayRange(0, 1, tz) },
  { key: "next7", label: "Next 7 days", range: (tz) => dayRange(0, 7, tz) },
  { key: "month", label: "This month", range: monthRange },
  { key: "past7", label: "Past 7 days", range: (tz) => dayRange(-6, 7, tz) },
]

function shortStamp(iso: string, timeZone: string) {
  const time = formatDateTime(iso, { timeZone, pattern: "HH:mm" })
  return formatDateTime(iso, { timeZone, pattern: time === "00:00" ? "d MMM yyyy" : "d MMM yyyy, HH:mm" })
}

function rangeLabel({ from, to }: DateRange, timeZone: string): string {
  if (!from && !to) return "Any date"
  const preset = PRESETS.find((p) => {
    const r = p.range(timeZone)
    return instant(r.from) === instant(from) && instant(r.to) === instant(to)
  })
  if (preset) return preset.label
  if (from && to) return `${shortStamp(from, timeZone)} – ${shortStamp(to, timeZone)}`
  if (from) return `From ${shortStamp(from, timeZone)}`
  return `Until ${shortStamp(to!, timeZone)}`
}

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
        <Button variant="outline" size="sm" className={active ? undefined : "text-muted-foreground"}>
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
