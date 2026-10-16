'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import {
  useCalendarContext,
  type CalendarUiProps,
  type ViewRendererProps,
  type ViewRenderers,
} from '@hapio/calendar-react'
import { createContext, memo, use } from 'react'
import type { ComponentType } from 'react'

import { CalendarDayGrid } from './calendar-day-grid'
import { CalendarList } from './calendar-list'
import { CalendarSkeleton } from './calendar-skeleton'
import { CalendarTimeGrid } from './calendar-time-grid'

// Renderer dispatch (spec §3.8, §1.7): the active view's kind picks `renderers[kind]`, else the
// built-in renderer (`timeGrid`, `dayGrid`, `list`), else `UnsupportedView`, which says the view
// can't be shown (`strings.unsupportedView`; a view kind newer than these files, such as a
// timeline). While the model is pending the skeleton stands in at the view's size, named by
// `strings.loading`. A renderer receives the view's model; the UI props
// (`renderEvent`, `loading`, …) come from `useCalendarViewProps()`.

/** The UI props a view renderer reads (from `CalendarView`'s props). */
export type CalendarViewUiProps = Pick<
  CalendarUiProps,
  | 'renderEvent'
  | 'renderBackgroundEvent'
  | 'renderDayHeader'
  | 'renderEmpty'
  | 'loading'
  | 'headingLevel'
>

const CalendarViewPropsContext = createContext<CalendarViewUiProps>({})

/** The UI props of the nearest `CalendarView`, for custom renderers (`renderers[kind]`). */
export function useCalendarViewProps(): CalendarViewUiProps {
  return use(CalendarViewPropsContext)
}

function TimeGridRenderer() {
  const { renderEvent, renderBackgroundEvent, renderDayHeader, loading, headingLevel } =
    useCalendarViewProps()
  return (
    <CalendarTimeGrid
      renderEvent={renderEvent}
      renderBackgroundEvent={renderBackgroundEvent}
      renderDayHeader={renderDayHeader}
      loading={loading}
      headingLevel={headingLevel}
    />
  )
}

function DayGridRenderer() {
  const { renderEvent, renderBackgroundEvent, renderDayHeader, loading, headingLevel } =
    useCalendarViewProps()
  return (
    <CalendarDayGrid
      renderEvent={renderEvent}
      renderBackgroundEvent={renderBackgroundEvent}
      renderDayHeader={renderDayHeader}
      loading={loading}
      headingLevel={headingLevel}
    />
  )
}

/** The list scrolls inside its own scroller, so the block's height holds in every view. */
function ListRenderer() {
  const { renderEvent, renderEmpty, loading, headingLevel } = useCalendarViewProps()
  return (
    <div
      data-slot="calendar-scroller"
      className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-auto print:h-auto print:max-h-none print:flex-none print:overflow-visible!"
    >
      <CalendarList
        renderEvent={renderEvent}
        renderEmpty={renderEmpty}
        loading={loading}
        headingLevel={headingLevel}
      />
    </div>
  )
}

const BUILT_IN: Readonly<Record<string, ComponentType<ViewRendererProps>>> = {
  timeGrid: TimeGridRenderer,
  dayGrid: DayGridRenderer,
  list: ListRenderer,
}

/**
 * The fallback for a view kind without a renderer (a kind newer than the copied registry files):
 * "The “Timeline” view can’t be shown here." (`strings.unsupportedView`, given the view's label),
 * with the kind in `data-kind`. Pass a renderer for the kind through `renderers`, or update
 * `calendar-view.tsx`. (No developer note on the page: registry files cannot tell a development
 * build from a production one, BASES.md rule 7, and the page's readers are the app's users.)
 */
export function UnsupportedView({ view }: ViewRendererProps) {
  const { model } = useCalendarContext()
  const unsupported = model.strings.unsupportedView
  return (
    <div
      data-slot="calendar-unsupported"
      data-kind={view.kind}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"
    >
      <p className="font-medium text-foreground">
        {unsupported === undefined
          ? `The “${view.label}” view can’t be shown here.`
          : unsupported(view.label)}
      </p>
    </div>
  )
}

export interface CalendarViewProps extends CalendarViewUiProps {
  /** Renderers by view kind, over the built-in ones. */
  renderers?: ViewRenderers | undefined
}

/**
 * The active view of the calendar in `CalendarProvider`: its renderer (`renderers[kind]`, the
 * built-in one, or `UnsupportedView`), or the skeleton while the model is pending. It fills
 * what its flex-column parent leaves (the block's root, after the toolbar). Memoized: it renders
 * with a new model or new props, not with every render of its parent (a settled change).
 */
export const CalendarView = memo(function CalendarView({ renderers, ...ui }: CalendarViewProps) {
  const { model } = useCalendarContext()
  const view = model.view
  if (view === null) return <CalendarSkeleton label={model.strings.loading} />
  const Renderer = renderers?.[view.kind] ?? BUILT_IN[view.kind] ?? UnsupportedView
  return (
    <CalendarViewPropsContext value={ui}>
      <Renderer view={view} />
    </CalendarViewPropsContext>
  )
})
