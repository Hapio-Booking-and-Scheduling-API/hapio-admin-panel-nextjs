"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ExternalLinkIcon, PlusIcon, Trash2Icon, TriangleAlertIcon, Undo2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react"
import {
  useFieldArray,
  useForm,
  useWatch,
  type UseFieldArrayReturn,
  type UseFormReturn,
} from "react-hook-form"
import { toast } from "sonner"

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
import { OverrideRulesSection, activeIgnoreFlags } from "@/features/bookings/override-rules"
import { ServiceResourceCombobox } from "@/features/bookings/service-resource-combobox"
import {
  bookingTimeRange,
  bookingTitle,
  endAfterStartChange,
  rezoneWallTime,
  shortId,
  sortByStart,
} from "@/features/bookings/utils"
import { pickDirty, textToMetadata } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { indexById, useAllLocations, useAllServices, useHapioMutation } from "@/lib/hapio/hooks"
import type { BookingEmbedded, BookingGroup, BookingGroupPatch, BookingGroupPost } from "@/lib/hapio/types"

import {
  bookingToRow,
  editEmptyGroupSchema,
  emptyRow,
  groupToValues,
  mapGroupErrors,
  planPatch,
  rowChanges,
  rowToNew,
  schema,
  toastUnlessShownInline,
  type Mode,
  type GroupErrors,
  type PatchPlan,
  type RowErrors,
  type RowValues,
  type Values,
} from "./booking-group-form-model"

// ---------------------------------------------------------------------------
// Errors

type ServerErrors = Omit<GroupErrors, "fieldErrors">

const NO_SERVER_ERRORS: ServerErrors = { formErrors: [], rowSummary: null, rowErrors: {} }

/** Puts a group 422 on the form: field errors via setError, the rest is returned for the alerts. */
function applyGroupErrors(error: unknown, form: UseFormReturn<Values>): ServerErrors {
  const { fieldErrors, ...rest } = mapGroupErrors(error)
  for (const [path, message] of fieldErrors) form.setError(path, { type: "server", message })
  return rest
}

/** Row indexes shift on add/remove, so the index-based row alerts and summary go stale. */
const withoutRowErrors = (errors: ServerErrors): ServerErrors => ({ ...errors, rowSummary: null, rowErrors: {} })

/** Messages for the form-level alert: the "rejected booking N" summary first. */
const formAlertMessages = ({ rowSummary, formErrors }: ServerErrors) =>
  rowSummary ? [rowSummary, ...formErrors] : formErrors

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
  /** Called after a row is added or removed. */
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
                // A group needs a booking, but an empty one may stay empty (the list isn't sent).
                canRemove={rows.fields.length > 1 || (mode === "edit" && !original.length)}
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
  // Next keeps this page mounted (hidden) after navigating to the new group. If it's shown
  // again (Back), start a fresh form rather than the sent one with its submit stuck disabled.
  // A draft that wasn't sent is kept.
  const [generation, setGeneration] = useState(0)
  const restart = useCallback(() => setGeneration((g) => g + 1), [])
  return <CreateForm key={generation} onHiddenAfterCreate={restart} />
}

function CreateForm({ onHiddenAfterCreate }: { onHiddenAfterCreate: () => void }) {
  const router = useRouter()
  const [serverErrors, setServerErrors] = useState<ServerErrors>(NO_SERVER_ERRORS)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: groupToValues(undefined, []),
  })
  const rows = useFieldArray({ control: form.control, name: "bookings" })
  const created = useRef(false)

  const mutation = useHapioMutation((body: BookingGroupPost) => hapio.bookingGroups.create(body), {
    success: "Booking group created",
    toastErrors: toastUnlessShownInline,
    onSuccess: (saved) => {
      created.current = true
      router.push(`/booking-groups/${saved.id}`)
    },
    onError: (error) => setServerErrors(applyGroupErrors(error, form)),
  })
  // The cleanup runs when Next hides the page after the navigation (or it unmounts).
  useLayoutEffect(
    () => () => {
      if (created.current) onHiddenAfterCreate()
    },
    [onHiddenAfterCreate]
  )

  return (
    <form
      noValidate
      className="w-full max-w-5xl"
      onSubmit={form.handleSubmit((values) => {
        setServerErrors(NO_SERVER_ERRORS)
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
              rowErrors={serverErrors.rowErrors}
              onRowsChanged={() => setServerErrors(withoutRowErrors)}
            />
            <FormErrorsAlert errors={formAlertMessages(serverErrors)} />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/booking-groups">Cancel</Link>
          </Button>
          <Button type="submit" disabled={mutation.isPending || mutation.isSuccess} aria-busy={mutation.isPending}>
            {(mutation.isPending || mutation.isSuccess) && <Spinner aria-hidden />}
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
  const [serverErrors, setServerErrors] = useState<ServerErrors>(NO_SERVER_ERRORS)
  const [pending, setPending] = useState<PatchPlan | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(original.length ? schema : editEmptyGroupSchema),
    defaultValues: groupToValues(group, original),
  })
  const rows = useFieldArray({ control: form.control, name: "bookings" })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  const mutation = useHapioMutation((body: BookingGroupPatch) => hapio.bookingGroups.patch(group.id, body), {
    success: "Booking group updated",
    toastErrors: toastUnlessShownInline,
    onSuccess: () => onOpenChange(false),
    onError: (error) => setServerErrors(applyGroupErrors(error, form)),
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
        formErrors={formAlertMessages(serverErrors)}
        size="xl"
        onSubmit={form.handleSubmit((values) => {
          setServerErrors(NO_SERVER_ERRORS)
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
          rowErrors={serverErrors.rowErrors}
          onRowsChanged={() => setServerErrors(withoutRowErrors)}
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
