'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import { useToolbar } from '@hapio/calendar-react'
import { cn } from 'cn'

import { Button } from '@/components/ui/button'

import { resolvePartClassName, useCalendarClassNames } from './calendar-class-names'
import { CalendarChevronEndIcon, CalendarChevronStartIcon } from './calendar-icons'
import { CalendarViewSwitcher } from './calendar-view-switcher'

/** Today, previous and next at the `validRange` edges: `aria-disabled`, never `disabled`. */
const NAV_BUTTON_CLASS = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

export interface CalendarToolbarProps {
  className?: string | undefined
}

/**
 * The toolbar: "Today" (its hint, e.g. "This week", as the tooltip), previous and next
 * ("Previous Week", "Next Week"; icon buttons with RTL-aware chevrons), the period title (an
 * `h2` that the views are labelled by) and the view switcher. It wraps on narrow screens and is
 * left out of print.
 */
export function CalendarToolbar({ className }: CalendarToolbarProps) {
  const toolbar = useToolbar()
  const classNames = useCalendarClassNames()
  return (
    <div
      data-slot="calendar-toolbar"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden',
        resolvePartClassName(classNames, 'toolbar', { view: toolbar.view }),
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <Button
          {...toolbar.getTodayButtonProps({ className: NAV_BUTTON_CLASS })}
          type="button"
          variant="outline"
          size="sm"
        >
          {toolbar.todayText}
        </Button>
        <Button
          {...toolbar.getPrevButtonProps({ className: NAV_BUTTON_CLASS })}
          type="button"
          variant="ghost"
          size="icon-sm"
        >
          <CalendarChevronStartIcon />
        </Button>
        <Button
          {...toolbar.getNextButtonProps({ className: NAV_BUTTON_CLASS })}
          type="button"
          variant="ghost"
          size="icon-sm"
        >
          <CalendarChevronEndIcon />
        </Button>
      </div>
      <h2 {...toolbar.getTitleProps({ className: 'min-w-0 text-lg font-semibold tracking-tight' })}>
        {toolbar.title}
      </h2>
      <CalendarViewSwitcher className="ms-auto" />
    </div>
  )
}
