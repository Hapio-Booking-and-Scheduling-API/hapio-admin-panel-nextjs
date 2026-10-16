'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import {
  useCalendarContext,
  useTimeGrid,
  type BackgroundSegment,
  type CalendarUiProps,
  type ColumnHeaderModel,
  type TimeGridLane,
  type UseTimeGridResult,
} from '@hapio/calendar-react'
import { cn } from 'cn'
import { memo } from 'react'

import { CalendarBackgroundEvent } from './calendar-background-event'
import { resolvePartClassName, useCalendarClassNames } from './calendar-class-names'
import { CalendarEventItem } from './calendar-event'
import { CalendarMorePopover } from './calendar-more-popover'
import { CalendarNowIndicator } from './calendar-now-indicator'
import { useCalendarSelectionParts } from './calendar-selection-context'
import type { CalendarSelectionParts } from './calendar-selection-context'

// The time grid (week and day views; spec §5.3, §5.5):
//
//   div scroller                     the view's one 2D scroller (overflow: auto), fills the root
//     div role=grid                  labelled by the toolbar title; overflow: clip, never hidden
//       div rowgroup  (sticky top)   row: "Time" corner (sr-only) + one column header per day,
//                                    a nav link button to the day view with `navLinks`
//       div rowgroup  (all-day)      row: "All day" + one cell per day: all-day bars, "+N more"
//       div rowgroup  (body)         row: the axis (sticky inline start; 24-hour labels, hidden
//                                    from assistive technology) + one lane per day
//         div lane                   a time surface: slot lines (a CSS gradient, no per-slot DOM),
//                                    DST bands, background events, the selection, events,
//                                    "+N more", the slot cursor, now
//
// Lanes are `--calendar-slots` × `--calendar-slot-height` tall; every part inside is positioned
// by the getters' percent geometry, so nothing measures the DOM except `scrollTime` (the hook).
// The header and axis are sticky inside the scroller (wrappers clip, never hide, overflow), and
// print in normal flow; whatever takes focus below the header keeps its measured height as
// `scroll-margin-block-start`, so focus scrolling never leaves it under the header. The column
// headers, all-day cells and lanes are memoized on their day's model, its lookups and the grid's
// getters (which keep their identity while the days' contents change), so a drop renders the
// days it leaves and lands on, not the week. Read-only, the tab stops are the header nav links
// and the events. Inside `<CalendarSelection>` (the `calendar-selection` item, through
// `calendar-selection-context`) each lane and all-day cell also draws the selection below its
// events and holds the slot cursor (the slot composite's one tab stop) after them. Today's column
// has a tint and a badge in `--calendar-today`.

const ROW_CLASS = 'grid grid-cols-[var(--calendar-axis-width)_var(--calendar-columns)]'

const SCROLLER_CLASS =
  'relative min-h-0 flex-1 rounded-xl border bg-card text-card-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground print:h-auto print:max-h-none print:flex-none print:overflow-visible!'

/** A thin pulsing bar under the header while loading (decorative; nothing is dimmed). */
const LOADING_BAR_CLASS =
  'group-data-loading/grid:after:absolute group-data-loading/grid:after:inset-x-0 group-data-loading/grid:after:bottom-0 group-data-loading/grid:after:h-0.5 group-data-loading/grid:after:bg-primary motion-safe:group-data-loading/grid:after:animate-pulse print:after:hidden'

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

/** Screen-only stickiness: the sticky parts print in normal flow. */
const STICKY_START_CLASS = 'sticky start-0 z-10 bg-card'

const NAV_LINK_CLASS =
  'flex min-h-6 w-full min-w-0 cursor-pointer flex-col items-center justify-center rounded-md px-0.5 py-0.5 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground'

export interface CalendarTimeGridProps extends Pick<
  CalendarUiProps,
  'renderEvent' | 'renderBackgroundEvent' | 'renderDayHeader' | 'loading' | 'headingLevel'
> {
  /** Classes of the scroller (the view), after the registry's and `classNames.view`. */
  className?: string | undefined
}

/**
 * The active time grid of the calendar in `CalendarProvider`; nothing while the calendar shows
 * another kind of view (or the model is pending). `loading` defaults to the event sources'
 * loading state.
 */
export function CalendarTimeGrid(props: CalendarTimeGridProps) {
  const { model } = useCalendarContext()
  if (model.view?.kind !== 'timeGrid') return null
  return <CalendarTimeGridView {...props} loading={props.loading ?? model.loading} />
}

function CalendarTimeGridView({
  renderEvent,
  renderBackgroundEvent,
  renderDayHeader,
  loading = false,
  headingLevel,
  className,
}: CalendarTimeGridProps) {
  const grid = useTimeGrid()
  const { model } = useCalendarContext()
  const classNames = useCalendarClassNames()
  // The parts of `<CalendarSelection>` (their hooks draw nothing without the engine), or `null`.
  const selection = useCalendarSelectionParts()
  return (
    <div
      {...grid.getScrollerProps({
        className: cn(
          SCROLLER_CLASS,
          resolvePartClassName(classNames, 'view', { view: model.viewName, kind: 'timeGrid' }),
          className,
        ),
      })}
    >
      <div
        {...grid.getGridProps({
          'aria-busy': loading ? true : undefined,
          'data-loading': loading ? '' : undefined,
          className: 'group/grid overflow-clip text-sm',
        })}
      >
        <div
          {...grid.getHeaderRowGroupProps({
            ref: measureStickyHeader,
            className: cn('sticky top-0 z-20 border-b bg-card print:static', LOADING_BAR_CLASS),
          })}
        >
          {grid.headerTiers.map((tier, index) => (
            <div key={index} {...grid.getHeaderRowProps(index, { className: ROW_CLASS })}>
              <div
                {...grid.getAxisHeaderProps({
                  className: cn(STICKY_START_CLASS, 'print:static'),
                })}
              >
                <span className="sr-only">{model.strings.time}</span>
              </div>
              {tier.map((header) => (
                <ColumnHeader
                  key={header.key}
                  header={header}
                  // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                  getColumnHeaderProps={grid.getColumnHeaderProps}
                  // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                  getNavLinkProps={grid.getNavLinkProps}
                  renderDayHeader={renderDayHeader}
                />
              ))}
            </div>
          ))}
        </div>
        {grid.allDay ? (
          <div
            {...grid.getAllDayRowGroupProps({
              className: cn('border-b print:break-inside-avoid', BELOW_HEADER_CLASS),
            })}
          >
            <div
              {...grid.getAllDayRowProps({
                className: 'grid grid-cols-[var(--calendar-axis-width)_minmax(0,1fr)]',
              })}
            >
              <div
                {...grid.getAllDayHeaderProps({
                  className: cn(
                    STICKY_START_CLASS,
                    'flex items-start justify-end px-1.5 py-1.5 text-end text-xs leading-none text-muted-foreground print:static',
                  ),
                })}
              >
                {model.strings.allDay}
              </div>
              {/* Not a cell: positions the all-day bars against the day columns only. */}
              <div className="relative grid min-h-[calc(max(1,var(--calendar-levels))*var(--calendar-bar-height)+0.5rem)] grid-cols-(--calendar-columns) [--calendar-row-offset:0.25rem]">
                {grid.lanes.map((lane) => (
                  <AllDayCell
                    key={lane.key}
                    lane={lane}
                    // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                    getCellProps={grid.getAllDayCellProps}
                    segments={grid.allDaySegmentsFor(lane.key)}
                    background={grid.allDayBackgroundFor(lane.key)}
                    more={grid.allDayMoreFor(lane.key)}
                    selection={selection}
                    renderEvent={renderEvent}
                    renderBackgroundEvent={renderBackgroundEvent}
                    headingLevel={headingLevel}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <div {...grid.getBodyRowGroupProps({ className: BELOW_HEADER_CLASS })}>
          <div {...grid.getBodyRowProps({ className: ROW_CLASS })}>
            <div
              {...grid.getAxisProps({
                className: cn(
                  STICKY_START_CLASS,
                  'h-[calc(var(--calendar-slots)*var(--calendar-slot-height))] print:relative',
                ),
              })}
            >
              {grid.slotLabels.map((label) => (
                <div
                  key={label.key}
                  {...grid.getSlotLabelProps(label, {
                    className:
                      'absolute end-1.5 top-[calc(var(--calendar-slot)*var(--calendar-slot-height))] -translate-y-1/2 text-xs leading-none text-muted-foreground tabular-nums first:translate-y-1',
                  })}
                >
                  {label.text}
                </div>
              ))}
              {/* The row header's text (its labels are hidden from assistive technology). */}
              <span className="sr-only">{model.strings.time}</span>
            </div>
            {grid.lanes.map((lane) => (
              <Lane
                key={lane.key}
                lane={lane}
                // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                getLaneProps={grid.getLaneProps}
                // oxlint-disable-next-line typescript/unbound-method -- the grid's getters are plain functions
                getBandProps={grid.getBandProps}
                segments={grid.segmentsFor(lane.key)}
                background={grid.backgroundFor(lane.key)}
                more={grid.moreFor(lane.key)}
                selection={selection}
                renderEvent={renderEvent}
                renderBackgroundEvent={renderBackgroundEvent}
                headingLevel={headingLevel}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ColumnHeaderProps
  extends
    Pick<CalendarUiProps, 'renderDayHeader'>,
    Pick<UseTimeGridResult, 'getColumnHeaderProps' | 'getNavLinkProps'> {
  header: ColumnHeaderModel
}

/**
 * A day's column header: its text (`formats.dayHeader`, or `renderDayHeader`) and the full date
 * for screen readers; with `navLinks`, inside a nav link to the day view. Today's text sits on a
 * badge in `--calendar-today`. Memoized: it renders again when its header or the header row's
 * getters change (today, the nav links' tab stop), never for the lanes' events.
 */
const ColumnHeader = memo(function ColumnHeader({
  header,
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
  const badge = cn(
    'max-w-full rounded-md px-0.5 py-0.5 text-xs leading-tight sm:px-1 sm:text-sm',
    header.isToday && 'bg-calendar-today/40 font-semibold',
  )
  return (
    <div
      {...getColumnHeaderProps(header, {
        className: cn(
          'flex min-w-0 items-center justify-center border-s p-1 text-center font-medium',
          resolvePartClassName(classNames, 'dayHeader', {
            dateIso: header.dateIso ?? '',
            isToday: header.isToday,
            isPast: header.isPast,
            resource: null,
          }),
        ),
      })}
    >
      {header.navLink === null ? (
        // The full date names the header; the short text is for the eye.
        <span className="flex min-h-6 min-w-0 flex-col items-center justify-center">
          <span aria-hidden="true" className={badge}>
            {text}
          </span>
          <span className="sr-only">{header.label}</span>
        </span>
      ) : (
        // A link keeps its visible text in its name (WCAG 2.5.3), then the full date.
        <button {...getNavLinkProps(header.navLink, { className: NAV_LINK_CLASS })}>
          <span className={badge}>{text}</span> <span className="sr-only">{header.label}</span>
        </button>
      )}
    </div>
  )
})

/** What a day's all-day cell and lane share: the day, its background and its parts. */
interface DayProps extends Pick<
  CalendarUiProps,
  'renderEvent' | 'renderBackgroundEvent' | 'headingLevel'
> {
  lane: TimeGridLane
  /** The day's background events (the grid's lookup: empty in a server render without events). */
  background: readonly BackgroundSegment[]
  /** The selection parts (`<CalendarSelection>`), or `null` in a read-only calendar. */
  selection: CalendarSelectionParts | null
}

interface AllDayCellProps extends DayProps {
  getCellProps: UseTimeGridResult['getAllDayCellProps']
  segments: ReturnType<UseTimeGridResult['allDaySegmentsFor']>
  more: ReturnType<UseTimeGridResult['allDayMoreFor']>
}

/**
 * A day's all-day cell: background, the selection starting here, bars by level, then its "+N
 * more" (all through the grid's lookups, which are empty in the server render with `ssrEvents:
 * false`) and the slot cursor while it is in this cell. Memoized like the lane.
 */
const AllDayCell = memo(function AllDayCell({
  lane,
  getCellProps,
  segments,
  background,
  more,
  selection,
  renderEvent,
  renderBackgroundEvent,
  headingLevel,
}: AllDayCellProps) {
  const classNames = useCalendarClassNames()
  return (
    <div
      {...getCellProps(lane, {
        className: cn(
          'min-w-0 border-s data-today:bg-calendar-today/10',
          resolvePartClassName(classNames, 'dayCell', {
            dateIso: lane.dateIso,
            isToday: lane.isToday,
            isPast: lane.isPast,
            isOtherMonth: false,
            isDisabled: false,
            resource: null,
          }),
        ),
      })}
    >
      {background.map((segment) => (
        <CalendarBackgroundEvent
          key={segment.key}
          segment={segment}
          renderBackgroundEvent={renderBackgroundEvent}
        />
      ))}
      {selection === null ? null : (
        <selection.Mirror laneKey={lane.key} surface="all-day" renderEvent={renderEvent} />
      )}
      {segments.map((segment) => (
        <CalendarEventItem key={segment.key} segment={segment} renderEvent={renderEvent} />
      ))}
      {more === null ? null : (
        <CalendarMorePopover group={more} renderEvent={renderEvent} headingLevel={headingLevel} />
      )}
      {selection === null ? null : <selection.SlotCursor laneKey={lane.key} surface="all-day" />}
    </div>
  )
})

interface LaneProps extends DayProps {
  getLaneProps: UseTimeGridResult['getLaneProps']
  getBandProps: UseTimeGridResult['getBandProps']
  segments: ReturnType<UseTimeGridResult['segmentsFor']>
  more: ReturnType<UseTimeGridResult['moreFor']>
}

/**
 * A day lane (memoized on its lane, its lookups and the grid's getters: a minute tick of the now
 * indicator, a cursor move, a selection step or a drop elsewhere keeps them, so only the parts
 * that read the clock, the cursor or the selection, and the days a drop changes, render again).
 * Content in DOM order: DST bands, background, the selection, events (chronological), "+N more",
 * the slot cursor, the now indicator.
 */
const Lane = memo(function Lane({
  lane,
  getLaneProps,
  getBandProps,
  segments,
  background,
  more,
  selection,
  renderEvent,
  renderBackgroundEvent,
  headingLevel,
}: LaneProps) {
  const classNames = useCalendarClassNames()
  return (
    <div
      {...getLaneProps(lane, {
        className: cn(
          'isolate h-[calc(var(--calendar-slots)*var(--calendar-slot-height))] min-w-0 border-s calendar-slot-lines data-today:bg-calendar-today/10',
          resolvePartClassName(classNames, 'dayLane', {
            dateIso: lane.dateIso,
            isToday: lane.isToday,
            isPast: lane.isPast,
            resource: null,
          }),
        ),
      })}
    >
      {lane.bands.map((band) => (
        <div
          key={`${band.kind}|${band.top}`}
          {...getBandProps(band, {
            className:
              'pointer-events-none absolute inset-x-0 top-(--calendar-band-top) h-(--calendar-band-height) data-gap:calendar-gap-band data-repeated:calendar-repeated-band',
          })}
        />
      ))}
      {background.map((segment) => (
        <CalendarBackgroundEvent
          key={segment.key}
          segment={segment}
          renderBackgroundEvent={renderBackgroundEvent}
        />
      ))}
      {selection === null ? null : (
        <selection.Mirror laneKey={lane.key} renderEvent={renderEvent} />
      )}
      {segments.map((segment) => (
        <CalendarEventItem key={segment.key} segment={segment} renderEvent={renderEvent} />
      ))}
      {more.map((group) => (
        <CalendarMorePopover
          key={group.key}
          group={group}
          renderEvent={renderEvent}
          headingLevel={headingLevel}
        />
      ))}
      {selection === null ? null : <selection.SlotCursor laneKey={lane.key} />}
      <CalendarNowIndicator laneKey={lane.key} />
    </div>
  )
})
