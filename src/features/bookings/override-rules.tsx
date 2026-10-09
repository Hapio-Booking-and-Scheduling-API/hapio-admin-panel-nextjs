"use client"

import { ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { useWatch, type Control, type FieldPath } from "react-hook-form"

import { FormField } from "@/components/form/form-field"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { FieldGroup } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import type { BookingIgnoreFlags } from "@/lib/hapio/types"

export type IgnoreFlag = keyof BookingIgnoreFlags | "ignore_cancelation_threshold"

/** Form values every booking form with an "Override rules" section carries. */
export type IgnoreFlagValues = Record<IgnoreFlag, boolean>

export const IGNORE_FLAG_DEFAULTS: IgnoreFlagValues = {
  ignore_schedule: false,
  ignore_fully_booked: false,
  ignore_bookable_slots: false,
  ignore_booking_window: false,
  ignore_cancelation_threshold: false,
}

export const IGNORE_FLAGS: Array<{ key: IgnoreFlag; label: string; description: string; editOnly?: boolean }> = [
  {
    key: "ignore_schedule",
    label: "Ignore schedule",
    description: "Allow times outside the resource's schedule. Also ignores bookable slots.",
  },
  {
    key: "ignore_fully_booked",
    label: "Ignore fully booked",
    description: "Allow the booking even when the resource is already fully booked (overbooking).",
  },
  {
    key: "ignore_bookable_slots",
    label: "Ignore bookable slots",
    description:
      "Allow start and end times that don't match the service's bookable slots, and custom buffer times.",
  },
  {
    key: "ignore_booking_window",
    label: "Ignore booking window",
    description: "Allow times outside the service's booking window (how soon or how far ahead it can be booked).",
  },
  {
    key: "ignore_cancelation_threshold",
    label: "Ignore cancelation threshold",
    description: "Allow canceling after the service's cancelation threshold has passed.",
    editOnly: true,
  },
]

const CREATE_FLAGS = IGNORE_FLAGS.filter((f) => !f.editOnly)

/** The `ignore_*` flags that are switched on, ready to merge into a request body. */
export function activeIgnoreFlags(values: IgnoreFlagValues, options: { cancelation?: boolean } = {}) {
  const flags: Partial<IgnoreFlagValues> = {}
  for (const { key, editOnly } of IGNORE_FLAGS) {
    if (editOnly && !options.cancelation) continue
    if (values[key]) flags[key] = true
  }
  return flags
}

/** A bordered, collapsible block inside a form. */
export function CollapsibleSection({
  title,
  description,
  badge,
  defaultOpen = false,
  forceOpen = false,
  children,
}: {
  title: string
  description?: string
  badge?: React.ReactNode
  defaultOpen?: boolean
  /** Keep the section open, e.g. while it contains errors. */
  forceOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open || forceOpen} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2 rounded-lg p-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{title}</span>
            {description && <span className="block text-xs text-muted-foreground">{description}</span>}
          </span>
          {badge}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-3">
        <FieldGroup className="gap-4">{children}</FieldGroup>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * "Override rules": switches for Hapio's `ignore_*` flags. Each needs the
 * matching `booking:ignore_*` ability on the API token.
 */
export function OverrideRulesSection<T extends IgnoreFlagValues>({
  control,
  includeCancelation = false,
  description,
}: {
  control: Control<T>
  /** Also show ignore_cancelation_threshold (edit forms). */
  includeCancelation?: boolean
  description?: string
}) {
  const flags = includeCancelation ? IGNORE_FLAGS : CREATE_FLAGS
  const values = useWatch({ control, name: flags.map((f) => f.key) as Array<FieldPath<T>> }) as unknown[]
  const active = values.filter(Boolean).length
  const ignoreSchedule = !!values[flags.findIndex((f) => f.key === "ignore_schedule")]

  return (
    <CollapsibleSection
      title="Override rules"
      description={description ?? "Bypass availability checks. Each needs the matching token ability."}
      badge={active > 0 ? <Badge variant="secondary">{active} on</Badge> : undefined}
      defaultOpen={active > 0}
    >
      {flags.map((flag) => (
        <FormField
          key={flag.key}
          control={control}
          name={flag.key as FieldPath<T>}
          label={flag.label}
          orientation="horizontal"
          description={
            <>
              {flag.description} Requires <code className="text-xs">booking:{flag.key}</code>.
            </>
          }
          render={({ field, id }) => {
            const implied = flag.key === "ignore_bookable_slots" && ignoreSchedule
            return (
              <Switch
                id={id}
                checked={!!field.value || implied}
                disabled={implied}
                onCheckedChange={field.onChange}
              />
            )
          }}
        />
      ))}
    </CollapsibleSection>
  )
}
