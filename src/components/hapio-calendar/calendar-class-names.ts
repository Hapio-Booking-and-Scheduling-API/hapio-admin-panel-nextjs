'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import type { CalendarClassNames, CalendarPart, CalendarPartState } from '@hapio/calendar-react'
import { createContext, createElement, use } from 'react'
import type { ReactNode } from 'react'

// The `classNames` UI prop (spec §3.8): per-part classes, appended after the registry's own.
// Typed loosely inside (any event data, any resource data): each part receives its state from the
// component that renders it, and the provider accepts the app's typed `classNames`.
type AnyClassNames = CalendarClassNames<any, any>
type AnyPartState = CalendarPartState<any, any>

/** One part's entry: a class string, or a function of the part's state. */
type PartClassName<S> = string | ((state: S) => string | false | null | undefined)

const CalendarClassNamesContext = createContext<AnyClassNames | undefined>(undefined)

export interface CalendarClassNamesProviderProps<TData = unknown, TRes = unknown> {
  /** Per-part classes, e.g. `{ event: ({ event }) => event.data.status === 'temporary' && 'italic' }`. */
  classNames?: CalendarClassNames<TData, TRes> | undefined
  children?: ReactNode
}

/** Shares the `classNames` UI prop with every calendar part below it. */
export function CalendarClassNamesProvider<TData = unknown, TRes = unknown>({
  classNames,
  children,
}: CalendarClassNamesProviderProps<TData, TRes>): ReactNode {
  return createElement(CalendarClassNamesContext, { value: classNames }, children)
}

/** The `classNames` of the nearest `CalendarClassNamesProvider` (`undefined` without one). */
export function useCalendarClassNames(): AnyClassNames | undefined {
  return use(CalendarClassNamesContext)
}

/**
 * The classes `classNames` gives `part` in `state`: the string itself, or what the function
 * returns (`false`, `null`, `undefined` and `''` give none).
 */
export function resolvePartClassName<P extends CalendarPart>(
  classNames: AnyClassNames | undefined,
  part: P,
  state: AnyPartState[P],
): string | undefined {
  const value: PartClassName<AnyPartState[P]> | undefined = classNames?.[part]
  if (value === undefined) return undefined
  const resolved = typeof value === 'string' ? value : value(state)
  return typeof resolved === 'string' && resolved !== '' ? resolved : undefined
}
