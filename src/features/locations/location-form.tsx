"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { z } from "zod"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { FormSection } from "@/components/form/form-section"
import { JsonEditor } from "@/components/inputs/json-editor"
import { OrderedResourceList } from "@/components/inputs/ordered-id-list"
import { TimezoneCombobox } from "@/components/inputs/timezone-combobox"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { browserTimeZone } from "@/lib/format/datetime"
import { metadataToText } from "@/lib/format/json"
import { metadataText, pickDirty, textToMetadata } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { toastUnlessFieldErrors, useHapioMutation } from "@/lib/hapio/hooks"
import {
  RESOURCE_SELECTION_STRATEGIES,
  type Location,
  type LocationInput,
} from "@/lib/hapio/types"

import { STRATEGY_LABELS } from "./constants"

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100, "At most 100 characters"),
  time_zone: z.string().min(1, "Required"),
  resource_selection_strategy: z.enum(RESOURCE_SELECTION_STRATEGIES),
  resource_selection_priority: z.array(z.string()),
  enabled: z.boolean(),
  metadata: metadataText(),
  protected_metadata: metadataText(),
})
type Values = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)

function toValues(location?: Location): Values {
  return {
    name: location?.name ?? "",
    time_zone: location?.time_zone ?? browserTimeZone(),
    resource_selection_strategy: location?.resource_selection_strategy ?? "randomize",
    resource_selection_priority: location?.resource_selection_priority ?? [],
    enabled: location?.enabled ?? true,
    metadata: metadataToText(location?.metadata),
    protected_metadata: metadataToText(location?.protected_metadata),
  }
}

function toBody(values: Partial<Values>): Partial<LocationInput> {
  const body: Partial<LocationInput> = {}
  if (values.name !== undefined) body.name = values.name
  if (values.time_zone !== undefined) body.time_zone = values.time_zone
  if (values.resource_selection_strategy !== undefined)
    body.resource_selection_strategy = values.resource_selection_strategy
  if (values.resource_selection_priority !== undefined)
    body.resource_selection_priority = values.resource_selection_priority
  if (values.enabled !== undefined) body.enabled = values.enabled
  if (values.metadata !== undefined) body.metadata = textToMetadata(values.metadata)
  if (values.protected_metadata !== undefined)
    body.protected_metadata = textToMetadata(values.protected_metadata)
  return body
}

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
    resetOptions: { keepDirtyValues: false },
  })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  const mutation = useHapioMutation(
    async (values: Values) => {
      if (location) {
        return hapio.locations.patch(location.id, toBody(pickDirty(values, dirtyFields)))
      }
      const body = toBody(values) as LocationInput
      if (!values.protected_metadata) delete body.protected_metadata
      return hapio.locations.create(body)
    },
    {
      success: location ? "Location updated" : "Location created",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: (saved) => {
        onOpenChange(false)
        if (!location) router.push(`/locations/${saved.id}`)
      },
      onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, FIELDS)),
    }
  )

  const strategy = useWatch({ control: form.control, name: "resource_selection_strategy" })

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(toValues(location))
          setFormErrors([])
        }
        onOpenChange(next)
      }}
      title={location ? "Edit location" : "New location"}
      description="Locations hold a time zone and decide how resources are picked for bookings."
      submitLabel={location ? "Save changes" : "Create location"}
      pending={mutation.isPending}
      formErrors={formErrors}
      size="lg"
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
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
        render={({ field }) => (
          <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-2">
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
