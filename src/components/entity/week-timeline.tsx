"use client"

import { format } from "date-fns"
import { cn } from "cn"
import type { CSSProperties, ReactNode } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import {
  dayStartMinutes,
  describeSpan,
  hourLabel,
  sameDay,
  segmentsFor,
  wallMinutes,
  type Segment,
  type TimelineSpan,
  type TimelineTone,
} from "./week-timeline-model"

export {
  canonicalWeek,
  describeSpan,
  wallMinutes,
  weekdaySpan,
  weeklySpans,
  type TimelineSpan,
  type TimelineTone,
} from "./week-timeline-model"

// A week shown as seven horizontal day bars. Spans are positioned by their
// wall-clock fields (convert Hapio timestamps with `wallDate`), so the view
// shows the location's local time regardless of the browser's zone.

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
                  data-testid="now-marker"
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
