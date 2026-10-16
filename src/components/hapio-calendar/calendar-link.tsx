'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import type { CalendarUiProps } from '@hapio/calendar-react'
import { createContext, createElement, use } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

/**
 * The component that renders event links: the app's router link (Next's `Link`, React
 * Router's `Link`, …) or a plain `<a>`. It receives `href`, `className`, the event's handlers and
 * its ARIA attributes, and must render an `<a>` that passes them on.
 */
export type CalendarLinkComponent = NonNullable<CalendarUiProps['linkComponent']>

/** Props of `CalendarLink`: an anchor with a required `href`. */
export type CalendarLinkProps = { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>

const CalendarLinkContext = createContext<CalendarLinkComponent | null>(null)

export interface CalendarLinkProviderProps {
  /** The link component (the block's `linkComponent` prop); a plain `<a>` when left out. */
  component?: CalendarLinkComponent | undefined
  children?: ReactNode
}

/**
 * Makes event links render through the app's link component, so a plain click on an event with
 * an `href` navigates client-side:
 *
 * ```tsx
 * import Link from 'next/link'
 * <CalendarLinkProvider component={Link}>…</CalendarLinkProvider>
 * ```
 */
export function CalendarLinkProvider({ component, children }: CalendarLinkProviderProps) {
  return <CalendarLinkContext value={component ?? null}>{children}</CalendarLinkContext>
}

/**
 * An anchor through the provided link component, or a plain `<a>`. The calendar's own
 * `onClick` runs first: when `onEventClick` calls `preventDefault()`, router links (which check
 * `defaultPrevented`) skip their navigation too.
 */
export function CalendarLink({ children, ...props }: CalendarLinkProps) {
  const linkComponent = use(CalendarLinkContext)
  if (linkComponent === null) return <a {...props}>{children}</a>
  // The app's component, from context: its identity is the app's (usually module-level), so
  // nothing remounts between renders.
  return createElement(linkComponent, props, children)
}
