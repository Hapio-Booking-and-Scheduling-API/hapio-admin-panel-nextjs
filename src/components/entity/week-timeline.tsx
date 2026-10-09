"use client"

import { format } from "date-fns"
import { cn } from "cn"
import type { CSSProperties, ReactNode } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { WEEKDAYS, type Weekday } from "@/lib/hapio/types"

// A week shown as seven horizontal day bars. Spans are positioned by their
// wall-clock fields (convert Hapio timestamps with `wallDate`), so the view
// shows the location's local time regardless of the browser's zone.

export type TimelineTone = "available" | "blocked" | "booked" | "muted"

export interface TimelineSpan {
  key: string
  /** Wall-clock start: a Date whose local fields are the location's local time. */
  start: Date
  /** Wall-clock end (exclusive). */
  end: Date
  tone: TimelineTone
  /** Tooltip text; defaults to the span's times. */
  label?: ReactNode
}

const TONE_CLASS: Record<TimelineTone, string> = {
  available:
    "bg-emerald-500/75 ring-1 ring-emerald-600/40 ring-inset dark:bg-emerald-500/65 dark:ring-emerald-400/40",
  blocked: "bg-destructive/55 ring-1 ring-destructive/50 ring-inset",
  booked: "bg-destructive/15 ring-1 ring-destructive/60 ring-inset dark:bg-destructive/25",
  muted: "bg-muted-foreground/30 ring-1 ring-muted-foreground/30 ring-inset",
}

const TONE_STYLE: Partial<Record<TimelineTone, CSSProperties>> = {
  booked: {
    backgroundImage:
      "repeating-linear-gradient(135deg, color-mix(in oklch, var(--destructive) 60%, transparent) 0 3px, transparent 3px 7px)",
  },
}

const LABEL_COL = "w-14 shrink-0 sm:w-24"

/** Minutes since the epoch of a wall-clock Date's local fields (unaffected by the browser's DST). */
export function wallMinutes(date: Date): number {
  return (
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    ) / 60_000
  )
}

function dayStartMinutes(day: Date): number {
  return Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 60_000
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`
}

/** "Mon 09:00–17:00", "Mon 22:00 – Tue 02:00", "Fri 18:00–24:00". */
export function describeSpan(start: Date, end: Date, withDate = false): string {
  const day = withDate ? "EEE d MMM" : "EEE"
  const startDay = dayStartMinutes(start)
  const endMinutes = wallMinutes(end)
  if (sameDay(start, end)) return `${format(start, `${day} HH:mm`)}–${format(end, "HH:mm")}`
  if (endMinutes === startDay + 1440) return `${format(start, `${day} HH:mm`)}–24:00`
  return `${format(start, `${day} HH:mm`)} – ${format(end, `${day} HH:mm`)}`
}

interface Segment {
  span: TimelineSpan
  left: number
  width: number
  continuesBefore: boolean
  continuesAfter: boolean
}

function segmentsFor(day: Date, spans: TimelineSpan[], [h0, h1]: [number, number]): Segment[] {
  const dayStart = dayStartMinutes(day)
  const viewStart = dayStart + h0 * 60
  const viewEnd = dayStart + h1 * 60
  const total = viewEnd - viewStart
  const out: Segment[] = []
  for (const span of spans) {
    const s = wallMinutes(span.start)
    const e = wallMinutes(span.end)
    if (!(e > s)) continue
    const a = Math.max(s, viewStart)
    const b = Math.min(e, viewEnd)
    if (b <= a) continue
    out.push({
      span,
      left: ((a - viewStart) / total) * 100,
      width: ((b - a) / total) * 100,
      continuesBefore: s < dayStart,
      continuesAfter: e > dayStart + 1440,
    })
  }
  return out
}

function DefaultDayLabel({ day }: { day: Date }) {
  return (
    <>
      <span className="sm:hidden">{format(day, "EEE d")}</span>
      <span className="hidden sm:inline">{format(day, "EEE d MMM")}</span>
    </>
  )
}

/** Weekday-only label, for weekly patterns on the canonical week. */
export const weekdayOnlyLabel = (day: Date) => format(day, "EEE")

export interface WeekTimelineProps {
  /** Wall-clock midnights, one row per day (usually seven). */
  days: Date[]
  spans: TimelineSpan[]
  /** Visible hours, default the whole day. */
  hourRange?: [number, number]
  dayLabel?: (day: Date) => ReactNode
  /** Highlights this day's label. */
  today?: Date
  /** Wall-clock "now"; draws a marker on its day. */
  now?: Date
  /** Makes spans clickable buttons. */
  onSpanClick?: (key: string) => void
  /** Include dates in the default tooltips (for real weeks rather than a weekly pattern). */
  datedTooltips?: boolean
  className?: string
  "aria-label"?: string
}

export function WeekTimeline({
  days,
  spans,
  hourRange = [0, 24],
  dayLabel,
  today,
  now,
  onSpanClick,
  datedTooltips = false,
  className,
  "aria-label": ariaLabel,
}: WeekTimelineProps) {
  const [h0, h1] = hourRange
  const range = Math.max(1, h1 - h0)
  const labelStep = range <= 6 ? 1 : range <= 12 ? 2 : range <= 18 ? 3 : 6
  const hours = Array.from({ length: range + 1 }, (_, i) => h0 + i)
  const pos = (hour: number) => ((hour - h0) / range) * 100

  return (
    <div role="figure" aria-label={ariaLabel} className={cn("flex min-w-0 flex-col gap-1.5 text-xs", className)}>
      <div className="flex items-end gap-2" aria-hidden>
        <div className={LABEL_COL} />
        <div className="relative h-4 min-w-0 flex-1">
          {hours
            .filter((h) => (h - h0) % labelStep === 0)
            .map((h) => (
              <span
                key={h}
                className={cn(
                  "absolute top-0 text-[10px] leading-4 text-muted-foreground tabular-nums",
                  h === h0 ? "" : h === h1 ? "-translate-x-full" : "-translate-x-1/2"
                )}
                style={{ left: `${pos(h)}%` }}
              >
                {hourLabel(h)}
              </span>
            ))}
        </div>
      </div>
      {days.map((day) => {
        const segments = segmentsFor(day, spans, [h0, h1])
        const isToday = !!today && sameDay(day, today)
        const nowLeft =
          now && sameDay(day, now) ? ((wallMinutes(now) - dayStartMinutes(day) - h0 * 60) / (range * 60)) * 100 : null
        return (
          <div key={day.getTime()} className="flex items-center gap-2">
            <div
              className={cn(
                LABEL_COL,
                "truncate text-muted-foreground",
                isToday && "font-semibold text-foreground"
              )}
            >
              {dayLabel ? dayLabel(day) : <DefaultDayLabel day={day} />}
            </div>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-muted/70 ring-1 ring-border/70 ring-inset">
              {hours.map((h) =>
                h > h0 && h < h1 ? (
                  <div
                    key={h}
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 w-px",
                      (h - h0) % labelStep === 0 ? "bg-foreground/10" : "bg-foreground/4"
                    )}
                    style={{ left: `${pos(h)}%` }}
                  />
                ) : null
              )}
              {segments.map((segment) => (
                <SpanBar
                  key={segment.span.key}
                  segment={segment}
                  datedTooltips={datedTooltips}
                  onClick={onSpanClick}
                />
              ))}
              {nowLeft !== null && nowLeft >= 0 && nowLeft <= 100 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary"
                  style={{ left: `${nowLeft}%` }}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SpanBar({
  segment,
  datedTooltips,
  onClick,
}: {
  segment: Segment
  datedTooltips: boolean
  onClick?: (key: string) => void
}) {
  const { span, left, width, continuesBefore, continuesAfter } = segment
  const text = describeSpan(span.start, span.end, datedTooltips)
  const label = span.label ?? text
  const className = cn(
    "absolute inset-y-1 min-w-0.5 rounded-sm",
    continuesBefore && "rounded-l-none",
    continuesAfter && "rounded-r-none",
    TONE_CLASS[span.tone]
  )
  const style: CSSProperties = { left: `${left}%`, width: `${width}%`, ...TONE_STYLE[span.tone] }
  const ariaLabel = typeof label === "string" ? label : text

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onClick ? (
          <button
            type="button"
            aria-label={ariaLabel}
            onClick={() => onClick(span.key)}
            className={cn(
              className,
              "cursor-pointer outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
            )}
            style={style}
          />
        ) : (
          <div role="img" aria-label={ariaLabel} className={className} style={style} />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TimelineLegend({
  items,
  className,
}: {
  items: Array<{ tone: TimelineTone; label: string }>
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn("size-3 rounded-sm", TONE_CLASS[item.tone])} style={TONE_STYLE[item.tone]} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Weekly patterns (weekday + times, no dates) on a fixed Monday–Sunday week.

/** Monday 1 January 2024 to Sunday 7 January 2024, as wall-clock midnights. */
export function canonicalWeek(): Date[] {
  return WEEKDAYS.map((_, i) => new Date(2024, 0, 1 + i))
}

function parseTime(value: string): [number, number, number] {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) return [0, 0, 0]
  return [+m[1], +m[2], +(m[3] ?? 0)]
}

/** A weekday with `hh:mm:ss` times (end may be `24:00:00`) → wall-clock Dates on the canonical week. */
export function weekdaySpan(weekday: Weekday, startTime: string, endTime: string): { start: Date; end: Date } {
  const offset = WEEKDAYS.indexOf(weekday)
  const [sh, sm, ss] = parseTime(startTime)
  const [eh, em, es] = parseTime(endTime)
  return {
    start: new Date(2024, 0, 1 + offset, sh, sm, ss),
    end: new Date(2024, 0, 1 + offset, eh, em, es),
  }
}

/** Maps weekly blocks (e.g. recurring schedule blocks) to spans on the canonical week. */
export function weeklySpans<T extends { weekday: Weekday; start_time: string; end_time: string }>(
  items: T[],
  toSpan: (item: T) => { key: string; tone?: TimelineTone; label?: ReactNode }
): TimelineSpan[] {
  return items.map((item) => {
    const { key, tone = "available", label } = toSpan(item)
    return { key, tone, label, ...weekdaySpan(item.weekday, item.start_time, item.end_time) }
  })
}
