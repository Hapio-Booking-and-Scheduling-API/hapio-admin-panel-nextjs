"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { FormSection } from "@/components/form/form-section"
import { JsonEditor } from "@/components/inputs/json-editor"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { toastUnlessFieldErrors, useHapioMutation } from "@/lib/hapio/hooks"
import type { Resource } from "@/lib/hapio/types"

import { FIELDS, schema, toCreateBody, toPatchBody, toValues, type Values } from "./resource-form-model"

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
    // A refetch of the resource updates the untouched fields but keeps what the user typed.
    resetOptions: { keepDirtyValues: true },
  })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  /** Closes the dialog with a clean form that shows `next` when it opens again. */
  const close = (next: Resource | undefined) => {
    form.reset(toValues(next), { keepDirtyValues: false })
    setFormErrors([])
    onOpenChange(false)
  }

  const mutation = useHapioMutation(
    async (values: Values) => {
      if (resource) return hapio.resources.patch(resource.id, toPatchBody(values, dirtyFields))
      return hapio.resources.create(toCreateBody(values))
    },
    {
      success: resource ? "Resource updated" : "Resource created",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: (saved) => {
        // The create dialog stays mounted in the kept-alive list, so start it over.
        close(resource ? saved : undefined)
        if (!resource) router.push(`/resources/${saved.id}`)
      },
      onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, FIELDS)),
    }
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close(resource))}
      title={resource ? "Edit resource" : "New resource"}
      description="Resources are the people, rooms or equipment that bookings are made with."
      submitLabel={resource ? "Save changes" : "Create resource"}
      pending={mutation.isPending}
      formErrors={formErrors}
      size="lg"
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        if (resource && Object.keys(toPatchBody(values, dirtyFields)).length === 0) {
          toast.info("No changes to save")
          close(resource)
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
