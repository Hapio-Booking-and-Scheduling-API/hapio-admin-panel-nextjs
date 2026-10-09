"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { z } from "zod"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Switch } from "@/components/ui/switch"
import { todayIn } from "@/lib/format/datetime"
import { pickDirty } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { indexById, toastUnlessFieldErrors, useAllLocations, useHapioMutation } from "@/lib/hapio/hooks"
import type { RecurringSchedule, RecurringScheduleInput } from "@/lib/hapio/types"

import { isDateString } from "./utils"

const schema = z
  .object({
    location_id: z.string().min(1, "Required"),
    start_date: z.string().refine(isDateString, "Pick a date"),
    /** null = runs indefinitely */
    end_date: z
      .string()
      .nullable()
      .refine((v) => v === null || isDateString(v), "Pick a date"),
    interval: z
      .string()
      .refine((v) => /^\d+$/.test(v.trim()), "Enter a whole number")
      .refine((v) => !/^\d+$/.test(v.trim()) || Number(v) >= 1, "Must be at least 1"),
  })
  .refine((v) => v.end_date === null || !isDateString(v.start_date) || v.end_date >= v.start_date, {
    path: ["end_date"],
    message: "Can't be before the start date",
  })
type Values = z.infer<typeof schema>
const FIELDS = ["location_id", "start_date", "end_date", "interval"]
const FIELD_MAP = { location: "location_id" }

function toValues(schedule: RecurringSchedule | undefined, locationId: string | null | undefined, timeZone?: string): Values {
  if (schedule) {
    return {
      location_id: schedule.location?.id ?? "",
      start_date: schedule.start_date,
      end_date: schedule.end_date,
      interval: String(schedule.interval),
    }
  }
  return { location_id: locationId ?? "", start_date: todayIn(timeZone), end_date: null, interval: "1" }
}

function toBody(values: Partial<Values>): Partial<RecurringScheduleInput> {
  const body: Partial<RecurringScheduleInput> = {}
  if (values.location_id !== undefined) body.location_id = values.location_id
  if (values.start_date !== undefined) body.start_date = values.start_date
  if (values.end_date !== undefined) body.end_date = values.end_date
  if (values.interval !== undefined) body.interval = Number(values.interval)
  return body
}

/** Create or edit a recurring schedule. Mount it only while open. */
export function RecurringScheduleFormDialog({
  resourceId,
  schedule,
  defaultLocationId,
  onClose,
  onCreated,
}: {
  resourceId: string
  /** Edit this schedule; omit to create one. */
  schedule?: RecurringSchedule
  defaultLocationId?: string | null
  onClose: () => void
  onCreated?: (schedule: RecurringSchedule) => void
}) {
  const locations = useAllLocations()
  const byId = indexById(locations.data)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [defaults] = useState(() =>
    toValues(schedule, defaultLocationId, defaultLocationId ? byId.get(defaultLocationId)?.time_zone : undefined)
  )
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState
  const [locationId, interval] = useWatch({ control: form.control, name: ["location_id", "interval"] })
  const timeZone = locationId ? byId.get(locationId)?.time_zone : undefined
  const weeks = Number(interval)

  const schedules = hapio.recurringSchedules(resourceId)
  const mutation = useHapioMutation(
    async (values: Values) => {
      if (schedule) return schedules.patch(schedule.id, toBody(pickDirty(values, dirtyFields)))
      return schedules.create(toBody(values) as RecurringScheduleInput)
    },
    {
      success: schedule ? "Recurring schedule updated" : "Recurring schedule created",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: (saved) => {
        onClose()
        if (!schedule) onCreated?.(saved)
      },
      onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, FIELDS, FIELD_MAP)),
    }
  )

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={schedule ? "Edit recurring schedule" : "New recurring schedule"}
      description="Weekly opening hours at a location for a date range. Add its weekday blocks after saving."
      submitLabel={schedule ? "Save changes" : "Create schedule"}
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
        description={timeZone ? `Dates and times are in ${timeZone}.` : undefined}
        render={({ field, id, invalid }) => (
          <EntityCombobox kind="location" id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
        )}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="start_date"
          label="Start date"
          render={({ field, id, invalid }) => <Input id={id} type="date" {...field} aria-invalid={invalid || undefined} />}
        />
        <FormField
          control={form.control}
          name="end_date"
          label="End date"
          render={({ field, id, invalid }) => (
            <div className="space-y-2">
              <Input
                id={id}
                type="date"
                value={field.value ?? ""}
                disabled={field.value === null}
                min={form.getValues("start_date") || undefined}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                aria-invalid={invalid || undefined}
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  size="sm"
                  checked={field.value === null}
                  onCheckedChange={(checked) =>
                    field.onChange(checked ? null : form.getValues("start_date") || todayIn(timeZone))
                  }
                />
                Runs indefinitely
              </label>
            </div>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="interval"
        label="Repeat"
        description={
          weeks > 1
            ? `The weekly blocks apply once every ${weeks} weeks, counting from the week of the start date.`
            : "The weekly blocks apply every week."
        }
        render={({ field, id, invalid }) => (
          // Wrapped so the Field's full-width rule doesn't stretch it.
          <div>
            <InputGroup className="w-40">
              <InputGroupAddon>
                <InputGroupText>Every</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id={id}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                {...field}
                aria-invalid={invalid || undefined}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{weeks === 1 ? "week" : "weeks"}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </div>
        )}
      />
    </FormDialog>
  )
}
