"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { CopyIcon, InfoIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"
import { Controller, useForm, useFormState, useWatch, type Control } from "react-hook-form"
import { toast } from "sonner"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { FormSection } from "@/components/form/form-section"
import { DurationInput } from "@/components/inputs/duration-input"
import { JsonEditor } from "@/components/inputs/json-editor"
import { PriceInput } from "@/components/inputs/price-input"
import { TimeInput } from "@/components/inputs/time-input"
import { WEEKDAY_LABELS } from "@/components/inputs/weekday-select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { pickDirty } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { toastUnlessFieldErrors, useHapioMutation } from "@/lib/hapio/hooks"
import { SERVICE_TYPES, WEEKDAYS, type Service, type ServiceInput, type ServicePatch, type Weekday } from "@/lib/hapio/types"

import { OptionalDuration } from "./optional-duration"
import {
  DEFAULT_END,
  DEFAULT_START,
  FIELDS,
  createBody,
  errorFieldMap,
  patchBody,
  schema,
  toValues,
  weekdayRecord,
  type DayMode,
  type Values,
} from "./service-form-model"
import { SERVICE_TYPE_ICONS } from "./service-type-badge"
import { SERVICE_TYPE_INFO, serviceTypeLabel } from "./utils"

export function ServiceFormDialog({
  open,
  onOpenChange,
  service,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this service; omit to create a new one. */
  service?: Service
}) {
  const router = useRouter()
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: toValues(service),
    // A refetch of the service updates the untouched fields but keeps what the user typed.
    resetOptions: { keepDirtyValues: true },
  })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  /** PATCH body for an edit: the changed fields only. */
  const editBody = (values: Values, original: Service) =>
    patchBody(values, original, new Set(Object.keys(pickDirty(values, dirtyFields))))

  /** Closes the dialog with a clean form that shows `next` when it opens again. */
  const close = (next: Service | undefined) => {
    form.reset(toValues(next), { keepDirtyValues: false })
    setFormErrors([])
    onOpenChange(false)
  }

  const mutation = useHapioMutation(
    async (values: Values) => {
      if (service) return hapio.services.patch(service.id, editBody(values, service) as ServicePatch)
      return hapio.services.create(createBody(values) as unknown as ServiceInput)
    },
    {
      success: service ? "Service updated" : "Service created",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: (saved) => {
        // The create dialog stays mounted in the kept-alive list, so start it over.
        close(service ? saved : undefined)
        if (!service) router.push(`/services/${saved.id}`)
      },
      onError: (error, values) =>
        setFormErrors(applyValidationErrors(error, form.setError, FIELDS, errorFieldMap(values.day_times_mode))),
    }
  )

  const [type, dayMode, duration, minDuration] = useWatch({
    control: form.control,
    name: ["type", "day_times_mode", "duration", "min_duration"],
  })
  const typeInfo = SERVICE_TYPE_INFO[type]

  const setDayMode = (mode: DayMode) => {
    const v = form.getValues()
    if (mode === "weekday") {
      // Start every weekday from the single time unless they were already customised.
      const uniform = (times: Record<Weekday, string>) => WEEKDAYS.every((d) => times[d] === times.monday)
      if (uniform(v.start_times)) form.setValue("start_times", weekdayRecord(v.start_time, DEFAULT_START), { shouldDirty: true })
      if (uniform(v.end_times)) form.setValue("end_times", weekdayRecord(v.end_time, DEFAULT_END), { shouldDirty: true })
    } else {
      if (!v.start_time) form.setValue("start_time", v.start_times.monday, { shouldDirty: true })
      if (!v.end_time) form.setValue("end_time", v.end_times.monday, { shouldDirty: true })
    }
    form.setValue("day_times_mode", mode, { shouldDirty: true })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close(service))}
      title={service ? "Edit service" : "New service"}
      description="Services define what can be booked: its length, price and booking rules."
      submitLabel={service ? "Save changes" : "Create service"}
      pending={mutation.isPending}
      formErrors={formErrors}
      size="xl"
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        if (service && Object.keys(editBody(values, service)).length === 0) {
          toast.info("No changes to save")
          close(service)
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
        name="type"
        label="Type"
        render={({ field }) => (
          <RadioGroup
            value={field.value}
            onValueChange={field.onChange}
            aria-label="Service type"
            className="gap-2 sm:grid-cols-3"
          >
            {SERVICE_TYPES.map((t) => {
              const Icon = SERVICE_TYPE_ICONS[t]
              return (
                <Label
                  key={t}
                  className="flex items-start gap-3 rounded-lg border p-3 font-normal has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5"
                >
                  <RadioGroupItem value={t} className="mt-0.5" />
                  <span className="space-y-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Icon className="size-4 text-muted-foreground" />
                      {SERVICE_TYPE_INFO[t].label}
                    </span>
                    <span className="block leading-snug text-muted-foreground">{SERVICE_TYPE_INFO[t].description}</span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        )}
      />
      {service && type !== service.type && (
        <Alert>
          <InfoIcon />
          <AlertDescription>
            Changing the type from {serviceTypeLabel(service.type)} to {typeInfo.label} sends every{" "}
            {typeInfo.label.toLowerCase()} setting below along with the new type. Settings that only apply to{" "}
            {serviceTypeLabel(service.type).toLowerCase()} services are dropped.
          </AlertDescription>
        </Alert>
      )}

      {type === "fixed" && (
        <FormSection title="Booking length" description="Every booking of this service has the same length.">
          <FormField
            control={form.control}
            name="duration"
            label="Duration"
            description="Length of each booking."
            render={({ field, id, invalid }) => (
              <DurationInput id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
            )}
          />
          <FormField
            control={form.control}
            name="bookable_interval"
            label="Bookable interval"
            description="How often slots start. By default, the next slot starts when the previous one and its buffers end."
            render={({ field, id, invalid }) => (
              <OptionalDuration
                id={id}
                value={field.value}
                onChange={field.onChange}
                nullLabel="Default (duration + buffers)"
                fallback={duration || "PT30M"}
                invalid={invalid}
              />
            )}
          />
        </FormSection>
      )}

      {type === "flexible" && (
        <FormSection
          title="Booking length"
          description="Customers pick a length between the minimum and maximum, in steps."
        >
          <div className="grid gap-5 md:grid-cols-2">
            <FormField
              control={form.control}
              name="min_duration"
              label="Minimum length"
              render={({ field, id, invalid }) => (
                <DurationInput id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="max_duration"
              label="Maximum length"
              render={({ field, id, invalid }) => (
                <OptionalDuration
                  id={id}
                  value={field.value}
                  onChange={field.onChange}
                  nullLabel="No maximum"
                  fallback="PT4H"
                  invalid={invalid}
                />
              )}
            />
            <FormField
              control={form.control}
              name="duration_step"
              label="Step"
              description="Lengths grow from the minimum in increments of this."
              render={({ field, id, invalid }) => (
                <DurationInput id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="default_duration"
              label="Default length"
              description="Pre-filled in booking forms. Must be between the minimum and maximum."
              render={({ field, id, invalid }) => (
                <OptionalDuration
                  id={id}
                  value={field.value}
                  onChange={field.onChange}
                  nullLabel="No default"
                  fallback={minDuration || "PT1H"}
                  invalid={invalid}
                />
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="bookable_interval"
            label="Bookable interval"
            description="How often slots start."
            render={({ field, id, invalid }) => (
              <OptionalDuration
                id={id}
                value={field.value}
                onChange={field.onChange}
                nullLabel="Same as step"
                fallback="PT30M"
                invalid={invalid}
              />
            )}
          />
        </FormSection>
      )}

      {type === "day" && (
        <FormSection title="Days & times" description="Bookings start on their first day and end on their last day at these times.">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={dayMode}
            onValueChange={(v) => v && setDayMode(v as DayMode)}
            aria-label="Start and end times"
          >
            <ToggleGroupItem value="same" className="text-muted-foreground data-[state=on]:text-foreground">
              Same times every day
            </ToggleGroupItem>
            <ToggleGroupItem value="weekday" className="text-muted-foreground data-[state=on]:text-foreground">
              Per weekday
            </ToggleGroupItem>
          </ToggleGroup>
          {dayMode === "same" ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="start_time"
                label="Start time"
                description="When bookings start on their first day."
                render={({ field, id, invalid }) => (
                  <TimeInput id={id} value={field.value} onChange={field.onChange} invalid={invalid} />
                )}
              />
              <FormField
                control={form.control}
                name="end_time"
                label="End time"
                description="When bookings end on their last day."
                render={({ field, id, invalid }) => (
                  <TimeInput id={id} value={field.value} onChange={field.onChange} invalid={invalid} allowEndOfDay />
                )}
              />
            </div>
          ) : (
            <WeekdayTimesGrid control={form.control} onCopyMonday={() => {
              const v = form.getValues()
              form.setValue("start_times", weekdayRecord(v.start_times.monday, DEFAULT_START), { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
              form.setValue("end_times", weekdayRecord(v.end_times.monday, DEFAULT_END), { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
            }} />
          )}
          <div className="grid gap-5 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="min_days"
              label="Minimum days"
              render={({ field, id, invalid }) => (
                <Input id={id} type="number" min={1} step={1} inputMode="numeric" {...field} aria-invalid={invalid} />
              )}
            />
            <FormField
              control={form.control}
              name="max_days"
              label="Maximum days"
              render={({ field, id, invalid }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="No limit"
                  {...field}
                  aria-invalid={invalid}
                />
              )}
            />
            <FormField
              control={form.control}
              name="default_days"
              label="Default days"
              render={({ field, id, invalid }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="None"
                  {...field}
                  aria-invalid={invalid}
                />
              )}
            />
          </div>
          <p className="-mt-2 text-sm text-muted-foreground">
            Leave maximum empty for no limit. The default pre-fills booking forms. With a minimum of 1 day, a booking
            can start and end on the same date only if the end time is after the start time.
          </p>
        </FormSection>
      )}

      <FormSection title="Pricing">
        <FormField
          control={form.control}
          name="price"
          label={typeInfo.priceLabel}
          description={
            type === "fixed"
              ? "The price of one booking. Leave empty for no price."
              : type === "flexible"
                ? "Price per hour booked. Leave empty for no price."
                : "Price per day booked. Leave empty for no price."
          }
          render={({ field, id, invalid }) => (
            <div className="max-w-xs">
              <PriceInput
                id={id}
                value={field.value}
                onChange={field.onChange}
                invalid={invalid}
                suffix={type === "flexible" ? "per hour" : type === "day" ? "per day" : undefined}
              />
            </div>
          )}
        />
      </FormSection>

      <FormSection
        title="Buffers & booking window"
        description="Time blocked around each booking, and when bookings can be made or canceled."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            control={form.control}
            name="buffer_time_before"
            label="Buffer before"
            description="Blocked before each booking, e.g. for preparation."
            render={({ field, id, invalid }) => (
              <DurationInput id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
            )}
          />
          <FormField
            control={form.control}
            name="buffer_time_after"
            label="Buffer after"
            description="Blocked after each booking, e.g. for cleanup."
            render={({ field, id, invalid }) => (
              <DurationInput id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
            )}
          />
          <FormField
            control={form.control}
            name="booking_window_start"
            label="Minimum notice"
            description="How long before its start a booking must be made. Zero allows booking right up to the start."
            render={({ field, id, invalid }) => (
              <DurationInput id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
            )}
          />
          <FormField
            control={form.control}
            name="booking_window_end"
            label="Booking horizon"
            description="How far ahead bookings can be made. Whole days count from the start of today, so 1 day means until the end of today."
            render={({ field, id, invalid }) => (
              <OptionalDuration
                id={id}
                value={field.value}
                onChange={field.onChange}
                nullLabel="No limit"
                fallback="P30D"
                invalid={invalid}
              />
            )}
          />
          <FormField
            control={form.control}
            name="cancelation_threshold"
            label="Cancelation threshold"
            description="Latest time before the start that a booking can be canceled. Zero allows canceling right up to the start."
            render={({ field, id, invalid }) => (
              <DurationInput id={id} value={field.value} onChange={(v) => field.onChange(v ?? "")} invalid={invalid} />
            )}
          />
        </div>
      </FormSection>

      <FormSection title="Status">
        <FormField
          control={form.control}
          name="enabled"
          label="Enabled"
          description="Disabled services can't be booked."
          orientation="horizontal"
          render={({ field, id }) => <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />}
        />
      </FormSection>

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
          description="Requires the service:protected_metadata ability."
          render={({ field, id, invalid }) => <JsonEditor id={id} value={field.value} onChange={field.onChange} invalid={invalid} />}
        />
      </FormSection>
    </FormDialog>
  )
}

function WeekdayTimesGrid({ control, onCopyMonday }: { control: Control<Values>; onCopyMonday: () => void }) {
  const baseId = useId()
  return (
    <div className="space-y-2">
      <div className="divide-y rounded-lg border">
        <div className="hidden grid-cols-[7rem_1fr_1fr] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase sm:grid">
          <span>Day</span>
          <span>Start</span>
          <span>End</span>
        </div>
        {WEEKDAYS.map((day) => (
          <Controller
            key={day}
            control={control}
            name={`start_times.${day}`}
            render={({ field: start, fieldState: startState }) => (
              <Controller
                control={control}
                name={`end_times.${day}`}
                render={({ field: end, fieldState: endState }) => (
                  <div className="grid grid-cols-2 items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[7rem_1fr_1fr]">
                    <span className="col-span-2 text-sm font-medium sm:col-span-1">{WEEKDAY_LABELS[day]}</span>
                    <div className="min-w-0 [&_input]:w-full">
                      <label htmlFor={`${baseId}-${day}-start`} className="sr-only">
                        {WEEKDAY_LABELS[day]} start time
                      </label>
                      <TimeInput
                        id={`${baseId}-${day}-start`}
                        value={start.value}
                        onChange={start.onChange}
                        invalid={startState.invalid}
                      />
                    </div>
                    <div className="min-w-0 [&_input]:w-full">
                      <label htmlFor={`${baseId}-${day}-end`} className="sr-only">
                        {WEEKDAY_LABELS[day]} end time
                      </label>
                      <TimeInput
                        id={`${baseId}-${day}-end`}
                        value={end.value}
                        onChange={end.onChange}
                        invalid={endState.invalid}
                        allowEndOfDay
                      />
                    </div>
                    {(startState.error || endState.error) && (
                      <FieldError
                        className="col-span-2 sm:col-start-2"
                        errors={[
                          startState.error && { message: `Start: ${startState.error.message}` },
                          endState.error && { message: `End: ${endState.error.message}` },
                        ].filter((e): e is { message: string } => !!e)}
                      />
                    )}
                  </div>
                )}
              />
            )}
          />
        ))}
      </div>
      <RootTimesError control={control} />
      <Button type="button" variant="ghost" size="sm" onClick={onCopyMonday}>
        <CopyIcon /> Copy Monday to all days
      </Button>
    </div>
  )
}

/** Errors the API reports for `start_time` / `end_time` as a whole in per-weekday mode. */
function RootTimesError({ control }: { control: Control<Values> }) {
  const { errors } = useFormState({ control, name: ["start_times", "end_times"] })
  const start = errors.start_times?.message
  const end = errors.end_times?.message
  return (
    <FieldError
      errors={[
        start ? { message: `Start times: ${start}` } : undefined,
        end ? { message: `End times: ${end}` } : undefined,
      ].filter(Boolean)}
    />
  )
}
