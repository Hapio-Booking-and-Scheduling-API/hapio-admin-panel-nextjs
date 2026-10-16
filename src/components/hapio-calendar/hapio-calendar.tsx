'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import {
  CalendarProvider,
  useCalendar,
  useToolbar,
  type DefaultViews,
  type HapioCalendarProps,
  type ViewMap,
} from '@hapio/calendar-react'
import { cn } from 'cn'
import { Suspense, useState } from 'react'

import { CalendarClassNamesProvider, resolvePartClassName } from './calendar-class-names'
import { CalendarDescriptions } from './calendar-descriptions'
import { CalendarLinkProvider } from './calendar-link'
import { CalendarLiveRegion } from './calendar-live-region'
import { useCalendarSelectionParts } from './calendar-selection-context'
import { CalendarSkeleton } from './calendar-skeleton'
import { CalendarToolbar } from './calendar-toolbar'
import { CalendarView } from './calendar-view'

export type { HapioCalendarProps } from '@hapio/calendar-react'

// The batteries-included calendar (spec §3.8): every calendar option plus the UI props, in one
// component.
//
//   div root (className, style)   flex column; give it the height (the toolbar included)
//     toolbar                     the registry toolbar, your node (`toolbar`), or none (then
//                                 its title alone, visually hidden: it names the grids)
//     view                        week | day | month | list (`defaultViews`), or your views;
//                                 fills the rest of the root and scrolls inside it
//     drag preview                inside <CalendarEditing> only, while an event is dragged
//     scope dialog                inside <CalendarEditing> only, while a change to a recurring
//                                 occurrence waits for its scope (portalled by the Dialog)
//     descriptions, live region   hidden event descriptions; navigation announcements
//
// ```tsx
// <HapioCalendar events={events} timeZone="Europe/Stockholm" nowIndicator
//                className="h-[max(36rem,calc(100svh-17rem))]" />
// ```
//
// `timeZone` defaults to the browser's (`'local'`), which only the browser knows: on the server
// the block renders its skeleton (at the root's size, named by `strings.loading`) inside its own
// `<Suspense>` boundary and the calendar appears after hydration. Pass an IANA zone, a `locale`
// and `now` or `date` for a complete server render: the block then has no boundary of its own,
// so the server's HTML shows the calendar even before (or without) JavaScript (React streams a
// large completed boundary out of place, for JavaScript to reveal). `loading` marks the root
// (`data-loading`) and the view (`aria-busy`, never the root around the live region) and draws a
// thin progress bar; nothing is dimmed.
//
// The block is read-only on its own. Inside `<CalendarSelection>` (the `calendar-selection`
// item) it takes the selection engine from that context, and its grids draw the slot cursor and
// the selection, so `selectable`, `onSelect` and slot clicks work. Inside `<CalendarEditing>`
// (the `calendar-editing` item) it takes both engines, the grids also draw the edits' mirrors
// and the events their resize handles, and the root holds the drag preview (once, after the
// view: the engines look for it inside the root) and the recurrence scope dialog (M7), so
// `editable` and `onEventChange` work too.
// `interaction` counts only inside either (it replaces the context's engines): outside, the
// grids would have nothing to draw a selection with, so the block tells `useCalendar`
// (`selectionParts: false`), which ignores it and says so in development builds.

/** The stamp of these files (the header above), for the hooks' contract check (spec §6.3). */
const REGISTRY = { version: '0.0.0', contract: 1 } as const

/**
 * The root: a flex column whose height (from `className`/`style`) the view fills. In print it
 * has no fixed height (print R1), `!important` because `style` and compat's `height` set the
 * height inline.
 */
const ROOT_CLASS = 'relative flex min-h-0 flex-col gap-3 print:h-auto! print:max-h-none!'

/**
 * The calendar: toolbar, view (time grid, day grid or list, by the active view's kind),
 * descriptions and live region, with every option of `useCalendar` and the UI props of
 * `CalendarUiProps`. Give it a height through `className` or `style`.
 */
export function HapioCalendar<
  TData = undefined,
  TRes = undefined,
  const V extends ViewMap = DefaultViews,
  TDrag = never,
>(props: HapioCalendarProps<TData, TRes, V, TDrag>) {
  // Only `timeZone: 'local'` waits for the browser (`useCalendar` suspends on the server). Decided
  // once, so a later change of the zone never remounts the calendar.
  const [boundary] = useState(() => props.timeZone === undefined || props.timeZone === 'local')
  if (!boundary) return <HapioCalendarRoot {...props} />
  return (
    <Suspense
      fallback={
        <CalendarSkeleton
          toolbar={props.toolbar !== false}
          label={props.strings?.loading}
          className={cn(ROOT_CLASS, props.className)}
          style={props.style}
        />
      }
    >
      <HapioCalendarRoot {...props} />
    </Suspense>
  )
}

function HapioCalendarRoot<TData, TRes, const V extends ViewMap, TDrag>({
  toolbar = true,
  renderers,
  renderEvent,
  renderBackgroundEvent,
  renderDayHeader,
  renderEmpty,
  classNames,
  linkComponent,
  loading,
  headingLevel,
  className,
  style,
  ...options
}: HapioCalendarProps<TData, TRes, V, TDrag>) {
  const parts = useCalendarSelectionParts()
  const DragPreview = parts?.DragPreview
  const ScopePrompt = parts?.ScopePrompt
  const calendar = useCalendar<TData, TRes, V, TDrag>(
    { ...options, interaction: options.interaction ?? parts?.engine },
    { registry: REGISTRY, selectionParts: parts !== null },
  )
  const { model } = calendar
  const busy = loading ?? model.loading
  return (
    <CalendarLinkProvider component={linkComponent}>
      <CalendarClassNamesProvider classNames={classNames}>
        <CalendarProvider value={calendar}>
          <div
            {...calendar.getRootProps({
              style: style === undefined ? undefined : { ...style },
              'data-loading': loading === true ? '' : undefined,
              className: cn(
                ROOT_CLASS,
                resolvePartClassName(classNames, 'root', {
                  view: model.viewName,
                  kind: model.view?.kind ?? '',
                  loading: busy,
                }),
                className,
              ),
            })}
          >
            {toolbar === true ? <CalendarToolbar /> : toolbar === false ? <HiddenTitle /> : toolbar}
            <CalendarView
              renderers={renderers}
              renderEvent={renderEvent}
              renderBackgroundEvent={renderBackgroundEvent}
              renderDayHeader={renderDayHeader}
              renderEmpty={renderEmpty}
              loading={busy}
              headingLevel={headingLevel}
            />
            {DragPreview && <DragPreview renderEvent={renderEvent} />}
            {ScopePrompt && <ScopePrompt />}
            <CalendarDescriptions />
            <CalendarLiveRegion />
          </div>
        </CalendarProvider>
      </CalendarClassNamesProvider>
    </CalendarLinkProvider>
  )
}

/**
 * The period's title where `toolbar={false}` leaves none, visually hidden: the grids are named by
 * it (their `aria-labelledby` is the title's id), and the list's and popover's headings stay
 * below an `h2` (the M8 review's L2-3). A `toolbar` node of your own renders
 * `useToolbar().getTitleProps()` itself.
 */
function HiddenTitle() {
  const toolbar = useToolbar()
  return <h2 {...toolbar.getTitleProps({ className: 'sr-only' })}>{toolbar.title}</h2>
}
