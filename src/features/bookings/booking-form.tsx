"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useForm, useWatch, type UseFormReturn } from "react-hook-form"
import { toast } from "sonner"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { FormSection } from "@/components/form/form-section"
import { DateTimeInput } from "@/components/inputs/date-time-input"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { JsonEditor } from "@/components/inputs/json-editor"
import { PriceInput } from "@/components/inputs/price-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { formatPrice } from "@/lib/format/price"
import { pickDirty } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { indexById, toastUnlessFieldErrors, useAllLocations, useAllServices, useHapioMutation } from "@/lib/hapio/hooks"
import type { Booking, BookingPatch, BookingPost } from "@/lib/hapio/types"

import {
  FIELDS,
  bookingToValues,
  emptyValues,
  schema,
  serviceBuffers,
  toPatchBody,
  toPostBody,
  type BookingFormDefaults,
  type Mode,
  type Values,
} from "./booking-form-model"
import { FormErrorsAlert } from "./form-errors"
import { BookingGroupIdInput } from "./group-id-input"
import { CollapsibleSection, OverrideRulesSection } from "./override-rules"
import { ServiceResourceCombobox } from "./service-resource-combobox"
import { endAfterStartChange, formatMinutes, minutesBetween, rezoneWallTime } from "./utils"

export type { BookingFormDefaults } from "./booking-form-model"

// ---------------------------------------------------------------------------
// Fields

function BookingFields({
  form,
  mode,
  booking,
}: {
  form: UseFormReturn<Values>
  mode: Mode
  booking?: Booking
}) {
  const { control } = form
  const services = useAllServices()
  const locations = useAllLocations()
  const serviceById = indexById(services.data)
  const locationById = indexById(locations.data)

  const [serviceId, locationId, startsAt, endsAt, autoPrice, customBuffers] = useWatch({
    control,
    name: ["service_id", "location_id", "starts_at", "ends_at", "auto_price", "custom_buffers"],
  })
  const service = serviceById.get(serviceId)
  const timeZone = locationById.get(locationId)?.time_zone
  const length = startsAt && endsAt ? minutesBetween(startsAt, endsAt) : null
  const errors = form.formState.errors
  const bufferErrors = !!(errors.custom_buffers || errors.buffer_starts_at || errors.buffer_ends_at)

  const setTime = (name: "starts_at" | "ends_at" | "buffer_starts_at" | "buffer_ends_at", value: string) =>
    form.setValue(name, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <FormField
          control={control}
          name="service_id"
          label="Service"
          render={({ field, id, invalid }) => (
            <EntityCombobox
              kind="service"
              id={id}
              invalid={invalid}
              value={field.value || null}
              onChange={(next) => {
                field.onChange(next ?? "")
                // Fill in the end from the new service's length when it's still empty.
                const end = endAfterStartChange({
                  previousStart: "",
                  nextStart: form.getValues("starts_at"),
                  end: form.getValues("ends_at"),
                  service: serviceById.get(next ?? ""),
                  timeZone,
                })
                if (end) setTime("ends_at", end)
              }}
            />
          )}
        />
        <FormField
          control={control}
          name="location_id"
          label="Location"
          description={timeZone ? `Times are in ${timeZone}.` : "Times are entered in the location's time zone."}
          render={({ field, id, invalid }) => (
            <EntityCombobox
              kind="location"
              id={id}
              invalid={invalid}
              value={field.value || null}
              onChange={(next) => {
                const fromZone = locationById.get(field.value)?.time_zone
                const toZone = locationById.get(next ?? "")?.time_zone
                field.onChange(next ?? "")
                if (fromZone === toZone) return
                // Keep the wall times the user entered, now in the new location's zone.
                for (const name of ["starts_at", "ends_at", "buffer_starts_at", "buffer_ends_at"] as const) {
                  const value = form.getValues(name)
                  if (value) setTime(name, rezoneWallTime(value, fromZone, toZone))
                }
              }}
            />
          )}
        />
        <FormField
          control={control}
          name="resource_id"
          label="Resource"
          description={
            mode === "create"
              ? "Leave empty to let Hapio pick one using the location's selection strategy."
              : undefined
          }
          className="md:col-span-2"
          render={({ field, id, invalid }) => (
            <ServiceResourceCombobox
              id={id}
              invalid={invalid}
              serviceId={serviceId}
              clearable={mode === "create"}
              placeholder={mode === "create" ? "Auto-select" : "No resource"}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      <FormSection
        title="Time"
        description={
          length !== null && length > 0
            ? `Length: ${formatMinutes(length)}. Changing the start keeps the length.`
            : "Changing the start keeps the booking's length."
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            control={control}
            name="starts_at"
            label="Starts"
            render={({ field, id, invalid }) => (
              <DateTimeInput
                id={id}
                invalid={invalid}
                timeZone={timeZone}
                value={field.value}
                onChange={(next) => {
                  const end = endAfterStartChange({
                    previousStart: field.value,
                    nextStart: next,
                    end: form.getValues("ends_at"),
                    service,
                    timeZone,
                  })
                  field.onChange(next)
                  if (end) setTime("ends_at", end)
                }}
              />
            )}
          />
          <FormField
            control={control}
            name="ends_at"
            label="Ends"
            render={({ field, id, invalid }) => (
              <DateTimeInput id={id} invalid={invalid} timeZone={timeZone} value={field.value} onChange={field.onChange} />
            )}
          />
        </div>
      </FormSection>

      <FormSection title="Price & status">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <FormField
              control={control}
              name="auto_price"
              label="Calculate price automatically"
              orientation="horizontal"
              description={
                mode === "create"
                  ? "From the booking's length and the service's price."
                  : "Hapio recalculates it only when the service or times change."
              }
              render={({ field, id }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />}
            />
            <FormField
              control={control}
              name="price"
              label="Price"
              description={autoPrice ? undefined : "Leave empty for no price."}
              render={({ field, id, invalid }) => (
                <PriceInput
                  id={id}
                  invalid={invalid}
                  disabled={autoPrice}
                  placeholder={autoPrice ? "Calculated by Hapio" : "No price"}
                  value={autoPrice && mode === "create" ? "" : field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          <div className="flex flex-col gap-3">
            {mode === "create" && (
              <FormField
                control={control}
                name="is_temporary"
                label="Temporary"
                orientation="horizontal"
                description="Hold the time without confirming it, e.g. during checkout. Finalize it later."
                render={({ field, id }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />}
              />
            )}
            {mode === "edit" && booking?.is_temporary && (
              <FormField
                control={control}
                name="is_temporary"
                label="Temporary"
                orientation="horizontal"
                description="Turn off to finalize the booking."
                render={({ field, id }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />}
              />
            )}
            {mode === "edit" && (
              <FormField
                control={control}
                name="is_canceled"
                label="Canceled"
                orientation="horizontal"
                description="Canceled bookings are kept but free up their time. Subject to the service's cancelation threshold."
                render={({ field, id }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />}
              />
            )}
          </div>
        </div>
      </FormSection>

      <FormSection title="Group & metadata">
        <FormField
          control={control}
          name="booking_group_id"
          label="Booking group"
          description={
            mode === "edit" ? "Clear to remove the booking from its group." : "Optional. Paste an ID or pick a recent group."
          }
          render={({ field, id, invalid }) => (
            <BookingGroupIdInput id={id} invalid={invalid} value={field.value} onChange={field.onChange} />
          )}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            control={control}
            name="metadata"
            label="Metadata"
            description="Free-form JSON object."
            render={({ field, id, invalid }) => (
              <JsonEditor id={id} value={field.value} onChange={field.onChange} invalid={invalid} rows={4} />
            )}
          />
          <FormField
            control={control}
            name="protected_metadata"
            label="Protected metadata"
            description="Requires the booking:protected_metadata ability."
            render={({ field, id, invalid }) => (
              <JsonEditor id={id} value={field.value} onChange={field.onChange} invalid={invalid} rows={4} />
            )}
          />
        </div>
      </FormSection>

      <div className="flex flex-col gap-3">
        <OverrideRulesSection control={control} includeCancelation={mode === "edit"} />
        <CollapsibleSection
          title="Custom buffers"
          description="Override the buffer times from the service."
          badge={customBuffers ? <Badge variant="secondary">On</Badge> : undefined}
          forceOpen={bufferErrors}
        >
          <FormField
            control={control}
            name="custom_buffers"
            label="Set buffers manually"
            orientation="horizontal"
            description={
              <>
                By default Hapio derives buffers from the service
                {service ? ` (${serviceBuffers(service)})` : ""}.
                Custom values need “Ignore bookable slots”.
              </>
            }
            render={({ field, id }) => (
              <Switch
                id={id}
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked)
                  if (!checked) return
                  if (!form.getValues("buffer_starts_at") && startsAt) setTime("buffer_starts_at", startsAt)
                  if (!form.getValues("buffer_ends_at") && endsAt) setTime("buffer_ends_at", endsAt)
                }}
              />
            )}
          />
          <div className="grid gap-5 md:grid-cols-2">
            <FormField
              control={control}
              name="buffer_starts_at"
              label="Buffer starts"
              render={({ field, id, invalid }) => (
                <DateTimeInput
                  id={id}
                  invalid={invalid}
                  disabled={!customBuffers}
                  timeZone={timeZone}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <FormField
              control={control}
              name="buffer_ends_at"
              label="Buffer ends"
              render={({ field, id, invalid }) => (
                <DateTimeInput
                  id={id}
                  invalid={invalid}
                  disabled={!customBuffers}
                  timeZone={timeZone}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
        </CollapsibleSection>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Create (full page)

/**
 * A prefilled start without an end (e.g. `/bookings/new?service=…&starts_at=…`) gets the
 * service's length, like picking the start by hand does. Runs once, when the service (and
 * the location's time zone) are known.
 */
function usePrefilledEnd(form: UseFormReturn<Values>, defaults: BookingFormDefaults | undefined) {
  const services = useAllServices()
  const locations = useAllLocations()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    const { service_id, location_id, starts_at, ends_at } = defaults ?? {}
    if (!service_id || !starts_at || ends_at) {
      done.current = true
      return
    }
    if (!services.data || (location_id && !locations.data)) return
    done.current = true
    if (form.getValues("ends_at")) return
    const end = endAfterStartChange({
      previousStart: "",
      nextStart: form.getValues("starts_at"),
      end: "",
      service: indexById(services.data).get(form.getValues("service_id")),
      timeZone: indexById(locations.data).get(form.getValues("location_id"))?.time_zone,
    })
    if (end) form.setValue("ends_at", end, { shouldDirty: true })
  }, [defaults, form, services.data, locations.data])
}

/** The `/bookings/new` form. `defaults` prefill it (e.g. from a bookable slot). */
export function BookingCreateForm({ defaults }: { defaults?: BookingFormDefaults }) {
  const router = useRouter()
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues(defaults),
  })
  usePrefilledEnd(form, defaults)

  const mutation = useHapioMutation((body: BookingPost) => hapio.bookings.create(body), {
    success: "Booking created",
    toastErrors: toastUnlessFieldErrors,
    onSuccess: (saved) => router.push(`/bookings/${saved.id}`),
    onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, FIELDS)),
  })

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        mutation.mutate(toPostBody(values))
      })}
      className="w-full max-w-3xl"
    >
      <Card>
        <CardContent>
          <FieldGroup>
            <BookingFields form={form} mode="create" />
            <FormErrorsAlert errors={formErrors} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/bookings">Cancel</Link>
          </Button>
          <Button type="submit" disabled={mutation.isPending || mutation.isSuccess} aria-busy={mutation.isPending}>
            {(mutation.isPending || mutation.isSuccess) && <Spinner aria-hidden />}
            Create booking
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Edit (dialog)

export function BookingEditDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: Booking
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: bookingToValues(booking),
    // A background refetch updates the untouched fields and keeps the user's edits.
    resetOptions: { keepDirtyValues: true },
  })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  const mutation = useHapioMutation((body: BookingPatch) => hapio.bookings.patch(booking.id, body), {
    success: "Booking updated",
    toastErrors: toastUnlessFieldErrors,
    onSuccess: () => onOpenChange(false),
    onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, FIELDS)),
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // Discard the edits (reset() would otherwise apply resetOptions and keep them).
          form.reset(bookingToValues(booking), { keepDirtyValues: false })
          setFormErrors([])
        }
        onOpenChange(next)
      }}
      title="Edit booking"
      description={
        <>
          Only changed fields are sent. Price{booking.price ? ` (now ${formatPrice(booking.price)})` : ""} and buffers
          are recalculated when the times or service change.
        </>
      }
      submitLabel="Save changes"
      pending={mutation.isPending}
      formErrors={formErrors}
      size="xl"
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        const body = toPatchBody(values, pickDirty(values, dirtyFields))
        if (!body) {
          toast.info("No changes to save")
          onOpenChange(false)
          return
        }
        mutation.mutate(body)
      })}
    >
      <BookingFields form={form} mode="edit" booking={booking} />
    </FormDialog>
  )
}
