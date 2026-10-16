'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import { cn } from 'cn'
import type { ComponentProps } from 'react'

/** Props of the calendar icons: any `<svg>` attribute except children. */
export type CalendarIconProps = Omit<ComponentProps<'svg'>, 'children'>

const ICON_CLASS = 'size-4 shrink-0'

/**
 * A chevron pointing to the inline start: left in left-to-right text, right in right-to-left
 * text (mirrored with `rtl:`, which follows the nearest `dir`, such as the calendar root's).
 * Decorative: the button around it carries the name.
 */
export function CalendarChevronStartIcon({ className, ...props }: CalendarIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-slot="calendar-icon"
      className={cn(ICON_CLASS, 'rtl:-scale-x-100', className)}
      {...props}
    >
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  )
}

/** A chevron pointing to the inline end: right in left-to-right text, left in right-to-left. */
export function CalendarChevronEndIcon({ className, ...props }: CalendarIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-slot="calendar-icon"
      className={cn(ICON_CLASS, 'rtl:-scale-x-100', className)}
      {...props}
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  )
}
