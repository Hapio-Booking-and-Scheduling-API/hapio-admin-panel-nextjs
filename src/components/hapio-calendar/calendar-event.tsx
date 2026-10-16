'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import {
  useCalendarEvent,
  useView,
  type CalendarPartState,
  type CalendarUiProps,
  type EventContent,
  type EventSegment,
} from '@hapio/calendar-react'
import { cn } from 'cn'
import { createContext, memo, use } from 'react'
import type { ReactNode } from 'react'

import { resolvePartClassName, useCalendarClassNames } from './calendar-class-names'
import { CalendarLink } from './calendar-link'
import { useCalendarSelectionParts } from './calendar-selection-context'

// One event: an `<a>` when it has an `href` (through the app's link component), otherwise a
// `<button>`. Its accessible name is its visible text, time first ("09:00 – 10:30 Haircut ·
// Anna"); the date and resources come from the description (`aria-describedby`).
//
// Editing (inside `<CalendarEditing>`, the `calendar-editing` item; docs/contracts/m5.md §4.1):
// the event shows resize handles where `edits` allows them, and its edit states as attributes:
// `data-dragging`/`data-resizing` (the source stays in place, dimmed, while the mirror shows
// where it would land), `data-pending` (its change awaits the app), `data-reverting` (the app
// rejected it) and `data-touch-selected` (a long-press selected it). A read-only calendar
// renders none of this. The looks of those states and of the handles live in `calendar-theme`'s
// css (keyed on the attributes), and a movable event takes its `calendar-event-movable` utility,
// so a read-only bundle carries almost nothing of them; the mirror and the drag preview draw the
// event with `useEventLook`. With `<CalendarEditing>` (M6, docs/contracts/m6.md §4.1) the element
// renders inside the context's `EventActions` part: an anchor (`display: contents`) that hears
// its context menu and Shift+F10, with the "More actions" trigger after the event (WCAG 2.5.7);
// a read-only calendar has no such part, so it renders and bundles none of it.
//
// Layouts, by the segment's variant (`data-variant`) and display (`data-display`):
// - `list`: a row of the list view, with a color dot before the time;
// - `column`: a time-grid event, positioned in its day lane by the getters' percent geometry
//   (`--event-top`, `--event-height`, `--event-inset-start`, `--event-width`, `--event-z`) and
//   filled with its color; short events (`data-short`) put the time and title on one line;
// - `row`, `block`: an all-day or multi-day bar of a day grid or the all-day row, filled with its
//   color and positioned against the row (`--event-inset-start`, `--event-width`, and its level
//   `--event-level` below `--calendar-row-offset`, one `--calendar-bar-height` per level);
// - `row`, `list-item`: a timed event of one day in a day grid: a color dot, the start time and
//   the title, on the cell's background.
// In the "+N more" popover (`context: 'popover'`) events take the same looks in flow.
//
// The time and the title each take their own direction from their text (`dir="auto"`): the time
// range keeps its order in a right-to-left calendar, and a title in another script than the
// calendar's is cut at its own end ("Haircut · An…" in a Hebrew month, not "…ircut · Anna");
// both still align by the calendar's direction (`calendar-theme`: `text-align: match-parent` on
// both parts' `data-slot`).
//
// The event's own `className` (from the event input, e.g. a booking status) lands on the element
// itself, before the classes below. These classes set no `font-style` and no
// `text-decoration`, so status classes such as `italic` or `line-through` always apply. Colors:
// the event's `color`/`contrastColor` (inline `--event-color`/`--event-contrast`), else the
// theme's `--calendar-event`/`--calendar-event-foreground`.
//
// Print: a filled event keeps its fill and its contrast text together (both exact); a list or
// list-item event prints its text economy and only its color dot exact.

/**
 * Classes of the time part (`CalendarEventTime`); reuse them in a custom `renderEvent`, with
 * `data-slot="calendar-event-time"` and `dir="auto"` on the element.
 */
export const EVENT_TIME_CLASS = 'shrink-0 tabular-nums'
/**
 * Classes of the title part (`CalendarEventTitle`); reuse them in a custom `renderEvent`, with
 * `data-slot="calendar-event-title"` and `dir="auto"` on the element.
 */
export const EVENT_TITLE_CLASS = 'min-w-0 font-medium break-words'

// Focus: a solid 2px outline in the foreground color, which keeps 3:1 against the background in
// both schemes (WCAG 1.4.11) and turns into a system color in forced-colors mode (a box-shadow
// ring would disappear there). Print: only the color dot keeps its exact color; the text prints
// economy, so dark-theme text is not printed light on white paper.
const EVENT_CLASS =
  'outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground print:before:[print-color-adjust:exact]'

/** The theme's colors unless the event sets its own (inline styles win over these). */
const COLOR_CLASS =
  '[--event-color:var(--calendar-event)] [--event-contrast:var(--calendar-event-foreground)]'

/** How an event looks: its variant, and for row events a bar or a dot. */
type EventLook = 'list' | 'column' | 'block' | 'list-item'

/** A color dot before the time (list rows and list-item events). */
const DOT_CLASS =
  'before:size-2 before:shrink-0 before:self-center before:rounded-full before:bg-(--event-color)'

/** Filled with the event's color; fill and text print together (exact). */
const FILL_CLASS = 'bg-(--event-color) text-(--event-contrast) print:[print-color-adjust:exact]'

/** One line: the title (the last part) is cut with an ellipsis. */
const ONE_LINE_CLASS =
  'flex min-w-0 items-center gap-1 overflow-hidden text-xs whitespace-nowrap [&>:last-child]:truncate'

const LOOK_CLASS: Readonly<Record<EventLook, string>> = {
  list: cn(
    'flex w-full min-w-0 cursor-pointer items-baseline gap-x-3 rounded-md px-2.5 py-1.5 text-start text-sm',
    'hover:bg-accent hover:text-accent-foreground data-past:before:opacity-50',
    DOT_CLASS,
  ),
  column: cn(
    // Words that do not fit a narrow lane are cut, not broken mid-word.
    'flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-sm px-1 py-0.5 text-start text-xs leading-tight ring-1 ring-card *:[overflow-wrap:normal]',
    'data-short:flex-row data-short:items-baseline data-short:gap-1 data-short:py-0 data-short:whitespace-nowrap data-short:[&>:last-child]:truncate',
    FILL_CLASS,
  ),
  block: cn(
    ONE_LINE_CLASS,
    'cursor-pointer rounded-sm px-1.5 text-start not-data-end:rounded-e-none not-data-start:rounded-s-none',
    FILL_CLASS,
  ),
  'list-item': cn(
    ONE_LINE_CLASS,
    'cursor-pointer rounded-sm px-1 text-start text-foreground hover:bg-accent hover:text-accent-foreground',
    DOT_CLASS,
  ),
}

/** Where the event sits: positioned by the getters' geometry in the view, in flow in a popover. */
const PLACEMENT_CLASS = {
  column:
    'absolute start-(--event-inset-start) top-(--event-top) z-(--event-z) h-(--event-height) w-(--event-width)',
  row: 'absolute start-[calc(var(--event-inset-start)+2px)] top-[calc(var(--calendar-row-offset,0px)+var(--event-level)*var(--calendar-bar-height))] h-[calc(var(--calendar-bar-height)-2px)] w-[calc(var(--event-width)-4px)]',
  flow: 'relative h-[calc(var(--calendar-bar-height)+0.25rem)] w-full',
} as const

/** The time part's classes per look (list rows: a column wide enough that titles line up). */
const TIME_CLASS: Readonly<Record<EventLook, string>> = {
  list: cn(EVENT_TIME_CLASS, 'w-28'),
  column: EVENT_TIME_CLASS,
  block: EVENT_TIME_CLASS,
  'list-item': EVENT_TIME_CLASS,
}

/** Where an event element sits (`PLACEMENT_CLASS`), or nowhere in particular (a list row). */
type EventPlacement = keyof typeof PLACEMENT_CLASS | 'list'

/**
 * The registry's classes of an event element by look, placement and whether it moves, merged
 * once per combination (at most 32): rendering a week of events merges no class strings unless
 * `classNames.event` or a `className` adds some.
 */
const ELEMENT_CLASS = new Map<string, string>()

function elementClassOf(look: EventLook, placement: EventPlacement, movable: boolean): string {
  const key = `${look} ${placement} ${movable ? 'movable' : ''}`
  let value = ELEMENT_CLASS.get(key)
  if (value === undefined) {
    value = cn(
      EVENT_CLASS,
      COLOR_CLASS,
      placement === 'list' ? '' : PLACEMENT_CLASS[placement],
      LOOK_CLASS[look],
      movable && 'cursor-grab calendar-event-movable',
    )
    ELEMENT_CLASS.set(key, value)
  }
  return value
}

/**
 * The look of a segment: list rows, time-grid columns, and in day grids and the all-day row a
 * bar (`block`: all-day, multi-day or continued events) or a dot (`list-item`: a timed event of
 * one day). Events of a time grid listed in a popover (`maxStack`) show as list items.
 */
function lookOf(segment: EventSegment, inPopover: boolean): EventLook {
  if (segment.variant === 'list') return 'list'
  if (segment.variant === 'column') return inPopover ? 'list-item' : 'column'
  const oneDay = segment.isStart && segment.isEnd && segment.endCol - segment.startCol === 1
  return !segment.isAllDay && oneDay ? 'list-item' : 'block'
}

interface EventParts {
  readonly content: EventContent
  readonly look: EventLook
}

const EventContentContext = createContext<EventParts | null>(null)

function useEventParts(part: string): EventParts {
  const parts = use(EventContentContext)
  if (parts === null) {
    throw new Error(`Hapio Calendar: ${part} must be rendered inside CalendarEventItem.`)
  }
  return parts
}

export interface CalendarEventPartProps {
  className?: string | undefined
}

/** The time part's element (`CalendarEventTime`), or `null` without a time. */
function eventTime(content: EventContent, look: EventLook, className?: string): ReactNode {
  if (content.timeText === '') return null
  return (
    <span
      data-slot="calendar-event-time"
      dir="auto"
      className={className === undefined ? TIME_CLASS[look] : cn(TIME_CLASS[look], className)}
    >
      {content.timeText}
    </span>
  )
}

/** The title part's element (`CalendarEventTitle`). */
function eventTitle(content: EventContent, className?: string): ReactNode {
  return (
    <span
      data-slot="calendar-event-title"
      dir="auto"
      className={className === undefined ? EVENT_TITLE_CLASS : cn(EVENT_TITLE_CLASS, className)}
    >
      {content.title}
    </span>
  )
}

/**
 * The default content's elements: the time, a space, the title (no components of their own, so
 * a week of events renders three fewer per event).
 */
function defaultContent(content: EventContent, look: EventLook): ReactNode {
  return (
    <>
      {eventTime(content, look)}
      {content.timeText === '' ? null : ' '}
      {eventTitle(content)}
    </>
  )
}

/**
 * The event's time text ("09:00 – 10:30", "All day", "From 22:00"); nothing when it has none. It
 * takes its direction from its text (`dir="auto"`, isolated like `<bdi>`), so a range keeps its
 * order in a right-to-left calendar.
 */
export function CalendarEventTime({ className }: CalendarEventPartProps) {
  const { content, look } = useEventParts('CalendarEventTime')
  return eventTime(content, look, className)
}

/**
 * The event's title. It takes its direction from its text (`dir="auto"`), so a title too long for
 * its event is cut at its own end in either direction.
 */
export function CalendarEventTitle({ className }: CalendarEventPartProps) {
  const { content } = useEventParts('CalendarEventTitle')
  return eventTitle(content, className)
}

/**
 * The default content: the time, a space, the title. Module-level with a stable identity: it is
 * the `Default` that `renderEvent` receives, so a custom renderer can wrap it.
 */
export function DefaultEventContent() {
  const { content, look } = useEventParts('DefaultEventContent')
  return defaultContent(content, look)
}

/** What `useEventLook` returns: a drawn event's classes and content. */
export interface UseEventLookResult {
  /**
   * The event's own `className`, its look (colors from the props' `--event-color` and
   * `--event-contrast`) and `classNames.event` (with `isMirror: true`); no placement.
   */
  readonly className: string
  /** The content: `renderEvent` (with `isMirror: true`), else the default content. */
  readonly children: ReactNode
}

/** A drawn list item (a timed event of one day in a row) gets a surface of its own. */
const DRAWN_LIST_ITEM_CLASS = 'bg-popover text-popover-foreground shadow-sm ring-1 ring-border'

/**
 * The look of a segment without its behavior or placement (docs/contracts/m5.md §4.1), for what
 * an edit draws: the mirror segments (the event as it would be, with the proposed times) and the
 * drag preview (the pressed segment). Spread `className` on the element of `getMirrorProps` or
 * `getPreviewProps` (which carry the look attributes and the colors) and render `children` in
 * it. Nothing in it is focusable: the default content is text, and `renderEvent` must render no
 * link or button (docs/a11y/contract.md #edit-parts).
 */
export function useEventLook(
  segment: EventSegment,
  renderEvent?: CalendarUiProps['renderEvent'],
): UseEventLookResult {
  const view = useView()
  const classNames = useCalendarClassNames()
  const look = lookOf(segment, false)
  const content: EventContent = {
    variant: segment.variant,
    timeText: segment.timeText,
    title: segment.title,
    isAllDay: segment.isAllDay,
  }
  const state: CalendarPartState['event'] = {
    event: segment.event,
    variant: segment.variant,
    isStart: segment.isStart,
    isEnd: segment.isEnd,
    isShort: segment.isShort,
    isPast: segment.isPast,
    isToday: segment.isToday,
    isSelected: false,
    isDragging: false,
    isPending: false,
    isMirror: true,
    view,
  }
  return {
    className: cn(
      segment.event.className,
      COLOR_CLASS,
      LOOK_CLASS[look],
      look === 'list-item' && DRAWN_LIST_ITEM_CLASS,
      resolvePartClassName(classNames, 'event', state),
    ),
    children: (
      <EventContentContext value={{ content, look }}>
        {renderEvent === undefined
          ? defaultContent(content, look)
          : renderEvent({
              ...state,
              timeText: segment.timeText,
              title: segment.title,
              Default: DefaultEventContent,
            })}
      </EventContentContext>
    ),
  }
}

export interface CalendarEventItemProps extends Pick<CalendarUiProps, 'renderEvent'> {
  /** The segment to render (from the view model, e.g. `day.segments` of the list). */
  segment: EventSegment
  /**
   * `'popover'` for events listed in the "+N more" popover: in flow (no geometry), with ids of
   * their own, outside the events composite. Default `'view'`.
   */
  context?: 'view' | 'popover' | undefined
  /** Classes after the registry's, the event's own and `classNames.event`. */
  className?: string | undefined
  /** Replaces the content (compound parts): `<CalendarEventTime /> <CalendarEventTitle />`. */
  children?: ReactNode
}

/**
 * An event element with the calendar's behavior: roving focus, `onEventClick`, modified clicks
 * left to the browser, `aria-describedby` and the state attributes (`data-past`, `data-today`,
 * `data-all-day`, `data-short`, …). Content: `children`, else `renderEvent` (called as a
 * function), else `DefaultEventContent`. Memoized (spec §5.1): segments keep their identity
 * across rebuilds and the hook subscribes per key (the view `renderEvent` gets is the hook's,
 * not `useView()`), so moving focus through the grid, a re-render of its cell or a drop renders
 * only the events whose state changed. With an editing engine
 * (M5): Space grabs it, its resize handles come before the content (the looks cut their last
 * child, the title, with an ellipsis), and a movable event has a grab cursor and
 * `calendar-event-movable` (no callout or text selection on a long-press, so it can drag).
 */
export const CalendarEventItem = memo(function CalendarEventItem({
  segment,
  context = 'view',
  className,
  children,
  renderEvent,
}: CalendarEventItemProps) {
  const event = useCalendarEvent(segment, { context })
  const classNames = useCalendarClassNames()
  const EventActions = useCalendarSelectionParts()?.EventActions
  const { content, state, edits, view } = event
  const inPopover = context === 'popover'
  const look = lookOf(segment, inPopover)
  const placement: EventPlacement = inPopover
    ? 'flow'
    : segment.variant === 'list'
      ? 'list'
      : segment.variant
  const partState: CalendarPartState['event'] = {
    event: segment.event,
    variant: content.variant,
    isStart: state.isStart,
    isEnd: state.isEnd,
    isShort: state.isShort,
    isPast: state.isPast,
    isToday: state.isToday,
    isSelected: state.isSelected,
    isDragging: state.isDragging,
    isPending: state.isPending,
    isMirror: state.isMirror,
    view,
  }
  const own = elementClassOf(look, placement, edits.move)
  const part = resolvePartClassName(classNames, 'event', partState)
  const { href, ...props } = event.getRootProps({
    'data-display': segment.variant === 'row' ? look : undefined,
    className: part === undefined && className === undefined ? own : cn(own, part, className),
  })
  const body =
    children ??
    (renderEvent === undefined
      ? defaultContent(content, look)
      : renderEvent({
          ...partState,
          timeText: content.timeText,
          title: content.title,
          Default: DefaultEventContent,
        }))
  // The resize handles (docs/a11y/contract.md #edit-parts): `aria-hidden` spans, never
  // focusable (the keyboard resizes the focused event with Shift and the arrow keys), only where
  // `edits` allows them (with `<CalendarEditing>`). `calendar-theme` gives them their hit area
  // along the edge they move (as tall or wide as the event allows, up to 24px, leaving its
  // middle to move it), their cursor and a grip shown on hover and on a touch-selected event.
  // Before the content: the looks cut their last child (the title) with an ellipsis.
  const start = edits.resizeStart ? <span {...event.getResizeHandleProps('start')} /> : null
  const end = edits.resizeEnd ? <span {...event.getResizeHandleProps('end')} /> : null
  const element =
    event.as === 'a' && href !== undefined ? (
      <CalendarLink href={href} {...props}>
        {start}
        {end}
        {body}
      </CalendarLink>
    ) : (
      <button {...props} type="button">
        {start}
        {end}
        {body}
      </button>
    )
  return (
    <EventContentContext value={{ content, look }}>
      {EventActions ? (
        <EventActions segment={segment} context={context} renderEvent={renderEvent}>
          {element}
        </EventActions>
      ) : (
        element
      )}
    </EventContentContext>
  )
})
