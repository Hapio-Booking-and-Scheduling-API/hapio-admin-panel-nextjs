'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import {
  useBackgroundEvent,
  useView,
  type BackgroundSegment,
  type CalendarUiProps,
} from '@hapio/calendar-react'
import { cn } from 'cn'

import { resolvePartClassName, useCalendarClassNames } from './calendar-class-names'

// A background event (open time, a closure) or the non-business shading of `businessHours`,
// drawn behind the events of a time-grid lane (`column`: `--event-top`/`--event-height` of the
// axis) or across the cells of a row (`row`: `--event-inset-start`/`--event-width` of the row).
//
// - Background events: a tint of their color (`calendar-background-fill`) with a start edge in
//   the full color. In print the tint is left out and the edge stays (exact), so open time is
//   still visible on paper without a dark block.
// - Non-business shading (`data-business="false"`): a muted tint, left out of print.
// - Names (§5.3): with a `label`, `role="img"` + `aria-label` ("Open · Thu 22 Oct 10:00–17:00");
//   with `renderBackgroundEvent` content and no label, the content owns the semantics; otherwise
//   it is hidden from assistive technology.

const ROOT_CLASS = 'absolute print:bg-transparent'

const PLACEMENT_CLASS: Readonly<Record<BackgroundSegment['variant'], string>> = {
  column: 'inset-x-0 top-(--event-top) h-(--event-height)',
  row: 'inset-y-0 start-(--event-inset-start) w-(--event-width)',
}

const KIND_CLASS: Readonly<Record<BackgroundSegment['kind'], string>> = {
  event:
    'calendar-background-fill border-s-2 border-(--event-color) [--event-color:var(--calendar-background-event)] print:[print-color-adjust:exact]',
  'non-business': 'bg-muted/60',
}

export interface CalendarBackgroundEventProps extends Pick<
  CalendarUiProps,
  'renderBackgroundEvent'
> {
  /** The segment to render (`backgroundFor(key)`, `lane.allDayBackground`). */
  segment: BackgroundSegment
  /** Classes after the registry's, the input's own and `classNames.backgroundEvent`. */
  className?: string | undefined
}

/**
 * One background segment. `renderBackgroundEvent` (called as a function) supplies its content;
 * without a label, content that it returns owns the element's semantics (`hasContent`).
 */
export function CalendarBackgroundEvent({
  segment,
  renderBackgroundEvent,
  className,
}: CalendarBackgroundEventProps) {
  const view = useView()
  const classNames = useCalendarClassNames()
  const content =
    renderBackgroundEvent === undefined
      ? null
      : renderBackgroundEvent({
          id: segment.id,
          label: segment.label,
          group: segment.group,
          allDay: segment.allDay,
          data: segment.data,
          startIso: segment.startIso,
          endIso: segment.endIso,
          color: segment.color,
          variant: segment.variant,
          view,
        })
  const hasContent =
    content !== null && content !== undefined && content !== '' && typeof content !== 'boolean'
  const background = useBackgroundEvent(segment, { hasContent })
  return (
    <div
      {...background.getRootProps({
        className: cn(
          ROOT_CLASS,
          PLACEMENT_CLASS[segment.variant],
          KIND_CLASS[segment.kind],
          resolvePartClassName(classNames, 'backgroundEvent', {
            id: segment.id,
            group: segment.group,
            label: segment.label,
            allDay: segment.allDay,
          }),
          className,
        ),
      })}
    >
      {hasContent ? content : null}
    </div>
  )
}
