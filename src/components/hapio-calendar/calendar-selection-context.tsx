'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import type { CalendarUiProps, EventSegment, InteractionEngine } from '@hapio/calendar-react'
import { createContext, use } from 'react'
import type { ComponentType, ReactNode } from 'react'

// How the grids reach the selection parts without bundling them (docs/contracts/m4.md §5): the
// `calendar-selection` item's `<CalendarSelection>` provides the selection engine, the slot
// cursor and the selection layer through this context; the block passes the engine to the
// calendar and the time and day grids render the two parts in their lanes and cells. The
// `calendar-editing` item's `<CalendarEditing>` provides the same parts with both engines
// (`[selection(), editing()]`) and the drag preview, which the block renders once inside its
// root (docs/contracts/m5.md §5), the event actions (M6, docs/contracts/m6.md §5), which every
// event element renders itself in, and the recurrence scope dialog (M7), which the block renders
// once inside its root. A read-only install has no provider, so the grids render neither and the
// app bundles none of the selection or editing code. Types only from `@hapio/calendar-react`.

/** Props of the slot cursor part: the lane it is rendered in, and which surface of it. */
export interface CalendarSlotCursorProps {
  /** The lane (`TimeGridLane.key`). */
  laneKey: string
  /** `'time'` (the lane, default) or `'all-day'` (the lane's all-day cell). */
  surface?: 'time' | 'all-day' | undefined
}

/** Props of the drag preview part: the block's `renderEvent`, so it shows the event's content. */
export interface CalendarDragPreviewProps extends Pick<CalendarUiProps, 'renderEvent'> {}

/** Props of the selection layer part (and an edit's mirrors): the lane or day it draws in. */
export interface CalendarMirrorProps extends Pick<CalendarUiProps, 'renderEvent'> {
  /** A time grid's lane (`TimeGridLane.key`) or a day grid's day (`DayGridDay.key`). */
  laneKey: string
  /** Time grids: `'time'` (the lane, default) or `'all-day'` (its all-day cell). */
  surface?: 'time' | 'all-day' | undefined
}

/**
 * Props of the event actions part (`<CalendarEditing>` only; docs/contracts/m6.md §4.1): the
 * segment, where its element is, the block's `renderEvent`, and the event element itself, which
 * the part renders inside its anchor, before the "More actions" trigger.
 */
export interface CalendarEventActionsProps extends Pick<CalendarUiProps, 'renderEvent'> {
  /** The event's segment (the one `CalendarEventItem` renders). */
  segment: EventSegment
  /** `'view'` (the grid or the list) or `'popover'` (the "+N more" popover). */
  context: 'view' | 'popover'
  /** The event element. */
  children: ReactNode
}

/** What `<CalendarSelection>` and `<CalendarEditing>` provide. */
export interface CalendarSelectionParts {
  /**
   * The engines, passed to the calendar as `interaction`: `selection()`, or with editing
   * `[selection(), editing()]`.
   */
  engine: InteractionEngine | readonly InteractionEngine[]
  /** The slot cursor, rendered after the events of every lane and all-day cell. */
  SlotCursor: ComponentType<CalendarSlotCursorProps>
  /**
   * The selection layer and an edit's mirror segments, rendered before the events of every
   * lane, all-day cell and day cell.
   */
  Mirror: ComponentType<CalendarMirrorProps>
  /** The drag preview (`<CalendarEditing>` only): rendered once inside the root, after the view. */
  DragPreview?: ComponentType<CalendarDragPreviewProps> | undefined
  /**
   * The event actions (`<CalendarEditing>` only; WCAG 2.5.7): every event element renders inside
   * it, with its "More actions" menu and the reschedule form.
   */
  EventActions?: ComponentType<CalendarEventActionsProps> | undefined
  /**
   * The recurrence scope dialog (`<CalendarEditing>` only; M7): rendered once inside the root,
   * after the drag preview; it opens while a change to a recurring occurrence waits for its scope.
   */
  ScopePrompt?: ComponentType | undefined
}

/** The selection (and editing) parts, or `null` (a read-only calendar). */
export const CalendarSelectionContext = createContext<CalendarSelectionParts | null>(null)

/** The parts of the nearest `<CalendarSelection>`, or `null` outside one. */
export function useCalendarSelectionParts(): CalendarSelectionParts | null {
  return use(CalendarSelectionContext)
}
