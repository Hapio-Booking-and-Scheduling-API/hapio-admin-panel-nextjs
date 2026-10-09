"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FormDialog } from "@/components/form/form-dialog"
import { FormField } from "@/components/form/form-field"
import { TimeInput } from "@/components/inputs/time-input"
import { WEEKDAY_LABELS, WeekdaySelect } from "@/components/inputs/weekday-select"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { isTimeString } from "@/lib/format/datetime"
import { pickDirty } from "@/lib/forms"
import { hapio } from "@/lib/hapio/client"
import { applyValidationErrors, describeError, isHapioError } from "@/lib/hapio/errors"
import { toastUnlessFieldErrors, useHapioMutation } from "@/lib/hapio/hooks"
import { WEEKDAYS, type RecurringScheduleBlock, type Weekday } from "@/lib/hapio/types"

const startTime = () => z.string().refine((v) => isTimeString(v), "Enter a time")
const endTime = () => z.string().refine((v) => isTimeString(v, true), "Enter a time")
const endAfterStart = {
  path: ["end_time"],
  message: "Must be after the start time",
}
const isOrdered = (v: { start_time: string; end_time: string }) =>
  !isTimeString(v.start_time) || !isTimeString(v.end_time, true) || v.end_time > v.start_time

const OVERLAP_HINT = "Blocks in the same recurring schedule can't overlap."

// ---------------------------------------------------------------------------
// Single block

const blockSchema = z
  .object({ weekday: z.enum(WEEKDAYS), start_time: startTime(), end_time: endTime() })
  .refine(isOrdered, endAfterStart)
type BlockValues = z.infer<typeof blockSchema>
const BLOCK_FIELDS = ["weekday", "start_time", "end_time"]

/** Create or edit one weekday block. Mount it only while open. */
export function RecurringBlockFormDialog({
  resourceId,
  scheduleId,
  block,
  defaultWeekday = "monday",
  onClose,
}: {
  resourceId: string
  scheduleId: string
  /** Edit this block; omit to create one. */
  block?: RecurringScheduleBlock
  defaultWeekday?: Weekday
  onClose: () => void
}) {
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm<BlockValues>({
    resolver: zodResolver(blockSchema),
    defaultValues: block
      ? { weekday: block.weekday, start_time: block.start_time, end_time: block.end_time }
      : { weekday: defaultWeekday, start_time: "09:00:00", end_time: "17:00:00" },
  })

  // Read during render so react-hook-form tracks dirty state.
  const { dirtyFields } = form.formState

  const blocks = hapio.recurringScheduleBlocks(resourceId, scheduleId)
  const mutation = useHapioMutation(
    async (values: BlockValues) => {
      if (block) return blocks.patch(block.id, pickDirty(values, dirtyFields))
      return blocks.create(values)
    },
    {
      success: block ? "Block updated" : "Block added",
      toastErrors: toastUnlessFieldErrors,
      onSuccess: () => onClose(),
      onError: (error) => setFormErrors(applyValidationErrors(error, form.setError, BLOCK_FIELDS)),
    }
  )

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={block ? "Edit block" : "Add block"}
      description={`Opening hours on one weekday, in the location's time zone. ${OVERLAP_HINT}`}
      submitLabel={block ? "Save changes" : "Add block"}
      pending={mutation.isPending}
      formErrors={formErrors}
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        mutation.mutate(values)
      })}
    >
      <FormField
        control={form.control}
        name="weekday"
        label="Weekday"
        render={({ field, id, invalid }) => (
          <WeekdaySelect id={id} value={field.value} onChange={(v) => v && field.onChange(v)} invalid={invalid} />
        )}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="start_time"
          label="Start time"
          render={({ field, id, invalid }) => (
            <TimeInput id={id} value={field.value} onChange={field.onChange} invalid={invalid} />
          )}
        />
        <FormField
          control={form.control}
          name="end_time"
          label="End time"
          render={({ field, id, invalid }) => (
            <TimeInput id={id} value={field.value} onChange={field.onChange} invalid={invalid} allowEndOfDay />
          )}
        />
      </div>
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Same hours on several weekdays

const hoursSchema = z
  .object({
    weekdays: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day"),
    start_time: startTime(),
    end_time: endTime(),
  })
  .refine(isOrdered, endAfterStart)
type HoursValues = z.infer<typeof hoursSchema>

const PRESETS: Array<{ label: string; days: Weekday[] }> = [
  { label: "Mon–Fri", days: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
  { label: "Weekend", days: ["saturday", "sunday"] },
  { label: "Every day", days: [...WEEKDAYS] },
]

class BulkCreateError extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join("\n"))
  }
}

function failureMessage(error: unknown): string {
  if (isHapioError(error) && error.errors && Object.keys(error.errors).length) {
    return Object.values(error.errors).flat().join(" ")
  }
  return describeError(error)
}

/** Adds the same start/end time on several weekdays (one request per day). Mount it only while open. */
export function WeekdayHoursDialog({
  resourceId,
  scheduleId,
  onClose,
}: {
  resourceId: string
  scheduleId: string
  onClose: () => void
}) {
  const [formErrors, setFormErrors] = useState<string[]>([])
  const form = useForm<HoursValues>({
    resolver: zodResolver(hoursSchema),
    defaultValues: { weekdays: PRESETS[0].days, start_time: "09:00:00", end_time: "17:00:00" },
  })

  const mutation = useHapioMutation(
    async ({ weekdays, start_time, end_time }: HoursValues) => {
      const api = hapio.recurringScheduleBlocks(resourceId, scheduleId)
      const ordered = WEEKDAYS.filter((day) => weekdays.includes(day))
      const failed: Array<{ weekday: Weekday; message: string }> = []
      let created = 0
      // Sequential, to stay friendly with Hapio's rate limit.
      for (const weekday of ordered) {
        try {
          await api.create({ weekday, start_time, end_time })
          created++
        } catch (error) {
          failed.push({ weekday, message: failureMessage(error) })
        }
      }
      const lines = failed.map((f) => `${WEEKDAY_LABELS[f.weekday]}: ${f.message}`)
      if (created === 0) throw new BulkCreateError(lines)
      return { created, failed, lines }
    },
    {
      success: ({ created, failed }) =>
        failed.length
          ? `Added ${created} of ${created + failed.length} blocks`
          : created === 1
            ? "Block added"
            : `Added ${created} blocks`,
      toastErrors: false,
      onSuccess: ({ failed, lines }) => {
        if (!failed.length) return onClose()
        form.setValue("weekdays", failed.map((f) => f.weekday))
        setFormErrors(lines)
      },
      onError: (error) => setFormErrors(error instanceof BulkCreateError ? error.lines : [describeError(error)]),
    }
  )

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Add weekday hours"
      description={`Creates one block per selected day with the same hours. ${OVERLAP_HINT}`}
      submitLabel="Add hours"
      pending={mutation.isPending}
      formErrors={formErrors}
      onSubmit={form.handleSubmit((values) => {
        setFormErrors([])
        mutation.mutate(values)
      })}
    >
      <FormField
        control={form.control}
        name="weekdays"
        label="Days"
        render={({ field, id, invalid }) => (
          <div className="space-y-2">
            <ToggleGroup
              id={id}
              type="multiple"
              variant="outline"
              size="sm"
              spacing={0}
              value={field.value}
              onValueChange={(days) => field.onChange(WEEKDAYS.filter((d) => days.includes(d)))}
              aria-invalid={invalid || undefined}
              className="grid w-full max-w-sm grid-cols-7"
            >
              {WEEKDAYS.map((day) => (
                <ToggleGroupItem
                  key={day}
                  value={day}
                  aria-label={WEEKDAY_LABELS[day]}
                  className="w-full min-w-0 px-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {WEEKDAY_LABELS[day].slice(0, 3)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => field.onChange(preset.days)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="start_time"
          label="Start time"
          render={({ field, id, invalid }) => (
            <TimeInput id={id} value={field.value} onChange={field.onChange} invalid={invalid} />
          )}
        />
        <FormField
          control={form.control}
          name="end_time"
          label="End time"
          render={({ field, id, invalid }) => (
            <TimeInput id={id} value={field.value} onChange={field.onChange} invalid={invalid} allowEndOfDay />
          )}
        />
      </div>
    </FormDialog>
  )
}
