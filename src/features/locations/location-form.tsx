"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField, labelIdFor } from "@/components/form/form-field"
import { FormSection } from "@/components/form/form-section"
import { JsonEditor } from "@/components/inputs/json-editor"
import { OrderedResourceList } from "@/components/inputs/ordered-id-list"
import { TimezoneCombobox } from "@/components/inputs/timezone-combobox"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { toastUnlessFieldErrors, useHapioMutation } from "@/lib/hapio/hooks"
import { RESOURCE_SELECTION_STRATEGIES, type Location } from "@/lib/hapio/types"

import { STRATEGY_LABELS } from "./constants"
import { FIELDS, schema, toCreateBody, toPatchBody, toValues, type Values } from "./location-form-model"

export function LocationFormDialog({
  open,
  onOpenChange,
  location,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this location; omit to create a new one. */
  location?: Location
}) {
  const router = useRouter()
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: toValues(location),
    // A refetch of the location updates the untouched fields but keeps what the user typed.
    resetOptions: { keepDirtyValues: true },
  })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  /** Closes the dialog with a clean form that shows `next` when it opens again. */
  const close = (next: Location | undefined) => {
    form.reset(toValues(next), { keepDirtyValues: false })
    setFormErrors([])
    onOpenChange(false)
  }

  const mutation = useHapioMutation(
    async (values: Values) => {
      if (location) {
        return hapio.locations.patch(location.id, toPatchBody(values, dirtyFields))
      }
      return hapio.locations.create(toCreateBody(values))
    },
    {
      success: location ? "Location updated" : "Location created",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: (saved) => {
        // The dialog stays mounted (detail page, kept-alive list): reopen it clean, without these edits.
        close(location ? saved : undefined)
        if (!location) router.push(`/locations/${saved.id}`)
      },
      onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, FIELDS)),
    }
  )

  const strategy = useWatch({ control: form.control, name: "resource_selection_strategy" })

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close(location))}
      title={location ? "Edit location" : "New location"}
      description="Locations hold a time zone and decide how resources are picked for bookings."
      submitLabel={location ? "Save changes" : "Create location"}
      pending={mutation.isPending}
      formErrors={formErrors}
      size="lg"
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        if (location && Object.keys(toPatchBody(values, dirtyFields)).length === 0) {
          toast.info("No changes to save")
          close(location)
          return
        }
        mutation.mutate(values)
      })}
    >
      <FormField
        control={form.control}
        name="name"
        label="Name"
        render={({ field, id, invalid }) => <Input id={id} {...field} aria-invalid={invalid} autoFocus />}
      />
      <FormField
        control={form.control}
        name="time_zone"
        label="Time zone"
        description="Dates and times for schedules at this location are interpreted in this zone."
        render={({ field, id, invalid }) => (
          <TimezoneCombobox id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
        )}
      />
      <FormField
        control={form.control}
        name="resource_selection_strategy"
        label="Resource selection"
        description="Used when a booking is created without a resource."
        render={({ field, id }) => (
          <RadioGroup
            value={field.value}
            onValueChange={field.onChange}
            className="gap-2"
            aria-labelledby={labelIdFor(id)}
          >
            {RESOURCE_SELECTION_STRATEGIES.map((s) => (
              <Label key={s} className="flex items-start gap-3 rounded-lg border p-3 font-normal has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5">
                <RadioGroupItem value={s} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block font-medium">{STRATEGY_LABELS[s].label}</span>
                  <span className="block text-muted-foreground">{STRATEGY_LABELS[s].description}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}
      />
      {strategy === "prioritize" && (
        <FormField
          control={form.control}
          name="resource_selection_priority"
          label="Priority order"
          description="Resources tried first to last."
          render={({ field }) => <OrderedResourceList value={field.value} onChange={field.onChange} />}
        />
      )}
      <FormField
        control={form.control}
        name="enabled"
        label="Enabled"
        description="Disabled locations can't take new bookings."
        orientation="horizontal"
        render={({ field, id }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />}
      />
      <FormSection title="Metadata" description="Free-form JSON objects, up to 1000 characters each.">
        <FormField
          control={form.control}
          name="metadata"
          label="Metadata"
          render={({ field, id, invalid }) => <JsonEditor id={id} value={field.value} onChange={field.onChange} invalid={invalid} />}
        />
        <FormField
          control={form.control}
          name="protected_metadata"
          label="Protected metadata"
          description="Requires the location:protected_metadata ability."
          render={({ field, id, invalid }) => <JsonEditor id={id} value={field.value} onChange={field.onChange} invalid={invalid} />}
        />
      </FormSection>
    </FormDialog>
  )
}
