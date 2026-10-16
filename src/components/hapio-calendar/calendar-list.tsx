'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import { useCalendarContext, useList, type CalendarUiProps } from '@hapio/calendar-react'
import { cn } from 'cn'

import { resolvePartClassName, useCalendarClassNames } from './calendar-class-names'
import { CalendarEventItem } from './calendar-event'

// The list view (spec §5.3):
//
//   ul "Events"                          one item per day with events
//     li [data-today]                    the day group
//       h3  "October 22, 2026 Thursday"  heading level from `headingLevel`
//       ul (labelled by the heading)
//         li > a | button                one event: "09:00 – 10:30 Haircut · Anna"
//
// When the period has no events, a message (`strings.noEvents`, or `renderEmpty`) replaces
// the list; it takes focus when PageUp/PageDown lands on such a period. While `loading` (or
// while event sources load), the list or the message is busy (`aria-busy`, never an ancestor of
// the live region) and shows a progress bar along its top edge (`data-loading`). The text keeps
// its full contrast: nothing is dimmed.

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const

/** A thin pulsing bar along the top edge while loading (decorative; the text is not dimmed). */
const LOADING_BAR_CLASS =
  'data-loading:before:absolute data-loading:before:inset-x-0 data-loading:before:top-0 data-loading:before:z-10 data-loading:before:h-0.5 data-loading:before:bg-primary motion-safe:data-loading:before:animate-pulse print:before:hidden'

export interface CalendarListProps extends Pick<
  CalendarUiProps,
  'renderEvent' | 'renderEmpty' | 'loading' | 'headingLevel'
> {
  /** Classes of the list (or of the empty message), after `classNames.view`/`classNames.empty`. */
  className?: string | undefined
}

/**
 * The active list view of the calendar in `CalendarProvider`; nothing while the calendar has no
 * list view (another view is active, or the model is still pending).
 */
export function CalendarList(props: CalendarListProps) {
  const { model } = useCalendarContext()
  if (model.view?.kind !== 'list') return null
  return <CalendarListView {...props} loading={props.loading ?? model.loading} />
}

function CalendarListView({
  headingLevel = 3,
  renderEvent,
  renderEmpty,
  loading = false,
  className,
}: CalendarListProps) {
  const list = useList()
  const { model } = useCalendarContext()
  const classNames = useCalendarClassNames()
  const Heading = HEADING_TAGS[headingLevel]
  const loadingFlag = loading ? '' : undefined
  const busy = loading ? true : undefined

  if (list.isEmpty) {
    return (
      <div
        {...list.getEmptyProps({
          'aria-busy': busy,
          'data-loading': loadingFlag,
          className: cn(
            'relative overflow-hidden rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground focus-visible:outline-solid',
            LOADING_BAR_CLASS,
            resolvePartClassName(classNames, 'empty', { loading }),
            className,
          ),
        })}
      >
        {renderEmpty === undefined ? list.emptyText : renderEmpty({ loading })}
      </div>
    )
  }

  return (
    <ul
      {...list.getListProps({
        'aria-busy': busy,
        'data-loading': loadingFlag,
        className: cn(
          'relative flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground print:overflow-visible',
          LOADING_BAR_CLASS,
          resolvePartClassName(classNames, 'view', { view: model.viewName, kind: 'list' }),
          className,
        ),
      })}
    >
      {list.days.map((day) => (
        <li
          key={day.key}
          {...list.getDayProps(day, {
            'aria-current': day.isToday ? 'date' : undefined,
            className: cn(
              'border-b last:border-b-0 print:break-inside-avoid',
              resolvePartClassName(classNames, 'listDay', {
                dateIso: day.dateIso,
                isToday: day.isToday,
                isPast: day.isPast,
              }),
            ),
          })}
        >
          <Heading
            {...list.getDayHeadingProps(day, {
              className:
                'flex flex-wrap items-baseline gap-x-2 gap-y-1 bg-muted/50 px-4 py-2 text-sm font-semibold',
            })}
          >
            <span>{day.heading}</span>{' '}
            <span className="font-normal text-muted-foreground">{day.headingAlt}</span>
            {day.isToday ? (
              <>
                {' '}
                <span className="ms-auto rounded-full border border-calendar-today px-2 text-xs font-medium">
                  {model.strings.today}
                </span>
              </>
            ) : null}
          </Heading>
          <ul {...list.getDayListProps(day, { className: 'flex flex-col gap-0.5 p-1.5' })}>
            {day.segments.map((segment) => (
              <li key={segment.key} {...list.getItemProps(segment, { className: 'flex' })}>
                <CalendarEventItem segment={segment} renderEvent={renderEvent} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
