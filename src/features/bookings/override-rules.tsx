"use client"

import { ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { get, useFormState, useWatch, type Control, type FieldPath } from "react-hook-form"

import { FormField } from "@/components/form/form-field"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { FieldGroup } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"

import {
  CREATE_FLAGS,
  IGNORE_FLAGS,
  type IgnoreFlagValues,
} from "./override-rules-model"

export {
  IGNORE_FLAG_DEFAULTS,
  IGNORE_FLAGS,
  activeIgnoreFlags,
  type IgnoreFlag,
  type IgnoreFlagValues,
} from "./override-rules-model"

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
  /** Open the section whenever this turns true, e.g. when a field inside it gets an error. */
  forceOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen)
  // Opens on errors, then stays open (while the user fixes them) until closed by hand.
  const [forced, setForced] = useState(forceOpen)
  if (forced !== forceOpen) {
    setForced(forceOpen)
    if (forceOpen) setOpen(true)
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
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
  const names = flags.map((f) => f.key) as Array<FieldPath<T>>
  const values = useWatch({ control, name: names }) as unknown[]
  const { errors } = useFormState({ control, name: names })
  const active = values.filter(Boolean).length
  const ignoreSchedule = !!values[flags.findIndex((f) => f.key === "ignore_schedule")]

  return (
    <CollapsibleSection
      title="Override rules"
      description={description ?? "Bypass availability checks. Each needs the matching token ability."}
      badge={active > 0 ? <Badge variant="secondary">{active} on</Badge> : undefined}
      defaultOpen={active > 0}
      forceOpen={names.some((name) => !!get(errors, name))}
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
