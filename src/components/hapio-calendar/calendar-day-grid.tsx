'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import {
  useCalendarContext,
  useDayCell,
  useDayGrid,
  type CalendarUiProps,
  type ColumnHeaderModel,
  type DayGridDay,
  type DayGridWeek,
  type UseDayGridResult,
} from '@hapio/calendar-react'
import { cn } from 'cn'
import { memo } from 'react'

import { CalendarBackgroundEvent } from './calendar-background-event'
import { resolvePartClassName, useCalendarClassNames } from './calendar-class-names'
import { CalendarEventItem } from './calendar-event'
import { CalendarMorePopover } from './calendar-more-popover'
import { useCalendarSelectionParts } from './calendar-selection-context'
import type { CalendarSelectionParts } from './calendar-selection-context'

// The day grid (month view; week and day day grids too; spec §5.3):
//
//   div scroller                     the view's scroller, fills the root
//     div role=grid                  labelled by the toolbar title; measures the 'auto' capacity
//       div rowgroup  (sticky top)   row: weekday column headers ("Mon", full name for screen
//                                    readers), or day headers with nav links in week/day grids
//       div rowgroup                 the week rows (CSS grid rows sharing the height)
//         div row  (week)            position: relative; the bars are positioned against it
//           div gridcell ×7          a day: roving focus (arrow keys, Enter = its day view),
//                                    named by its content: the date (screen-reader text) first
//             week number            first cell, with `weekNumbers` (pointer shortcut, hidden)
//             day number             a nav link button by pointer (hidden: the cell names it)
//             selection              inside <CalendarSelection>: the selection's piece of this
//                                    week row, drawn by the day it starts in (below the events)
//             events                 starting here: bars (all-day, multi-day) and dots (timed)
//             "+N more"              on the cell's last visible level, opens the popover
//
// Bars sit `--calendar-row-offset` (the day number's height) plus `--event-level` ×
// `--calendar-bar-height` below the row's top; with `maxEvents: 'auto'` the hook measures the
// row, the day number and the bar height and caps the levels to what fits. Rows share the
// scroller's height (at least 6rem each) and, with 'auto', never grow with their levels, so the
// measurement reads the space, not its own result; with a number or `false` they grow to show
// every level. Rows clip their overflow until the first measurement
// (`data-auto-capacity="pending"`). Other-month days are muted; today has a tint and a badge in
// `--calendar-today`. The column headers and day cells are memoized on their model, the grid's
// lookups and its getters (which keep their identity while the days' contents change), so a drop
// renders the days it leaves and lands on (and, with week numbers, the first cell of their
// weeks), not the month.

const SCROLLER_CLASS =
  'relative min-h-0 flex-1 rounded-xl border bg-card text-card-foreground print:h-auto print:max-h-none print:flex-none print:overflow-visible!'

/**
 * What takes focus below the sticky header (cells, events, "+N more", the slot cursor) keeps the
 * header's height as `scroll-margin-block-start`, so focus scrolling never leaves it hidden under
 * the header (WCAG 2.4.11). Not on the header's own nav links, which focus must never scroll to.
 */
const BELOW_HEADER_CLASS =
  '[&_[tabindex]]:[scroll-margin-block-start:var(--calendar-header-height,0px)]'

/**
 * A ref callback for the sticky header row group: keeps `--calendar-header-height` on the grid at
 * the header's height (a ResizeObserver; the header's height depends on its text and
 * `renderDayHeader`).
 */
function measureStickyHeader(header: HTMLDivElement | null): (() => void) | undefined {
  const grid = header?.parentElement
  const win = header?.ownerDocument.defaultView
  if (!header || !grid || !win?.ResizeObserver) return undefined
  const measure = (): void => {
    grid.style.setProperty('--calendar-header-height', `${header.getBoundingClientRect().height}px`)
  }
  // At once (focus may move before the first observation), then on every resize.
  measure()
  const observer = new win.ResizeObserver(measure)
  observer.observe(header)
  return () => observer.disconnect()
}

/** A thin pulsing bar under the header while loading (decorative; nothing is dimmed). */
const LOADING_BAR_CLASS =
  'group-data-loading/grid:after:absolute group-data-loading/grid:after:inset-x-0 group-data-loading/grid:after:bottom-0 group-data-loading/grid:after:h-0.5 group-data-loading/grid:after:bg-primary motion-safe:group-data-loading/grid:after:animate-pulse print:after:hidden'

const NUMBER_CLASS =
  'relative z-[1] inline-flex shrink-0 items-center justify-center rounded-full tabular-nums'

const LINK_CLASS = 'cursor-pointer hover:bg-accent hover:text-accent-foreground'

export interface CalendarDayGridProps extends Pick<
  CalendarUiProps,
  'renderEvent' | 'renderBackgroundEvent' | 'renderDayHeader' | 'loading' | 'headingLevel'
> {
  /** Classes of the scroller (the view), after the registry's and `classNames.view`. */
  className?: string | undefined
}

/**
 * The active day grid of the calendar in `CalendarProvider`; nothing while the calendar shows
 * another kind of view (or the model is pending). `loading` defaults to the event sources'
 * loading state.
 */
export function CalendarDayGrid(props: CalendarDayGridProps) {
  const { model } = useCalendarContext()
  if (model.view?.kind !== 'dayGrid') return null
  return <CalendarDayGridView {...props} loading={props.loading ?? model.loading} />
}

function CalendarDayGridView({
  renderEvent,
  renderBackgroundEvent,
  renderDayHeader,
  loading = false,
  headingLevel,
  className,
}: CalendarDayGridProps) {
  const grid = useDayGrid()
  const { model } = useCalendarContext()
  const classNames = useCalendarClassNames()
  // The parts of `<CalendarSelection>` (their hooks draw nothing without the engine), or `null`.
  const selection = useCalendarSelectionParts()
  const autoCapacity = model.view?.kind === 'dayGrid' ? model.view.autoCapacity : null
  return (
    <div
      {...grid.getScrollerProps({
        className: cn(
          SCROLLER_CLASS,
          resolvePartClassName(classNames, 'view', { view: model.viewName, kind: 'dayGrid' }),
          className,
        ),
      })}
    >
      <div
        {...grid.getGridProps({
          'aria-busy': loading ? true : undefined,
          'data-loading': loading ? '' : undefined,
          className:
            'group/grid grid min-h-full grid-rows-[auto_1fr] overflow-clip text-sm [--calendar-day-number-height:1.75rem] [--calendar-row-offset:var(--calendar-day-number-height)]',
        })}
      >
        <div
          {...grid.getHeaderRowGroupProps({
            ref: measureStickyHeader,
            className: cn('sticky top-0 z-20 border-b bg-card print:static', LOADING_BAR_CLASS),
          })}
        >
          <div {...grid.getHeaderRowProps({ className: 'grid grid-cols-(--calendar-columns)' })}>
            {grid.columnHeaders.map((header, index) => (
              <ColumnHeader
                key={header.key}
                header={header}
                dateIso={header.dateIso ?? grid.weeks[0]?.days[index]?.dateIso ?? ''}
                // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                getColumnHeaderProps={grid.getColumnHeaderProps}
                // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                getNavLinkProps={grid.getNavLinkProps}
                renderDayHeader={renderDayHeader}
              />
            ))}
          </div>
        </div>
        <div
          {...grid.getBodyRowGroupProps({
            className: cn('grid auto-rows-[minmax(6rem,1fr)]', BELOW_HEADER_CLASS),
          })}
        >
          {grid.weeks.map((week) => (
            <div
              key={week.key}
              {...grid.getWeekRowProps(week, {
                className: cn(
                  'grid grid-cols-(--calendar-columns) border-b last:border-b-0 print:break-inside-avoid',
                  autoCapacity === null
                    ? 'min-h-[calc(var(--calendar-day-number-height)+var(--calendar-levels)*var(--calendar-bar-height))]'
                    : autoCapacity === 'pending' && 'overflow-clip',
                ),
              })}
            >
              {week.days.map((day) => (
                <DayCell
                  key={day.key}
                  day={day}
                  week={day.col === 0 && week.weekNumber !== null ? week : null}
                  // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                  getWeekNumberProps={grid.getWeekNumberProps}
                  // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                  getDayNumberProps={grid.getDayNumberProps}
                  segments={grid.segmentsFor(day.key)}
                  background={grid.backgroundFor(day.key)}
                  more={grid.moreFor(day.key)}
                  selection={selection}
                  renderEvent={renderEvent}
                  renderBackgroundEvent={renderBackgroundEvent}
                  headingLevel={headingLevel}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface ColumnHeaderProps
  extends
    Pick<CalendarUiProps, 'renderDayHeader'>,
    Pick<UseDayGridResult, 'getColumnHeaderProps' | 'getNavLinkProps'> {
  header: ColumnHeaderModel
  /**
   * The day for the `dayHeader` class state: the header's date, or for a month's weekday header
   * (no date of its own) that weekday's date in the first week shown.
   */
  dateIso: string
}

/**
 * A column header: the weekday ("Mon", named "Monday") of a month grid, or a day of a week/day
 * grid, with a nav link to the day view when `navLinks` is on (a pointer shortcut: Enter on a
 * day cell follows the same link). Memoized: the days' events never render it.
 */
const ColumnHeader = memo(function ColumnHeader({
  header,
  dateIso,
  getColumnHeaderProps,
  getNavLinkProps,
  renderDayHeader,
}: ColumnHeaderProps) {
  const classNames = useCalendarClassNames()
  const text =
    renderDayHeader === undefined || header.dateIso === null
      ? header.text
      : renderDayHeader({
          dateIso: header.dateIso,
          text: header.text,
          isToday: header.isToday,
          isPast: header.isPast,
        })
  const badge = cn('rounded-md px-1 py-0.5', header.isToday && 'bg-calendar-today/40 font-semibold')
  return (
    <div
      {...getColumnHeaderProps(header, {
        className: cn(
          'flex min-w-0 items-center justify-center border-s px-1 py-1.5 text-center text-xs font-medium text-muted-foreground first:border-s-0',
          resolvePartClassName(classNames, 'dayHeader', {
            dateIso,
            isToday: header.isToday,
            isPast: header.isPast,
            resource: null,
          }),
        ),
      })}
    >
      {header.navLink === null ? (
        <>
          <span aria-hidden="true" className={badge}>
            {text}
          </span>
          <span className="sr-only">{header.label}</span>
        </>
      ) : (
        <button
          {...getNavLinkProps(header.navLink, {
            className: cn(
              'min-h-6 cursor-pointer rounded-md px-1 text-foreground outline-none hover:bg-accent hover:text-accent-foreground',
              badge,
            ),
          })}
        >
          {text} <span className="sr-only">{header.label}</span>
        </button>
      )}
    </div>
  )
})

interface DayCellProps
  extends
    Pick<CalendarUiProps, 'renderEvent' | 'renderBackgroundEvent' | 'headingLevel'>,
    Pick<UseDayGridResult, 'getWeekNumberProps' | 'getDayNumberProps'> {
  day: DayGridDay
  /** The week, for its number: the first cell of a week with a number only (else `null`). */
  week: DayGridWeek | null
  /** The day's lookups (empty in a server render without events). */
  segments: ReturnType<UseDayGridResult['segmentsFor']>
  background: ReturnType<UseDayGridResult['backgroundFor']>
  more: ReturnType<UseDayGridResult['moreFor']>
  /** The selection parts (`<CalendarSelection>`), or `null` in a read-only calendar. */
  selection: CalendarSelectionParts | null
}

/**
 * One day: week number (first cell), day number, background, the selection starting here,
 * events by level, "+N more". Memoized: it renders again for its own day (its model, its tab
 * stop and selection through `useDayCell`), never for another day's events.
 */
const DayCell = memo(function DayCell({
  day,
  week,
  getWeekNumberProps,
  getDayNumberProps,
  segments,
  background,
  more,
  selection,
  renderEvent,
  renderBackgroundEvent,
  headingLevel,
}: DayCellProps) {
  const classNames = useCalendarClassNames()
  const cell = useDayCell(day)
  const weekNumber = week?.weekNumber ?? null
  return (
    <div
      {...cell.getCellProps({
        className: cn(
          'min-w-0 border-s px-0.5 outline-none first:border-s-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground focus-visible:outline-solid data-other-month:bg-muted/40 data-today:bg-calendar-today/10',
          resolvePartClassName(classNames, 'dayCell', {
            dateIso: day.dateIso,
            isToday: day.isToday,
            isPast: day.isPast,
            isOtherMonth: day.isOther,
            isDisabled: day.isDisabled,
            resource: null,
          }),
        ),
      })}
    >
      {/* The cell's name ("Thursday, October 22, 2026, 3 events"), then its events' text. */}
      <span className="sr-only">{day.label}</span>
      <div className="flex h-(--calendar-day-number-height) items-center justify-end gap-0.5">
        {week === null || weekNumber === null ? null : weekNumber.navLink === null ? (
          <span
            {...getWeekNumberProps(week, {
              className: cn(NUMBER_CLASS, 'me-auto h-6 min-w-6 px-0.5 text-[0.625rem]'),
            })}
          >
            {weekNumber.text}
          </span>
        ) : (
          <button
            {...getWeekNumberProps(week, {
              className: cn(NUMBER_CLASS, LINK_CLASS, 'me-auto h-6 min-w-6 px-0.5 text-[0.625rem]'),
            })}
          >
            {weekNumber.text}
          </button>
        )}
        {day.dayNumberText === '' ? null : (
          <DayNumber day={day} getDayNumberProps={getDayNumberProps} />
        )}
      </div>
      {background.map((segment) => (
        <CalendarBackgroundEvent
          key={segment.key}
          segment={segment}
          renderBackgroundEvent={renderBackgroundEvent}
        />
      ))}
      {selection === null ? null : <selection.Mirror laneKey={day.key} renderEvent={renderEvent} />}
      {segments.map((segment) => (
        <CalendarEventItem key={segment.key} segment={segment} renderEvent={renderEvent} />
      ))}
      {more === null ? null : (
        <CalendarMorePopover group={more} renderEvent={renderEvent} headingLevel={headingLevel} />
      )}
    </div>
  )
})

/** The day number: a nav link to the day view by pointer, else plain text; today on a badge. */
function DayNumber({
  day,
  getDayNumberProps,
}: { day: DayGridDay } & Pick<UseDayGridResult, 'getDayNumberProps'>) {
  const className = cn(
    NUMBER_CLASS,
    'h-(--calendar-day-number-height) min-w-6 px-1 text-xs sm:min-w-(--calendar-day-number-height)',
    day.isOther && !day.isToday && 'text-muted-foreground',
    day.isToday && 'bg-calendar-today/40 font-semibold',
  )
  return day.navLink === null ? (
    <span {...getDayNumberProps(day, { className })}>{day.dayNumberText}</span>
  ) : (
    <button {...getDayNumberProps(day, { className: cn(className, LINK_CLASS) })}>
      {day.dayNumberText}
    </button>
  )
}
