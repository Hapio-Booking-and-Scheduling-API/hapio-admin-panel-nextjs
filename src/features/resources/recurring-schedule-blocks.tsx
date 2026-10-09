"use client"

import { CalendarRangeIcon, ChevronDownIcon, ClockIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { ConfirmDialog } from "@/components/entity/confirm-dialog"
import { ErrorAlert } from "@/components/entity/error-alert"
import { WeekTimeline, canonicalWeek, weekdayOnlyLabel, weeklySpans, weekdaySpan, wallMinutes } from "@/components/entity/week-timeline"
import { WEEKDAY_LABELS } from "@/components/inputs/weekday-select"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { shortTime } from "@/lib/format/datetime"
import { hapio } from "@/lib/hapio/client"
import { useHapioMutation } from "@/lib/hapio/hooks"
import { WEEKDAYS, type RecurringSchedule, type RecurringScheduleBlock, type Weekday } from "@/lib/hapio/types"

import { RecurringBlockFormDialog, WeekdayHoursDialog } from "./recurring-block-forms"
import { useRecurringScheduleBlocks } from "./queries"
import { compareWeeklyBlocks, formatHours } from "./utils"

function blockTimes(block: RecurringScheduleBlock) {
  return `${shortTime(block.start_time)}–${shortTime(block.end_time)}`
}

function blockMinutes(block: RecurringScheduleBlock) {
  const { start, end } = weekdaySpan(block.weekday, block.start_time, block.end_time)
  return Math.max(0, wallMinutes(end) - wallMinutes(start))
}

/** The weekday blocks of one recurring schedule: weekly preview, list and editing. */
export function RecurringScheduleBlocks({
  resourceId,
  schedule,
}: {
  resourceId: string
  schedule: RecurringSchedule
}) {
  const query = useRecurringScheduleBlocks(resourceId, schedule.id)
  const [dialog, setDialog] = useState<{ block?: RecurringScheduleBlock; weekday?: Weekday } | null>(null)
  const [bulk, setBulk] = useState(false)
  const [deleting, setDeleting] = useState<RecurringScheduleBlock | null>(null)

  const remove = useHapioMutation(
    (id: string) => hapio.recurringScheduleBlocks(resourceId, schedule.id).delete(id),
    { success: "Block deleted" }
  )

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  }
  if (query.error || !query.data) return <ErrorAlert error={query.error} onRetry={() => query.refetch()} />

  const blocks = [...query.data].sort(compareWeeklyBlocks)
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const totalMinutes = blocks.reduce((sum, b) => sum + blockMinutes(b), 0)
  const spans = weeklySpans(blocks, (b) => ({
    key: b.id,
    label: `${WEEKDAY_LABELS[b.weekday]} ${blockTimes(b)} · click to edit`,
  }))

  const actions = (
    <>
      <Button size="sm" variant="outline" onClick={() => setBulk(true)}>
        <CalendarRangeIcon /> Add weekday hours
      </Button>
      <Button size="sm" variant="outline" onClick={() => setDialog({})}>
        <PlusIcon /> Add block
      </Button>
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      {blocks.length === 0 ? (
        <Empty className="border bg-muted/30 p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClockIcon />
            </EmptyMedia>
            <EmptyTitle>No weekly hours yet</EmptyTitle>
            <EmptyDescription>
              Add the hours this resource is available on each weekday, e.g. Monday to Friday 09:00–17:00.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">{actions}</EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {blocks.length} {blocks.length === 1 ? "block" : "blocks"} · {formatHours(totalMinutes)} per week
            </p>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
          <WeekTimeline
            days={canonicalWeek()}
            spans={spans}
            dayLabel={weekdayOnlyLabel}
            onSpanClick={(key) => setDialog({ block: byId.get(key) })}
            aria-label="Weekly hours"
          />
          <ul className="divide-y rounded-lg border">
            {WEEKDAYS.map((day) => {
              const dayBlocks = blocks.filter((b) => b.weekday === day)
              return (
                <li key={day} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="w-12 shrink-0 text-sm font-medium sm:w-24">
                    <span className="sm:hidden">{WEEKDAY_LABELS[day].slice(0, 3)}</span>
                    <span className="hidden sm:inline">{WEEKDAY_LABELS[day]}</span>
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {dayBlocks.length ? (
                      dayBlocks.map((b) => (
                        <BlockChip
                          key={b.id}
                          block={b}
                          onEdit={() => setDialog({ block: b })}
                          onDelete={() => setDeleting(b)}
                        />
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No hours</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Add block on ${WEEKDAY_LABELS[day]}`}
                    title={`Add block on ${WEEKDAY_LABELS[day]}`}
                    onClick={() => setDialog({ weekday: day })}
                  >
                    <PlusIcon />
                  </Button>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {dialog && (
        <RecurringBlockFormDialog
          resourceId={resourceId}
          scheduleId={schedule.id}
          block={dialog.block}
          defaultWeekday={dialog.weekday}
          onClose={() => setDialog(null)}
        />
      )}
      {bulk && <WeekdayHoursDialog resourceId={resourceId} scheduleId={schedule.id} onClose={() => setBulk(false)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete ${WEEKDAY_LABELS[deleting.weekday]} ${blockTimes(deleting)}?` : "Delete block?"}
        description="The hours are removed from this recurring schedule."
        confirmLabel="Delete block"
        destructive
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  )
}

function BlockChip({
  block,
  onEdit,
  onDelete,
}: {
  block: RecurringScheduleBlock
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          className="border-emerald-500/30 bg-emerald-500/10 tabular-nums hover:bg-emerald-500/20 dark:bg-emerald-500/15"
          aria-label={`${WEEKDAY_LABELS[block.weekday]} ${blockTimes(block)}`}
        >
          {blockTimes(block)}
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onEdit}>
          <PencilIcon /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
