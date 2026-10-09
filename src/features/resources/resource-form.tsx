"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { FormSection } from "@/components/form/form-section"
import { JsonEditor } from "@/components/inputs/json-editor"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { metadataToText } from "@/lib/format/json"
import { metadataText, pickDirty, textToMetadata } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { toastUnlessFieldErrors, useHapioMutation } from "@/lib/hapio/hooks"
import type { Resource, ResourceInput } from "@/lib/hapio/types"

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100, "At most 100 characters"),
  /** null = unlimited; otherwise the number as typed. */
  max_simultaneous_bookings: z
    .string()
    .nullable()
    .refine((v) => v === null || /^\d+$/.test(v.trim()), "Enter a whole number")
    .refine((v) => v === null || !/^\d+$/.test(v.trim()) || Number(v) >= 1, "Must be at least 1"),
  enabled: z.boolean(),
  metadata: metadataText(),
  protected_metadata: metadataText(),
})
type Values = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)

function toValues(resource?: Resource): Values {
  const max = resource?.max_simultaneous_bookings
  return {
    name: resource?.name ?? "",
    max_simultaneous_bookings: max === null || max === undefined ? null : String(max),
    enabled: resource?.enabled ?? true,
    metadata: metadataToText(resource?.metadata),
    protected_metadata: metadataToText(resource?.protected_metadata),
  }
}

function toBody(values: Partial<Values>): Partial<ResourceInput> {
  const body: Partial<ResourceInput> = {}
  if (values.name !== undefined) body.name = values.name
  if (values.max_simultaneous_bookings !== undefined)
    body.max_simultaneous_bookings =
      values.max_simultaneous_bookings === null ? null : Number(values.max_simultaneous_bookings)
  if (values.enabled !== undefined) body.enabled = values.enabled
  if (values.metadata !== undefined) body.metadata = textToMetadata(values.metadata)
  if (values.protected_metadata !== undefined)
    body.protected_metadata = textToMetadata(values.protected_metadata)
  return body
}

export function ResourceFormDialog({
  open,
  onOpenChange,
  resource,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this resource; omit to create a new one. */
  resource?: Resource
}) {
  const router = useRouter()
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: toValues(resource),
    resetOptions: { keepDirtyValues: false },
  })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  const mutation = useHapioMutation(
    async (values: Values) => {
      if (resource) {
        return hapio.resources.patch(resource.id, toBody(pickDirty(values, dirtyFields)))
      }
      const body = toBody(values) as ResourceInput
      if (!values.protected_metadata) delete body.protected_metadata
      return hapio.resources.create(body)
    },
    {
      success: resource ? "Resource updated" : "Resource created",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: (saved) => {
        onOpenChange(false)
        if (!resource) router.push(`/resources/${saved.id}`)
      },
      onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, FIELDS)),
    }
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(toValues(resource))
          setFormErrors([])
        }
        onOpenChange(next)
      }}
      title={resource ? "Edit resource" : "New resource"}
      description="Resources are the people, rooms or equipment that bookings are made with."
      submitLabel={resource ? "Save changes" : "Create resource"}
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
        name="max_simultaneous_bookings"
        label="Max simultaneous bookings"
        description="How many bookings the resource can take at the same time, e.g. seats in a class."
        render={({ field, id, invalid }) => {
          const unlimited = field.value === null
          return (
            <div className="flex flex-wrap items-center gap-4">
              <Input
                id={id}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                className="w-28"
                placeholder={unlimited ? "Unlimited" : "1"}
                disabled={unlimited}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                aria-invalid={invalid || undefined}
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={unlimited}
                  onCheckedChange={(checked) => field.onChange(checked ? null : "1")}
                />
                Unlimited
              </label>
            </div>
          )
        }}
      />
      <FormField
        control={form.control}
        name="enabled"
        label="Enabled"
        description="Disabled resources can't take new bookings."
        orientation="horizontal"
        render={({ field, id }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />}
      />
      <FormSection title="Metadata" description="Free-form JSON objects, up to 1000 characters each.">
        <FormField
          control={form.control}
          name="metadata"
          label="Metadata"
          render={({ field, id, invalid }) => (
            <JsonEditor id={id} value={field.value} onChange={field.onChange} invalid={invalid} />
          )}
        />
        <FormField
          control={form.control}
          name="protected_metadata"
          label="Protected metadata"
          description="Requires the resource:protected_metadata ability."
          render={({ field, id, invalid }) => (
            <JsonEditor id={id} value={field.value} onChange={field.onChange} invalid={invalid} />
          )}
        />
      </FormSection>
    </FormDialog>
  )
}
