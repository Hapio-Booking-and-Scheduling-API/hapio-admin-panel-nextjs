"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ExternalLinkIcon, PlusIcon, Trash2Icon, TriangleAlertIcon, Undo2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
  type UseFieldArrayReturn,
  type UseFormReturn,
} from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { BookingStatusBadge } from "@/components/entity/badges"
import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { CopyId } from "@/components/entity/copy-id"
import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { FormSection } from "@/components/form/form-section"
import { DateTimeInput } from "@/components/inputs/date-time-input"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { JsonEditor } from "@/components/inputs/json-editor"
import { PriceInput } from "@/components/inputs/price-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { FieldError, FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { FormErrorsAlert } from "@/features/bookings/form-errors"
import {
  IGNORE_FLAG_DEFAULTS,
  OverrideRulesSection,
  activeIgnoreFlags,
  type IgnoreFlagValues,
} from "@/features/bookings/override-rules"
import { ServiceResourceCombobox } from "@/features/bookings/service-resource-combobox"
import {
  bookingTimeRange,
  bookingTitle,
  endAfterStartChange,
  instant,
  rezoneWallTime,
  shortId,
  sortByStart,
} from "@/features/bookings/utils"
import { metadataToText } from "@/lib/format/json"
import { normalizePrice } from "@/lib/format/price"
import { metadataText, pickDirty, priceText, textToMetadata, textToPrice } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { isHapioError } from "@/lib/hapio/errors"
import { indexById, useAllLocations, useAllServices, useHapioMutation } from "@/lib/hapio/hooks"
import type {
  BookingEmbedded,
  BookingGroup,
  BookingGroupPatch,
  BookingGroupPost,
  BookingPatchEmbedded,
  BookingPostEmbedded,
  Uuid,
} from "@/lib/hapio/types"

// ---------------------------------------------------------------------------
// Schema

const rowSchema = z
  .object({
    /** "" for a booking that doesn't exist yet. */
    booking_id: z.string(),
    service_id: z.string(),
    location_id: z.string(),
    /** "" = let Hapio pick (new rows) / keep (existing rows). */
    resource_id: z.string(),
    starts_at: z.string().min(1, "Required"),
    ends_at: z.string().min(1, "Required"),
    /** New rows: "" = calculated by Hapio. Existing rows: "" = no price. */
    price: priceText(),
    is_temporary: z.boolean(),
    is_canceled: z.boolean(),
  })
  .superRefine((row, ctx) => {
    // Existing bookings may have lost their service/location (deleted); only new ones need them.
    if (!row.booking_id && !row.service_id) {
      ctx.addIssue({ code: "custom", path: ["service_id"], message: "Select a service" })
    }
    if (!row.booking_id && !row.location_id) {
      ctx.addIssue({ code: "custom", path: ["location_id"], message: "Select a location" })
    }
    if (row.starts_at && row.ends_at && instant(row.ends_at) <= instant(row.starts_at)) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "Must be after the start" })
    }
  })

const schema = z.object({
  metadata: metadataText(),
  protected_metadata: metadataText(),
  bookings: z.array(rowSchema).min(1, "Add at least one booking."),
  ignore_schedule: z.boolean(),
  ignore_fully_booked: z.boolean(),
  ignore_bookable_slots: z.boolean(),
  ignore_booking_window: z.boolean(),
  ignore_cancelation_threshold: z.boolean(),
})

type Values = z.infer<typeof schema>
type RowValues = Values["bookings"][number]
type Mode = "create" | "edit"

/** Row fields that have an input, i.e. where a server error can be shown in place. */
const ROW_INPUTS = ["service_id", "location_id", "resource_id", "starts_at", "ends_at", "price", "is_temporary", "is_canceled"]

function emptyRow(from?: RowValues): RowValues {
  return {
    booking_id: "",
    service_id: from?.service_id ?? "",
    location_id: from?.location_id ?? "",
    resource_id: from?.resource_id ?? "",
    starts_at: "",
    ends_at: "",
    price: "",
    is_temporary: from?.is_temporary ?? false,
    is_canceled: false,
  }
}

function bookingToRow(booking: BookingEmbedded): RowValues {
  return {
    booking_id: booking.id,
    service_id: booking.service?.id ?? "",
    location_id: booking.location?.id ?? "",
    resource_id: booking.resource?.id ?? "",
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    price: booking.price ?? "",
    is_temporary: booking.is_temporary,
    is_canceled: booking.is_canceled,
  }
}

function groupToValues(group: BookingGroup | undefined, bookings: BookingEmbedded[]): Values {
  return {
    metadata: metadataToText(group?.metadata),
    protected_metadata: metadataToText(group?.protected_metadata),
    bookings: group ? bookings.map(bookingToRow) : [emptyRow()],
    ...IGNORE_FLAG_DEFAULTS,
  }
}

// ---------------------------------------------------------------------------
// Request bodies

/** A booking to create; valid both in a POST and (without `id`) in a PATCH. */
type NewBookingItem = Omit<BookingPostEmbedded, "resource_id"> & { resource_id?: Uuid }

function rowToNew(row: RowValues, flags: Partial<IgnoreFlagValues>): NewBookingItem {
  const item: NewBookingItem = {
    service_id: row.service_id,
    location_id: row.location_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    ...flags,
  }
  if (row.resource_id) item.resource_id = row.resource_id
  if (row.price.trim()) item.price = textToPrice(row.price)
  if (row.is_temporary) item.is_temporary = true
  return item
}

/** Fields of an existing booking that differ from what the server returned. */
function rowChanges(row: RowValues, before: RowValues): BookingPatchEmbedded {
  const out: BookingPatchEmbedded = {}
  if (row.service_id && row.service_id !== before.service_id) out.service_id = row.service_id
  if (row.location_id && row.location_id !== before.location_id) out.location_id = row.location_id
  if (row.resource_id && row.resource_id !== before.resource_id) out.resource_id = row.resource_id
  if (instant(row.starts_at) !== instant(before.starts_at)) out.starts_at = row.starts_at
  if (instant(row.ends_at) !== instant(before.ends_at)) out.ends_at = row.ends_at
  if ((normalizePrice(row.price) ?? null) !== (normalizePrice(before.price) ?? null)) out.price = textToPrice(row.price)
  if (row.is_temporary !== before.is_temporary) out.is_temporary = row.is_temporary
  if (row.is_canceled !== before.is_canceled) out.is_canceled = row.is_canceled
  return out
}

interface PatchPlan {
  body: BookingGroupPatch | null
  /** Existing bookings that the PATCH will delete. */
  removed: BookingEmbedded[]
}

/**
 * PATCH semantics: when `bookings` is sent, every existing booking missing
 * from it is deleted. So either omit it (untouched) or send every row that
 * should remain: unchanged ones as `{ id }`, changed ones as `{ id, …changes }`
 * and new ones without an id.
 */
function planPatch(values: Values, original: BookingEmbedded[], dirty: Partial<Values>): PatchPlan {
  const before = new Map(original.map((b) => [b.id, bookingToRow(b)]))
  const flags = activeIgnoreFlags(values)
  let touched = false

  const items: NonNullable<BookingGroupPatch["bookings"]> = values.bookings.map((row) => {
    if (!row.booking_id) {
      touched = true
      return rowToNew(row, flags)
    }
    const previous = before.get(row.booking_id)
    const changes = previous ? rowChanges(row, previous) : {}
    if (!Object.keys(changes).length) return { id: row.booking_id }
    touched = true
    return {
      id: row.booking_id,
      ...changes,
      ...flags,
      ...(changes.is_canceled && values.ignore_cancelation_threshold ? { ignore_cancelation_threshold: true } : {}),
    }
  })

  const kept = new Set(values.bookings.map((row) => row.booking_id))
  const removed = original.filter((b) => !kept.has(b.id))
  if (removed.length) touched = true

  const body: BookingGroupPatch = {}
  if (touched) body.bookings = items
  if (dirty.metadata !== undefined) body.metadata = textToMetadata(values.metadata)
  if (dirty.protected_metadata !== undefined) body.protected_metadata = textToMetadata(values.protected_metadata)
  return { body: Object.keys(body).length ? body : null, removed }
}

// ---------------------------------------------------------------------------
// Errors

type RowErrors = Record<number, string[]>

/**
 * Group 422s come as `errors: {"bookings.0.starts_at": [...]}` and/or
 * `messages: {"bookings.0": "…"}`. Indexes refer to the array we sent, which
 * mirrors the form's rows one to one.
 */
function applyGroupErrors(error: unknown, form: UseFormReturn<Values>): { formErrors: string[]; rowErrors: RowErrors } {
  const formErrors: string[] = []
  const rowErrors: RowErrors = {}
  if (!isHapioError(error)) return { formErrors, rowErrors }
  const failedRows = new Set<number>()
  const pushRow = (index: number, message: string) => {
    failedRows.add(index)
    rowErrors[index] = [...(rowErrors[index] ?? []), message]
  }

  for (const [key, messages] of Object.entries(error.errors ?? {})) {
    const message = messages.join(" ")
    const m = /^bookings\.(\d+)(?:\.(.+))?$/.exec(key)
    if (m) {
      const index = Number(m[1])
      const field = m[2]
      if (field && ROW_INPUTS.includes(field)) {
        failedRows.add(index)
        form.setError(`bookings.${index}.${field}` as FieldPath<Values>, { type: "server", message })
      } else {
        pushRow(index, field ? `${field}: ${message}` : message)
      }
    } else if (key === "metadata" || key === "protected_metadata") {
      form.setError(key, { type: "server", message })
    } else {
      formErrors.push(key === "bookings" ? message : `${key}: ${message}`)
    }
  }
  for (const [key, message] of Object.entries(error.messages ?? {})) {
    const m = /^bookings\.(\d+)/.exec(key)
    if (m) pushRow(Number(m[1]), message)
    else formErrors.push(message)
  }
  if (failedRows.size) {
    const rows = [...failedRows].sort((a, b) => a - b).map((i) => i + 1)
    formErrors.unshift(`Hapio rejected booking ${rows.join(", ")}. See the details on ${rows.length === 1 ? "that row" : "those rows"}.`)
  }
  return { formErrors, rowErrors }
}

const toastUnlessShownInline = (error: unknown) =>
  !(
    isHapioError(error) &&
    error.status === 422 &&
    (Object.keys(error.errors ?? {}).length > 0 || Object.keys(error.messages ?? {}).length > 0)
  )

// ---------------------------------------------------------------------------
// Rows

function BookingRow({
  form,
  index,
  original,
  errors,
  onRemove,
  canRemove,
}: {
  form: UseFormReturn<Values>
  index: number
  /** The booking as the server returned it, for existing rows. */
  original: BookingEmbedded | undefined
  errors: string[] | undefined
  onRemove: () => void
  canRemove: boolean
}) {
  const headingId = useId()
  const { control } = form
  const services = useAllServices()
  const locations = useAllLocations()
  const serviceById = indexById(services.data)
  const locationById = indexById(locations.data)

  const row = useWatch({ control, name: `bookings.${index}` })
  const timeZone = locationById.get(row?.location_id ?? "")?.time_zone
  const modified = !!original && !!row && Object.keys(rowChanges(row, bookingToRow(original))).length > 0
  const name = <K extends keyof RowValues>(key: K) => `bookings.${index}.${key}` as const

  const setTime = (key: "starts_at" | "ends_at", value: string) =>
    form.setValue(name(key), value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      data-invalid={errors?.length ? true : undefined}
      className="rounded-lg border p-3 data-[invalid=true]:border-destructive/50"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span id={headingId} className="text-sm font-medium">
          Booking {index + 1}
        </span>
        {original ? (
          <>
            <CopyId id={original.id} short className="text-muted-foreground" />
            <BookingStatusBadge booking={original} />
            {modified && <Badge variant="secondary">Modified</Badge>}
          </>
        ) : (
          <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-400">
            New
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {original && (
            <Button variant="ghost" size="xs" asChild>
              <Link href={`/bookings/${original.id}`} target="_blank" rel="noreferrer">
                Open <ExternalLinkIcon />
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove booking ${index + 1}`}
            disabled={!canRemove}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <FormField
          control={control}
          name={name("service_id")}
          label="Service"
          render={({ field, id, invalid }) => (
            <EntityCombobox
              kind="service"
              id={id}
              invalid={invalid}
              value={field.value || null}
              onChange={(next) => {
                field.onChange(next ?? "")
                const end = endAfterStartChange({
                  previousStart: "",
                  nextStart: form.getValues(name("starts_at")),
                  end: form.getValues(name("ends_at")),
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
          name={name("location_id")}
          label="Location"
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
                for (const key of ["starts_at", "ends_at"] as const) {
                  const value = form.getValues(name(key))
                  if (value) setTime(key, rezoneWallTime(value, fromZone, toZone))
                }
              }}
            />
          )}
        />
        <FormField
          control={control}
          name={name("resource_id")}
          label="Resource"
          render={({ field, id, invalid }) => (
            <ServiceResourceCombobox
              compact
              id={id}
              invalid={invalid}
              serviceId={row?.service_id}
              clearable={!original}
              placeholder={original ? "No resource" : "Auto-select"}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <FormField
          control={control}
          name={name("starts_at")}
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
                  end: form.getValues(name("ends_at")),
                  service: serviceById.get(form.getValues(name("service_id"))),
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
          name={name("ends_at")}
          label="Ends"
          render={({ field, id, invalid }) => (
            <DateTimeInput id={id} invalid={invalid} timeZone={timeZone} value={field.value} onChange={field.onChange} />
          )}
        />
        <FormField
          control={control}
          name={name("price")}
          label="Price"
          render={({ field, id, invalid }) => (
            <PriceInput
              id={id}
              invalid={invalid}
              placeholder={original ? "No price" : "Calculated by Hapio"}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <FormField
          control={control}
          name={name("is_temporary")}
          label="Temporary"
          orientation="horizontal"
          className="w-auto"
          render={({ field, id }) => (
            <Switch
              id={id}
              checked={field.value}
              // A finalized booking can't become temporary again.
              disabled={!!original && !original.is_temporary}
              onCheckedChange={field.onChange}
            />
          )}
        />
        {original && (
          <FormField
            control={control}
            name={name("is_canceled")}
            label="Canceled"
            orientation="horizontal"
            className="w-auto"
            render={({ field, id }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />}
          />
        )}
      </div>
      {errors && errors.length > 0 && (
        <Alert variant="destructive" className="mt-3">
          <TriangleAlertIcon />
          <AlertTitle>Hapio rejected this booking</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function RemovedBookingsAlert({
  removed,
  onKeep,
}: {
  removed: BookingEmbedded[]
  onKeep: (booking: BookingEmbedded) => void
}) {
  if (!removed.length) return null
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>
        {removed.length === 1 ? "1 booking will be deleted" : `${removed.length} bookings will be deleted`} when you
        save
      </AlertTitle>
      <AlertDescription>
        <p>Bookings removed from this list are deleted permanently, not just taken out of the group.</p>
        <ul className="mt-1 space-y-1">
          {removed.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2">
              <span>
                {bookingTitle(b)}, {bookingTimeRange(b)}{" "}
                <span className="font-mono text-xs">({shortId(b.id)})</span>
              </span>
              <Button type="button" variant="outline" size="xs" onClick={() => onKeep(b)}>
                <Undo2Icon /> Keep
              </Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

function BookingGroupFields({
  form,
  rows,
  mode,
  original,
  rowErrors,
  onRowsChanged,
}: {
  form: UseFormReturn<Values>
  rows: UseFieldArrayReturn<Values, "bookings">
  mode: Mode
  original: BookingEmbedded[]
  rowErrors: RowErrors
  /** Row indexes shift on add/remove, so index-based server errors go stale. */
  onRowsChanged: () => void
}) {
  const { control } = form
  const values = useWatch({ control, name: "bookings" })
  const originalById = new Map(original.map((b) => [b.id, b]))
  const kept = new Set((values ?? []).map((row) => row.booking_id))
  const removed = original.filter((b) => !kept.has(b.id))
  const arrayError = form.formState.errors.bookings
  const arrayMessage = arrayError?.root?.message ?? arrayError?.message

  return (
    <>
      <FormSection
        title="Bookings"
        description={
          mode === "create"
            ? "Times are entered in each location's time zone. Leave the price empty to let Hapio calculate it."
            : "Unchanged bookings are left alone. Changing times or the service recalculates price and buffers unless you set a price."
        }
      >
        <div className="flex flex-col gap-3">
          {rows.fields.map((field, index) => {
            const bookingId = values?.[index]?.booking_id
            return (
              <BookingRow
                key={field.id}
                form={form}
                index={index}
                original={bookingId ? originalById.get(bookingId) : undefined}
                errors={rowErrors[index]}
                canRemove={rows.fields.length > 1}
                onRemove={() => {
                  rows.remove(index)
                  onRowsChanged()
                }}
              />
            )
          })}
          {arrayMessage && <FieldError>{arrayMessage}</FieldError>}
          {mode === "edit" && (
            <RemovedBookingsAlert
              removed={removed}
              onKeep={(b) => {
                rows.append(bookingToRow(b))
                onRowsChanged()
              }}
            />
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const last = values?.[values.length - 1]
                rows.append(emptyRow(last))
                onRowsChanged()
              }}
            >
              <PlusIcon /> Add booking
            </Button>
          </div>
        </div>
      </FormSection>
      <FormSection title="Group metadata" description="Free-form JSON objects stored on the group itself.">
        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            control={control}
            name="metadata"
            label="Metadata"
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
      <OverrideRulesSection
        control={control}
        includeCancelation={mode === "edit"}
        description="Applied to every new or changed booking. Each needs the matching token ability."
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Create (full page)

export function BookingGroupCreateForm() {
  const router = useRouter()
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [rowErrors, setRowErrors] = useState<RowErrors>({})
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: groupToValues(undefined, []),
  })
  const rows = useFieldArray({ control: form.control, name: "bookings" })

  const mutation = useHapioMutation((body: BookingGroupPost) => hapio.bookingGroups.create(body), {
    success: "Booking group created",
    toastErrors: toastUnlessShownInline,
    onSuccess: (saved) => router.push(`/booking-groups/${saved.id}`),
    onError: (error) => {
      const result = applyGroupErrors(error, form)
      setFormErrors(result.formErrors)
      setRowErrors(result.rowErrors)
    },
  })

  return (
    <form
      noValidate
      className="w-full max-w-5xl"
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        setRowErrors({})
        const flags = activeIgnoreFlags(values)
        const body: BookingGroupPost = { bookings: values.bookings.map((row) => rowToNew(row, flags)) }
        const metadata = textToMetadata(values.metadata)
        if (metadata) body.metadata = metadata
        const protectedMetadata = textToMetadata(values.protected_metadata)
        if (protectedMetadata) body.protected_metadata = protectedMetadata
        mutation.mutate(body)
      })}
    >
      <Card>
        <CardContent>
          <FieldGroup>
            <BookingGroupFields
              form={form}
              rows={rows}
              mode="create"
              original={[]}
              rowErrors={rowErrors}
              onRowsChanged={() => setRowErrors({})}
            />
            <FormErrorsAlert errors={formErrors} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/booking-groups">Cancel</Link>
          </Button>
          <Button type="submit" disabled={mutation.isPending || mutation.isSuccess}>
            {(mutation.isPending || mutation.isSuccess) && <Spinner />}
            Create booking group
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Edit (dialog)

/** Mount only while open: the form snapshots the group when it opens. */
export function BookingGroupEditDialog({
  group,
  onOpenChange,
}: {
  group: BookingGroup
  onOpenChange: (open: boolean) => void
}) {
  // The diff (what changed, what gets deleted) is against this snapshot.
  const [original] = useState(() => sortByStart(group.bookings))
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [rowErrors, setRowErrors] = useState<RowErrors>({})
  const [pending, setPending] = useState<PatchPlan | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: groupToValues(group, original),
  })
  const rows = useFieldArray({ control: form.control, name: "bookings" })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  const mutation = useHapioMutation((body: BookingGroupPatch) => hapio.bookingGroups.patch(group.id, body), {
    success: "Booking group updated",
    toastErrors: toastUnlessShownInline,
    onSuccess: () => onOpenChange(false),
    onError: (error) => {
      const result = applyGroupErrors(error, form)
      setFormErrors(result.formErrors)
      setRowErrors(result.rowErrors)
    },
  })

  const removedCount = pending?.removed.length ?? 0

  return (
    <>
      <FormDialog
        open
        onOpenChange={(next) => !next && onOpenChange(false)}
        title={`Edit booking group ${shortId(group.id)}`}
        description="Edit, add or remove bookings, and change the group's metadata."
        submitLabel="Save changes"
        pending={mutation.isPending}
        formErrors={formErrors}
        size="xl"
        onSubmit={form.handleSubmit((values) => {
          setFormErrors([])
          setRowErrors({})
          const plan = planPatch(values, original, pickDirty(values, dirtyFields))
          if (!plan.body) {
            toast.info("No changes to save")
            onOpenChange(false)
            return
          }
          if (plan.removed.length) setPending(plan)
          else mutation.mutate(plan.body)
        })}
      >
        <BookingGroupFields
          form={form}
          rows={rows}
          mode="edit"
          original={original}
          rowErrors={rowErrors}
          onRowsChanged={() => setRowErrors({})}
        />
      </FormDialog>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        title={removedCount === 1 ? "Delete 1 booking?" : `Delete ${removedCount} bookings?`}
        description={
          pending ? (
            <>
              <p>Saving permanently deletes these bookings. This can&apos;t be undone.</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                {pending.removed.map((b) => (
                  <li key={b.id}>
                    {bookingTitle(b)}, {bookingTimeRange(b)}{" "}
                    <span className="font-mono text-xs">({shortId(b.id)})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                To keep a booking but take it out of the group, open it and choose “Remove” under Booking group instead.
              </p>
            </>
          ) : undefined
        }
        confirmLabel="Delete and save"
        destructive
        onConfirm={() => {
          const body = pending?.body
          setPending(null)
          if (body) mutation.mutate(body)
        }}
      />
    </>
  )
}
