'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import { cn } from 'cn'
import type { CSSProperties } from 'react'

// The calendar's loading placeholder, at the size of what it stands for: the view while the
// model is pending (no "now" or zone yet: a server render without `date`/`now`, `timeZone:
// 'local'` before hydration), or the whole block (with a toolbar row) as `HapioCalendar`'s
// `<Suspense>` fallback. A labelled, busy region; its shapes are hidden from assistive
// technology and pulse only when motion is welcome (never in print). It needs no calendar
// context.

const BLOCK_CLASS = 'rounded-md bg-muted motion-safe:animate-calendar-pending print:animate-none'

export interface CalendarSkeletonProps {
  /** Also draw a toolbar row (the block's fallback). Default `false` (the view alone). */
  toolbar?: boolean | undefined
  /** The region's accessible name (`strings.loading`). Default "Loading the calendar". */
  label?: string | undefined
  /** Classes of the outer element; give it the size of what it replaces. */
  className?: string | undefined
  style?: CSSProperties | undefined
}

/** A placeholder of the toolbar (optional) and the view. */
export function CalendarSkeleton({
  toolbar = false,
  label = 'Loading the calendar',
  className,
  style,
}: CalendarSkeletonProps) {
  return (
    <section
      data-slot="calendar-skeleton"
      data-pending=""
      aria-label={label}
      aria-busy="true"
      className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}
      style={style}
    >
      {toolbar ? (
        <div aria-hidden="true" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className={cn(BLOCK_CLASS, 'h-7 w-32')} />
          <div className={cn(BLOCK_CLASS, 'h-6 w-40')} />
          <div className={cn(BLOCK_CLASS, 'ms-auto h-8 w-56 rounded-lg')} />
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className="flex min-h-0 flex-[1_1_24rem] flex-col gap-3 rounded-xl border bg-card p-3"
      >
        <div className={cn(BLOCK_CLASS, 'h-6 w-full')} />
        <div className={cn(BLOCK_CLASS, 'w-full flex-1')} />
      </div>
    </section>
  )
}
