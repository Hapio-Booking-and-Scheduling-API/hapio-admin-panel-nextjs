"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { CopyIcon, InfoIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"
import { Controller, useForm, useFormState, useWatch, type Control } from "react-hook-form"
import { z } from "zod"

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
import { isTimeString } from "@/lib/format/datetime"
import { durationToMinutes, isValidDuration, isZeroDuration } from "@/lib/format/duration"
import { metadataToText } from "@/lib/format/json"
import { durationValue, metadataText, nullableDurationValue, pickDirty, priceText, textToMetadata, textToPrice } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors } from "@/lib/hapio/errors"
import { toastUnlessFieldErrors, useHapioMutation } from "@/lib/hapio/hooks"
import {
  SERVICE_TYPES,
  WEEKDAYS,
  type DayTime,
  type Service,
  type ServiceDay,
  type ServiceFixed,
  type ServiceFlexible,
  type ServiceInput,
  type ServicePatch,
  type ServiceType,
  type Weekday,
} from "@/lib/hapio/types"

import { OptionalDuration } from "./optional-duration"
import { SERVICE_TYPE_ICONS } from "./service-type-badge"
import { SERVICE_TYPE_INFO, isPerWeekday, serviceTypeLabel } from "./utils"

const DAY_MODES = ["same", "weekday"] as const
type DayMode = (typeof DAY_MODES)[number]

const weekdayTimes = () => z.record(z.enum(WEEKDAYS), z.string())

// Every type's fields live in one flat form so switching type keeps what was
// typed. Type-specific fields are validated only for the selected type.
const baseSchema = z.object({
  name: z.string().trim().min(1, "Required").max(100, "At most 100 characters"),
  type: z.enum(SERVICE_TYPES),
  // fixed
  duration: z.string(),
  // fixed & flexible
  bookable_interval: z.string().nullable(),
  // flexible
  min_duration: z.string(),
  max_duration: z.string().nullable(),
  default_duration: z.string().nullable(),
  duration_step: z.string(),
  // day
  day_times_mode: z.enum(DAY_MODES),
  start_time: z.string(),
  end_time: z.string(),
  start_times: weekdayTimes(),
  end_times: weekdayTimes(),
  min_days: z.string(),
  max_days: z.string(),
  default_days: z.string(),
  // common
  price: priceText(),
  buffer_time_before: durationValue(),
  buffer_time_after: durationValue(),
  booking_window_start: durationValue(),
  booking_window_end: nullableDurationValue({ allowZero: false }),
  cancelation_threshold: durationValue(),
  enabled: z.boolean(),
  metadata: metadataText(),
  protected_metadata: metadataText(),
})
type Values = z.infer<typeof baseSchema>
const FIELDS = Object.keys(baseSchema.shape)

const TYPE_FIELDS: Record<ServiceType, ReadonlyArray<keyof Values>> = {
  fixed: ["duration", "bookable_interval"],
  flexible: ["min_duration", "max_duration", "default_duration", "duration_step", "bookable_interval"],
  day: ["day_times_mode", "start_time", "end_time", "start_times", "end_times", "min_days", "max_days", "default_days"],
}

function durationIssue(value: string | null, nullable = false): string | null {
  if (value === null) return nullable ? null : "Required"
  if (!value) return "Required"
  if (!isValidDuration(value)) return "Not a valid ISO 8601 duration (e.g. PT1H30M)"
  if (isZeroDuration(value)) return "Must be longer than zero"
  return null
}

/** "" → null; whole numbers ≥ 1 → number; anything else → NaN. */
function parseDays(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return /^\d+$/.test(trimmed) && Number(trimmed) >= 1 ? Number(trimmed) : Number.NaN
}

const schema = baseSchema.superRefine((v, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: path.split("."), message })
  const checkDuration = (key: keyof Values, value: string | null, nullable = false) => {
    const message = durationIssue(value, nullable)
    if (message) issue(key, message)
    return !message
  }

  if (v.type === "fixed") {
    checkDuration("duration", v.duration)
    checkDuration("bookable_interval", v.bookable_interval, true)
  }

  if (v.type === "flexible") {
    const minOk = checkDuration("min_duration", v.min_duration)
    const maxOk = checkDuration("max_duration", v.max_duration, true)
    const defaultOk = checkDuration("default_duration", v.default_duration, true)
    checkDuration("duration_step", v.duration_step)
    checkDuration("bookable_interval", v.bookable_interval, true)
    const min = durationToMinutes(v.min_duration) ?? 0
    const max = v.max_duration === null ? Infinity : durationToMinutes(v.max_duration) ?? Infinity
    if (minOk && maxOk && max < min) issue("max_duration", "Must be at least the minimum length")
    if (minOk && maxOk && defaultOk && v.default_duration !== null) {
      const def = durationToMinutes(v.default_duration) ?? 0
      if (def < min || def > max) issue("default_duration", "Must be between the minimum and maximum length")
    }
  }

  if (v.type === "day") {
    const checkTime = (path: string, value: string) => {
      if (!isTimeString(value)) issue(path, value ? "Not a valid time" : "Required")
    }
    if (v.day_times_mode === "same") {
      checkTime("start_time", v.start_time)
      checkTime("end_time", v.end_time)
    } else {
      for (const day of WEEKDAYS) {
        checkTime(`start_times.${day}`, v.start_times[day])
        checkTime(`end_times.${day}`, v.end_times[day])
      }
    }
    const min = parseDays(v.min_days)
    const max = parseDays(v.max_days)
    const def = parseDays(v.default_days)
    if (min === null || Number.isNaN(min)) issue("min_days", min === null ? "Required" : "Enter a whole number of at least 1")
    if (Number.isNaN(max)) issue("max_days", "Enter a whole number of at least 1, or leave empty")
    if (Number.isNaN(def)) issue("default_days", "Enter a whole number of at least 1, or leave empty")
    const minN = min !== null && !Number.isNaN(min) ? min : null
    if (minN !== null && max !== null && !Number.isNaN(max) && max < minN) {
      issue("max_days", "Must be at least the minimum days")
    }
    if (minN !== null && def !== null && !Number.isNaN(def)) {
      const maxN = max !== null && !Number.isNaN(max) ? max : Infinity
      if (def < minN || def > maxN) issue("default_days", "Must be between the minimum and maximum days")
    }
  }
})

const DEFAULT_START = "09:00:00"
const DEFAULT_END = "17:00:00"

function weekdayRecord(value: DayTime | undefined, fallback: string): Record<Weekday, string> {
  return Object.fromEntries(
    WEEKDAYS.map((day) => [day, isPerWeekday(value) ? value[day] ?? fallback : value || fallback])
  ) as Record<Weekday, string>
}

/** Every type's fields, all optional, for reading a service of any type. */
type AnyServiceFields = Partial<
  Omit<ServiceFixed, "type"> & Omit<ServiceFlexible, "type"> & Omit<ServiceDay, "type">
> & { type?: ServiceType }

function toValues(service?: Service): Values {
  // Fields that don't apply to the service's type are absent; fall back to defaults.
  const s = service as AnyServiceFields | undefined
  const start = s?.start_time
  const end = s?.end_time
  const perWeekday = isPerWeekday(start) || isPerWeekday(end)
  return {
    name: s?.name ?? "",
    type: s?.type ?? "fixed",
    duration: s?.duration ?? "PT1H",
    bookable_interval: s?.bookable_interval ?? null,
    min_duration: s?.min_duration ?? "PT30M",
    max_duration: s?.type === "flexible" ? s.max_duration ?? null : "PT4H",
    default_duration: s?.default_duration ?? null,
    duration_step: s?.duration_step ?? "PT30M",
    day_times_mode: perWeekday ? "weekday" : "same",
    start_time: isPerWeekday(start) ? start.monday : start ?? DEFAULT_START,
    end_time: isPerWeekday(end) ? end.monday : end ?? DEFAULT_END,
    start_times: weekdayRecord(start, DEFAULT_START),
    end_times: weekdayRecord(end, DEFAULT_END),
    min_days: String(s?.min_days ?? 1),
    max_days: s?.max_days ? String(s.max_days) : "",
    default_days: s?.default_days ? String(s.default_days) : "",
    price: s?.price ?? "",
    buffer_time_before: s?.buffer_time_before ?? "PT0S",
    buffer_time_after: s?.buffer_time_after ?? "PT0S",
    booking_window_start: s?.booking_window_start ?? "PT0S",
    booking_window_end: s?.booking_window_end ?? null,
    cancelation_threshold: s?.cancelation_threshold ?? "PT0S",
    enabled: s?.enabled ?? true,
    metadata: metadataToText(s?.metadata),
    protected_metadata: metadataToText(s?.protected_metadata),
  }
}

const COMMON_DIRECT = [
  "name",
  "buffer_time_before",
  "buffer_time_after",
  "booking_window_start",
  "booking_window_end",
  "cancelation_threshold",
  "enabled",
] as const

/** Builds a request body from the fields `include` accepts, for the selected type only. */
function toBody(values: Values, include: (key: keyof Values) => boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const key of COMMON_DIRECT) if (include(key)) body[key] = values[key]
  if (include("price")) body.price = textToPrice(values.price)
  if (include("metadata")) body.metadata = textToMetadata(values.metadata)
  if (include("protected_metadata")) body.protected_metadata = textToMetadata(values.protected_metadata)

  switch (values.type) {
    case "fixed":
      if (include("duration")) body.duration = values.duration
      if (include("bookable_interval")) body.bookable_interval = values.bookable_interval
      break
    case "flexible":
      for (const key of TYPE_FIELDS.flexible) if (include(key)) body[key] = values[key]
      break
    case "day": {
      const perWeekday = values.day_times_mode === "weekday"
      const ordered = (times: Record<Weekday, string>) =>
        Object.fromEntries(WEEKDAYS.map((day) => [day, times[day]]))
      const modeChanged = include("day_times_mode")
      if (modeChanged || include(perWeekday ? "start_times" : "start_time")) {
        body.start_time = perWeekday ? ordered(values.start_times) : values.start_time
      }
      if (modeChanged || include(perWeekday ? "end_times" : "end_time")) {
        body.end_time = perWeekday ? ordered(values.end_times) : values.end_time
      }
      if (include("min_days")) body.min_days = parseDays(values.min_days)
      if (include("max_days")) body.max_days = parseDays(values.max_days)
      if (include("default_days")) body.default_days = parseDays(values.default_days)
      break
    }
  }
  return body
}

/** API error keys like `start_time.monday` → form field names. */
function errorFieldMap(mode: DayMode): Record<string, string> {
  const map: Record<string, string> = {}
  if (mode === "weekday") {
    map.start_time = "start_times"
    map.end_time = "end_times"
  }
  for (const day of WEEKDAYS) {
    map[`start_time.${day}`] = mode === "weekday" ? `start_times.${day}` : "start_time"
    map[`end_time.${day}`] = mode === "weekday" ? `end_times.${day}` : "end_time"
  }
  return map
}

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
    resetOptions: { keepDirtyValues: false },
  })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  const mutation = useHapioMutation(
    async (values: Values) => {
      if (service) {
        const dirty = new Set(Object.keys(pickDirty(values, dirtyFields)))
        const typeChanged = values.type !== service.type
        // Changing the type requires the new type's fields, so send them all.
        const body = toBody(
          values,
          (key) => dirty.has(key) || (typeChanged && TYPE_FIELDS[values.type].includes(key))
        )
        if (typeChanged) body.type = values.type
        return hapio.services.patch(service.id, body as ServicePatch)
      }
      const body: Record<string, unknown> = { type: values.type, ...toBody(values, () => true) }
      if (!values.protected_metadata) delete body.protected_metadata
      return hapio.services.create(body as unknown as ServiceInput)
    },
    {
      success: service ? "Service updated" : "Service created",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: (saved) => {
        onOpenChange(false)
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
      onOpenChange={(next) => {
        if (!next) {
          form.reset(toValues(service))
          setFormErrors([])
        }
        onOpenChange(next)
      }}
      title={service ? "Edit service" : "New service"}
      description="Services define what can be booked: its length, price and booking rules."
      submitLabel={service ? "Save changes" : "Create service"}
      pending={mutation.isPending}
      formErrors={formErrors}
      size="xl"
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
                  <TimeInput id={id} value={field.value} onChange={field.onChange} invalid={invalid} />
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
