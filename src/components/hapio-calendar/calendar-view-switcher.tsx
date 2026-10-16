'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import { useToolbar } from '@hapio/calendar-react'
import { cn } from 'cn'

import { Button } from '@/components/ui/button'

export interface CalendarViewSwitcherProps {
  className?: string | undefined
}

/**
 * The view switcher: a radiogroup ("Calendar view") of the configured views, one shadcn `Button`
 * per view with `role="radio"` ("Week view", "List view", …; the visible text is the short
 * label). One tab stop on the checked view; the arrow keys, Home and End switch views (flipped
 * in right-to-left text). The checked view uses the `default` variant (its hover keeps the
 * label readable in both schemes) and the others `ghost`; in forced-colors mode the checked one
 * takes the system highlight colors (`aria-checked:`).
 */
export function CalendarViewSwitcher({ className }: CalendarViewSwitcherProps) {
  const toolbar = useToolbar()
  return (
    <div
      {...toolbar.getViewSwitcherProps({
        className: cn('inline-flex items-center gap-0.5 rounded-lg border p-0.5', className),
      })}
    >
      {toolbar.views.map((option) => (
        <Button
          key={option.name}
          {...toolbar.getViewOptionProps(option.name, {
            className:
              'forced-colors:aria-checked:bg-[Highlight] forced-colors:aria-checked:text-[HighlightText] forced-colors:aria-checked:forced-color-adjust-none',
          })}
          type="button"
          variant={option.selected ? 'default' : 'ghost'}
          size="sm"
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
