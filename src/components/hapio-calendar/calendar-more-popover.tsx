'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import {
  useCalendarContext,
  useMoreLink,
  type CalendarStyle,
  type CalendarUiProps,
  type MoreGroup,
} from '@hapio/calendar-react'
import { cn } from 'cn'
import { memo } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'

import { resolvePartClassName, useCalendarClassNames } from './calendar-class-names'
import { CalendarEventItem } from './calendar-event'
import { calendarLanguage, usePrimitiveFocusOff } from './calendar-primitive-focus'

// "+N more" (§5.3): a trigger in the view ("+3 more", its hint "Show 3 more events" as the
// title) and a controlled popover, a dialog named by its heading ("Thursday, October 22, 2026,
// 5 events"). Inside: the close button first (both bases focus the first tabbable element on
// open; the hook does it for programmatic opens), the heading, then the listed events in a
// ScrollArea. Focus returns to the trigger on close, when it was inside the popover or lost: the
// hook restores it (BASES.md rule 4), so the primitive's own restore is off (rule 8): after its
// exit animation it would take focus back from where placing a popover event ("Move to…") put it.
// Navigation and zone changes close it. Portalled out of the calendar's root, the popover takes
// the calendar's direction and language itself (`dir`, `lang`).
//
// The trigger's text takes its direction from itself (`dir="auto"`): "+3 more" reads in order in
// a right-to-left calendar (not "more 3+"), sits at the calendar's start, and is cut at its own
// end ("+3 m…") where a cell is too narrow for it.
//
// The trigger sits where the hidden events would be: a row group on the cell's last visible
// level (`--event-inset-start`, `--event-width`, `--event-level`), a time-grid group
// (`maxStack`) in its column (`--event-top`, `--event-height`, …). It prints as text; the
// popover never prints.

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const

const TRIGGER_CLASS =
  'flex min-w-0 cursor-pointer items-center overflow-hidden rounded-sm px-1.5 text-start text-xs font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground'

const PLACEMENT_CLASS: Readonly<Record<MoreGroup['variant'], string>> = {
  row: 'absolute start-[calc(var(--event-inset-start)+2px)] top-[calc(var(--calendar-row-offset,0px)+var(--event-level)*var(--calendar-bar-height))] h-[calc(var(--calendar-bar-height)-2px)] w-[calc(var(--event-width)-4px)]',
  column:
    'absolute start-(--event-inset-start) top-(--event-top) z-(--event-z) h-(--event-height) min-h-6 w-(--event-width) items-start bg-card ring-1 ring-border',
}

/**
 * The list's height, capped at 16rem: N listed events of `--calendar-bar-height` + 0.25rem each
 * (`calendar-event.tsx`, in flow), N − 1 gaps of 0.375rem (`gap-1.5`) and 0.25rem of padding
 * (`p-0.5`): N × (bar + 0.625rem) − 0.125rem. Exact, so a short list neither clips its last event
 * nor scrolls (a scrolling viewport is one more tab stop).
 */
const LIST_HEIGHT =
  'h-[min(16rem,calc(var(--calendar-more-count)*(var(--calendar-bar-height)+0.625rem)-0.125rem))]'

export interface CalendarMorePopoverProps extends Pick<
  CalendarUiProps,
  'renderEvent' | 'headingLevel'
> {
  /** The group (`moreFor(key)`, `lane.allDayMore`). */
  group: MoreGroup
  /** Classes of the trigger, after the registry's and `classNames.moreLink`. */
  className?: string | undefined
}

/**
 * A "+N more" trigger and its popover listing the group's events. Memoized, like the events:
 * `useMoreLink` subscribes per group.
 */
export const CalendarMorePopover = memo(function CalendarMorePopover({
  group,
  renderEvent,
  headingLevel = 3,
  className,
}: CalendarMorePopoverProps) {
  const more = useMoreLink(group)
  const { model } = useCalendarContext()
  const classNames = useCalendarClassNames()
  const focus = usePrimitiveFocusOff()
  const Heading = HEADING_TAGS[headingLevel]
  const listStyle: CalendarStyle = { '--calendar-more-count': more.segments.length }
  return (
    <Popover
      {...focus.rootProps}
      open={more.open}
      onOpenChange={(open: boolean) => more.onOpenChange(open)}
    >
      <PopoverTrigger
        {...more.getTriggerProps({
          className: cn(
            TRIGGER_CLASS,
            PLACEMENT_CLASS[group.variant],
            resolvePartClassName(classNames, 'moreLink', {
              dateIso: group.dateIso,
              count: group.count,
            }),
            className,
          ),
        })}
        type="button"
      >
        {/* Its own direction from its text, so "+3 more" keeps its order right to left, and cut
            at its own end where the cell is too narrow (the count stays). */}
        <span dir="auto" className="min-w-0 truncate">
          {more.text}
        </span>
      </PopoverTrigger>
      <PopoverContent
        {...focus.contentProps}
        {...more.getContentProps({
          dir: model.dir,
          lang: calendarLanguage(model.strings),
          className: 'w-72 gap-1.5 p-2 print:hidden',
        })}
        align="start"
        sideOffset={4}
      >
        <div className="flex flex-row-reverse items-center justify-between gap-2 ps-1.5">
          <Button {...more.getCloseButtonProps()} type="button" variant="ghost" size="icon-sm">
            <CloseIcon />
          </Button>
          <Heading {...more.getHeadingProps({ className: 'min-w-0 text-sm font-semibold' })}>
            <span aria-hidden="true">{more.heading}</span>
            <span className="sr-only">{more.label}</span>
          </Heading>
        </div>
        <ScrollArea dir={model.dir} className={LIST_HEIGHT} style={listStyle}>
          <ul className="flex flex-col gap-1.5 p-0.5 pe-3">
            {more.segments.map((segment) => (
              <li key={segment.key} className="flex">
                <CalendarEventItem segment={segment} context="popover" renderEvent={renderEvent} />
              </li>
            ))}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
})

/** A cross (decorative: the button carries the name "Close"). */
function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      data-slot="calendar-icon"
      className="size-4 shrink-0"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
