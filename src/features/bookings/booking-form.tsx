"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm, useWatch, type UseFormReturn } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

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
import { humanizeDuration, isZeroDuration } from "@/lib/format/duration"
import { metadataToText } from "@/lib/format/json"
import { formatPrice } from "@/lib/format/price"
import { metadataText, pickDirty, priceText, textToMetadata, textToPrice } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { indexById, toastUnlessFieldErrors, useAllLocations, useAllServices, useHapioMutation } from "@/lib/hapio/hooks"
import type { Booking, BookingPatch, BookingPost, Service } from "@/lib/hapio/types"

import { FormErrorsAlert } from "./form-errors"
import { BookingGroupIdInput } from "./group-id-input"
import {
  CollapsibleSection,
  IGNORE_FLAG_DEFAULTS,
  OverrideRulesSection,
  activeIgnoreFlags,
} from "./override-rules"
import { ServiceResourceCombobox } from "./service-resource-combobox"
import {
  UUID_RE,
  endAfterStartChange,
  formatMinutes,
  instant,
  minutesBetween,
  rezoneWallTime,
} from "./utils"

const schema = z
  .object({
    service_id: z.string().min(1, "Select a service"),
    location_id: z.string().min(1, "Select a location"),
    /** "" = let Hapio pick (create only). */
    resource_id: z.string(),
    starts_at: z.string().min(1, "Required"),
    ends_at: z.string().min(1, "Required"),
    /** On: leave the price to Hapio (omit it from the request). */
    auto_price: z.boolean(),
    price: priceText(),
    is_temporary: z.boolean(),
    is_canceled: z.boolean(),
    booking_group_id: z
      .string()
      .trim()
      .refine((v) => v === "" || UUID_RE.test(v), "Not a valid booking group ID"),
    metadata: metadataText(),
    protected_metadata: metadataText(),
    ignore_schedule: z.boolean(),
    ignore_fully_booked: z.boolean(),
    ignore_bookable_slots: z.boolean(),
    ignore_booking_window: z.boolean(),
    ignore_cancelation_threshold: z.boolean(),
    custom_buffers: z.boolean(),
    buffer_starts_at: z.string(),
    buffer_ends_at: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.starts_at && v.ends_at && instant(v.ends_at) <= instant(v.starts_at)) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "Must be after the start" })
    }
    if (!v.custom_buffers) return
    if (!v.buffer_starts_at) {
      ctx.addIssue({ code: "custom", path: ["buffer_starts_at"], message: "Required" })
    } else if (v.starts_at && instant(v.buffer_starts_at) > instant(v.starts_at)) {
      ctx.addIssue({ code: "custom", path: ["buffer_starts_at"], message: "Must be at or before the start" })
    }
    if (!v.buffer_ends_at) {
      ctx.addIssue({ code: "custom", path: ["buffer_ends_at"], message: "Required" })
    } else if (v.ends_at && instant(v.buffer_ends_at) < instant(v.ends_at)) {
      ctx.addIssue({ code: "custom", path: ["buffer_ends_at"], message: "Must be at or after the end" })
    }
    if (!v.ignore_bookable_slots && !v.ignore_schedule) {
      ctx.addIssue({
        code: "custom",
        path: ["custom_buffers"],
        message: "Custom buffers need “Ignore bookable slots” (under Override rules).",
      })
    }
  })

type Values = z.infer<typeof schema>
type Mode = "create" | "edit"
const FIELDS = Object.keys(schema.shape)

/** Prefill for a new booking (e.g. from URL search params). */
export type BookingFormDefaults = Partial<
  Pick<Values, "service_id" | "location_id" | "resource_id" | "starts_at" | "ends_at" | "is_temporary" | "booking_group_id">
>

function emptyValues(defaults: BookingFormDefaults = {}): Values {
  return {
    service_id: "",
    location_id: "",
    resource_id: "",
    starts_at: "",
    ends_at: "",
    auto_price: true,
    price: "",
    is_temporary: false,
    is_canceled: false,
    booking_group_id: "",
    metadata: "",
    protected_metadata: "",
    ...IGNORE_FLAG_DEFAULTS,
    custom_buffers: false,
    buffer_starts_at: "",
    buffer_ends_at: "",
    ...defaults,
  }
}

function bookingToValues(booking: Booking): Values {
  return {
    service_id: booking.service?.id ?? "",
    location_id: booking.location?.id ?? "",
    resource_id: booking.resource?.id ?? "",
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    auto_price: true,
    price: booking.price ?? "",
    is_temporary: booking.is_temporary,
    is_canceled: booking.is_canceled,
    booking_group_id: booking.booking_group?.id ?? "",
    metadata: metadataToText(booking.metadata),
    protected_metadata: metadataToText(booking.protected_metadata),
    ...IGNORE_FLAG_DEFAULTS,
    custom_buffers: false,
    buffer_starts_at: booking.buffer_starts_at,
    buffer_ends_at: booking.buffer_ends_at,
  }
}

function toPostBody(v: Values): BookingPost {
  const body: BookingPost = {
    service_id: v.service_id,
    location_id: v.location_id,
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    ...activeIgnoreFlags(v),
  }
  if (v.resource_id) body.resource_id = v.resource_id
  if (v.booking_group_id) body.booking_group_id = v.booking_group_id
  // Sending price (even null) overrides Hapio's calculation.
  if (!v.auto_price) body.price = textToPrice(v.price)
  if (v.is_temporary) body.is_temporary = true
  const metadata = textToMetadata(v.metadata)
  if (metadata) body.metadata = metadata
  const protectedMetadata = textToMetadata(v.protected_metadata)
  if (protectedMetadata) body.protected_metadata = protectedMetadata
  if (v.custom_buffers) {
    body.buffer_starts_at = v.buffer_starts_at
    body.buffer_ends_at = v.buffer_ends_at
  }
  return body
}

/** PATCH body with only what changed. Returns null when nothing did. */
function toPatchBody(values: Values, dirty: Partial<Values>): BookingPatch | null {
  const body: BookingPatch = {}
  if (dirty.service_id !== undefined) body.service_id = values.service_id
  if (dirty.location_id !== undefined) body.location_id = values.location_id
  if (dirty.resource_id !== undefined && values.resource_id) body.resource_id = values.resource_id
  if (dirty.starts_at !== undefined) body.starts_at = values.starts_at
  if (dirty.ends_at !== undefined) body.ends_at = values.ends_at
  if ((dirty.auto_price !== undefined || dirty.price !== undefined) && !values.auto_price) {
    body.price = textToPrice(values.price)
  }
  if (dirty.is_temporary !== undefined) body.is_temporary = values.is_temporary
  if (dirty.is_canceled !== undefined) body.is_canceled = values.is_canceled
  if (dirty.booking_group_id !== undefined) body.booking_group_id = values.booking_group_id || null
  if (dirty.metadata !== undefined) body.metadata = textToMetadata(values.metadata)
  if (dirty.protected_metadata !== undefined) body.protected_metadata = textToMetadata(values.protected_metadata)
  if (values.custom_buffers) {
    body.buffer_starts_at = values.buffer_starts_at
    body.buffer_ends_at = values.buffer_ends_at
  }
  if (!Object.keys(body).length) return null
  return { ...body, ...activeIgnoreFlags(values, { cancelation: values.is_canceled }) }
}

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

function serviceBuffers(service: Service) {
  const before = service.buffer_time_before
  const after = service.buffer_time_after
  if (isZeroDuration(before) && isZeroDuration(after)) return "none"
  return `${humanizeDuration(before)} before, ${humanizeDuration(after)} after`
}

// ---------------------------------------------------------------------------
// Create (full page)

/** The `/bookings/new` form. `defaults` prefill it (e.g. from a bookable slot). */
export function BookingCreateForm({ defaults }: { defaults?: BookingFormDefaults }) {
  const router = useRouter()
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues(defaults),
  })

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
          <Button type="submit" disabled={mutation.isPending || mutation.isSuccess}>
            {(mutation.isPending || mutation.isSuccess) && <Spinner />}
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
    resetOptions: { keepDirtyValues: false },
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
          form.reset(bookingToValues(booking))
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
