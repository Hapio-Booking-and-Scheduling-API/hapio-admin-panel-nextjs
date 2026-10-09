"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { z } from "zod"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { DateTimeInput } from "@/components/inputs/date-time-input"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { toHapioDateTime, toWallTime, wallAt } from "@/lib/format/datetime"
import { pickDirty } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { indexById, toastUnlessFieldErrors, useAllLocations, useHapioMutation } from "@/lib/hapio/hooks"
import type { ScheduleBlock, ScheduleBlockInput } from "@/lib/hapio/types"

import { formatMinutes, spanMinutes } from "./utils"

const schema = z
  .object({
    location_id: z.string().min(1, "Required"),
    starts_at: z.string().min(1, "Required"),
    ends_at: z.string().min(1, "Required"),
    is_available: z.boolean(),
  })
  .refine((v) => !v.starts_at || !v.ends_at || Date.parse(v.ends_at) > Date.parse(v.starts_at), {
    path: ["ends_at"],
    message: "Must be after the start",
  })
type Values = z.infer<typeof schema>
const FIELDS = ["location_id", "starts_at", "ends_at", "is_available"]
const FIELD_MAP = { location: "location_id" }

function toValues(block: ScheduleBlock | undefined, locationId: string | null | undefined, timeZone?: string): Values {
  if (block) {
    return {
      location_id: block.location?.id ?? "",
      starts_at: block.starts_at,
      ends_at: block.ends_at,
      is_available: block.is_available,
    }
  }
  return {
    location_id: locationId ?? "",
    starts_at: toHapioDateTime(wallAt(1, 9, timeZone), timeZone),
    ends_at: toHapioDateTime(wallAt(1, 17, timeZone), timeZone),
    is_available: true,
  }
}

const TYPE_OPTIONS = [
  {
    value: "available",
    label: "Available",
    description: "Adds open time, e.g. an extra shift outside the usual hours.",
  },
  {
    value: "blocked",
    label: "Blocked (unavailable)",
    description: "Removes time from the schedule, e.g. a holiday or sick day.",
  },
] as const

/** Create or edit a one-off schedule block. Mount it only while open. */
export function ScheduleBlockFormDialog({
  resourceId,
  block,
  defaultLocationId,
  onClose,
}: {
  resourceId: string
  /** Edit this block; omit to create one. */
  block?: ScheduleBlock
  defaultLocationId?: string | null
  onClose: () => void
}) {
  const locations = useAllLocations()
  const byId = indexById(locations.data)
  const tzOf = (id: string | null | undefined) => (id ? byId.get(id)?.time_zone : undefined)

  const [formErrors, setFormErrors] = useState<string[]>([])
  const [defaults] = useState(() => toValues(block, defaultLocationId, tzOf(defaultLocationId)))
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState
  const [locationId, startsAt, endsAt] = useWatch({
    control: form.control,
    name: ["location_id", "starts_at", "ends_at"],
  })
  const timeZone = tzOf(locationId)
  const duration =
    startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt) ? formatMinutes(spanMinutes(startsAt, endsAt)) : null

  const blocks = hapio.scheduleBlocks(resourceId)
  const mutation = useHapioMutation(
    async (values: Values) => {
      if (block) return blocks.patch(block.id, pickDirty(values, dirtyFields))
      return blocks.create(values satisfies ScheduleBlockInput)
    },
    {
      success: block ? "Schedule block updated" : "Schedule block created",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: () => onClose(),
      onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, FIELDS, FIELD_MAP)),
    }
  )

  /** Keep the entered wall-clock times when switching to a location in another time zone. */
  const changeLocation = (next: string | null) => {
    const prevZone = tzOf(form.getValues("location_id"))
    const nextZone = tzOf(next)
    form.setValue("location_id", next ?? "", { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
    if (prevZone === nextZone) return
    for (const name of ["starts_at", "ends_at"] as const) {
      const value = form.getValues(name)
      if (value) form.setValue(name, toHapioDateTime(toWallTime(value, prevZone), nextZone), { shouldDirty: true })
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={block ? "Edit schedule block" : "New schedule block"}
      description="A one-off period that opens or blocks this resource's time at a location, on top of its recurring schedules."
      submitLabel={block ? "Save changes" : "Create block"}
      pending={mutation.isPending}
      formErrors={formErrors}
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        mutation.mutate(values)
      })}
    >
      <FormField
        control={form.control}
        name="location_id"
        label="Location"
        description={timeZone ? `Times are in the location's time zone (${timeZone}).` : undefined}
        render={({ field, id, invalid }) => (
          <EntityCombobox kind="location" id={id} value={field.value} onChange={changeLocation} invalid={invalid} />
        )}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="starts_at"
          label="Starts"
          render={({ field, id, invalid }) => (
            <DateTimeInput id={id} value={field.value} onChange={field.onChange} timeZone={timeZone} invalid={invalid} showZone={false} />
          )}
        />
        <FormField
          control={form.control}
          name="ends_at"
          label="Ends"
          description={duration ? `Duration: ${duration}` : undefined}
          render={({ field, id, invalid }) => (
            <DateTimeInput id={id} value={field.value} onChange={field.onChange} timeZone={timeZone} invalid={invalid} showZone={false} />
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="is_available"
        label="Type"
        render={({ field }) => (
          <RadioGroup
            value={field.value ? "available" : "blocked"}
            onValueChange={(v) => field.onChange(v === "available")}
            className="grid gap-2 sm:grid-cols-2"
          >
            {TYPE_OPTIONS.map((option) => (
              <Label
                key={option.value}
                className="flex items-start gap-3 rounded-lg border p-3 font-normal has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5"
              >
                <RadioGroupItem value={option.value} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block font-medium">{option.label}</span>
                  <span className="block leading-snug text-muted-foreground">{option.description}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}
      />
    </FormDialog>
  )
}
