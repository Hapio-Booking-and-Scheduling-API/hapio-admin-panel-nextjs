'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import { useCalendarContext, useNowIndicator } from '@hapio/calendar-react'
import { cn } from 'cn'

import { resolvePartClassName, useCalendarClassNames } from './calendar-class-names'

export interface CalendarNowIndicatorProps {
  /** The lane it belongs to (`lane.key`); it shows only in the lane that holds "now". */
  laneKey: string
  /** Classes after the registry's and `classNames.nowIndicator`. */
  className?: string | undefined
}

/**
 * The now indicator of one time-grid lane: a line across the lane at the current time
 * (`--calendar-now-top`) with a dot at its inline start, in `--calendar-now` (the destructive
 * token). It follows the calendar's clock at minute resolution (with `nowIndicator`), is hidden
 * from assistive technology, sits above the events, and is left out of print. Render it last in
 * the lane.
 */
export function CalendarNowIndicator({ laneKey, className }: CalendarNowIndicatorProps) {
  const now = useNowIndicator(laneKey)
  const { model } = useCalendarContext()
  const classNames = useCalendarClassNames()
  if (!now.visible) return null
  const dateIso = (model.view?.kind === 'timeGrid' ? model.view.now?.dateIso : null) ?? laneKey
  return (
    <div
      {...now.getLineProps({
        className: cn(
          'pointer-events-none absolute inset-x-0 top-(--calendar-now-top) z-30 h-0 border-t-2 border-calendar-now print:hidden',
          resolvePartClassName(classNames, 'nowIndicator', { dateIso }),
          className,
        ),
      })}
    >
      <div
        {...now.getDotProps({
          className: 'absolute -start-[5px] -top-1.5 size-2.5 rounded-full bg-calendar-now',
        })}
      />
    </div>
  )
}
