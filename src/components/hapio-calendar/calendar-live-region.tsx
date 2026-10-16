'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import { useAnnouncer } from '@hapio/calendar-react'
import { cn } from 'cn'

export interface CalendarLiveRegionProps {
  className?: string | undefined
}

/**
 * The calendar's polite live region: navigation ("Week of October 26 – November 1, 2026") and,
 * from later versions, selection and editing messages. Render it once inside the calendar root
 * and keep it mounted. It is visually hidden (`sr-only`), never `display: none`, so screen
 * readers keep listening to it.
 */
export function CalendarLiveRegion({ className }: CalendarLiveRegionProps) {
  const announcer = useAnnouncer()
  return (
    <div {...announcer.getLiveRegionProps({ className: cn('sr-only', className) })}>
      {announcer.message}
    </div>
  )
}
